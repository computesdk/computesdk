import { describe, it, expect } from 'vitest'
import { createConfigGate, createConfigStamp } from '../config-gate.js'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

/** Wait one macrotask so queued gate work can run. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

describe('createConfigGate', () => {
  it('runs same-key operations concurrently after one install', async () => {
    const gate = createConfigGate()
    const installs: string[] = []
    const running = new Set<string>()
    let maxConcurrent = 0

    const op = (id: string) =>
      gate.withConfig('a', () => installs.push('a'), async () => {
        running.add(id)
        maxConcurrent = Math.max(maxConcurrent, running.size)
        await tick()
        running.delete(id)
      })

    await Promise.all([op('1'), op('2'), op('3')])
    expect(maxConcurrent).toBe(3)
    expect(installs).toEqual(['a'])
  })

  it('installs once per epoch and re-installs when the key returns', async () => {
    const gate = createConfigGate()
    const installs: string[] = []

    await gate.withConfig('a', () => installs.push('a'), async () => {})
    await gate.withConfig('b', () => installs.push('b'), async () => {})
    await gate.withConfig('a', () => installs.push('a'), async () => {})

    expect(installs).toEqual(['a', 'b', 'a'])
  })

  it('holds a different key until the active epoch drains', async () => {
    const gate = createConfigGate()
    const order: string[] = []
    const hold = deferred<void>()

    const opA = gate.withConfig('a', () => order.push('install:a'), async () => {
      order.push('run:a')
      await hold.promise
      order.push('done:a')
    })
    await tick()

    let bRan = false
    const opB = gate.withConfig('b', () => order.push('install:b'), async () => {
      bRan = true
      order.push('run:b')
    })
    await tick()
    await tick()
    expect(bRan).toBe(false)

    hold.resolve()
    await opA
    await opB
    expect(order).toEqual(['install:a', 'run:a', 'done:a', 'install:b', 'run:b'])
  })

  it('queues same-key arrivals behind a pending different-key waiter', async () => {
    const gate = createConfigGate()
    const order: string[] = []
    const hold = deferred<void>()

    const opA = gate.withConfig('a', undefined, async () => {
      order.push('run:a1')
      await hold.promise
      order.push('done:a1')
    })
    await tick()

    const opB = gate.withConfig('b', undefined, async () => order.push('run:b'))
    const opA2 = gate.withConfig('a', undefined, async () => order.push('run:a2'))

    await tick()
    await tick()
    expect(order).toEqual(['run:a1'])

    hold.resolve()
    await Promise.all([opA, opB, opA2])
    expect(order).toEqual(['run:a1', 'done:a1', 'run:b', 'run:a2'])
  })

  it('rejects an op whose install throws and admits the next waiter', async () => {
    const gate = createConfigGate()
    const order: string[] = []
    const hold = deferred<void>()

    const opA = gate.withConfig('a', undefined, async () => {
      order.push('run:a')
      await hold.promise
    })
    await tick()

    const badB = gate.withConfig('b', () => { throw new Error('bad install') }, async () => {
      order.push('run:b')
    })
    const goodC = gate.withConfig('c', () => order.push('install:c'), async () => {
      order.push('run:c')
    })

    hold.resolve()
    await opA
    await expect(badB).rejects.toThrow('bad install')
    await goodC
    expect(order).toEqual(['run:a', 'install:c', 'run:c'])
  })

  it('propagates a first-call install error without claiming the gate', async () => {
    const gate = createConfigGate()
    await expect(
      gate.withConfig('a', () => { throw new Error('nope') }, async () => {}),
    ).rejects.toThrow('nope')

    // The gate is idle again: a valid config installs and runs.
    const result = await gate.withConfig('b', undefined, async () => 'ok')
    expect(result).toBe('ok')
  })

  it('releases the epoch when the operation throws', async () => {
    const gate = createConfigGate()
    const installs: string[] = []

    await expect(
      gate.withConfig('a', () => installs.push('a'), async () => {
        throw new Error('op failed')
      }),
    ).rejects.toThrow('op failed')

    await gate.withConfig('b', () => installs.push('b'), async () => {})
    expect(installs).toEqual(['a', 'b'])
  })
})

describe('createConfigStamp', () => {
  it('round-trips the stamped config without enumerating it', () => {
    const stamp = createConfigStamp<{ key: string }>()
    const target: { key?: string } & Record<string, unknown> = { name: 'sb' } as never
    stamp.stamp(target, { key: 'cfg' })

    expect(stamp.config(target)).toEqual({ key: 'cfg' })
    expect(Object.keys(target)).toEqual(['name'])
    expect(JSON.stringify(target)).toBe('{"name":"sb"}')
  })

  it('returns undefined for unstamped targets', () => {
    const stamp = createConfigStamp<{ key: string }>()
    expect(stamp.config({})).toBeUndefined()
    expect(stamp.config(null)).toBeUndefined()
    expect(stamp.config('x')).toBeUndefined()
  })

  it('keeps stamps from different helpers independent', () => {
    const a = createConfigStamp<number>()
    const b = createConfigStamp<string>()
    const target = {}
    a.stamp(target, 1)
    b.stamp(target, 'two')
    expect(a.config(target)).toBe(1)
    expect(b.config(target)).toBe('two')
  })
})
