/**
 * Isorun standard-size mapping, mock-only (no API key, no sandbox boots).
 *
 * Ways the mapping could fail, each covered below:
 * - Wrong shape: a class maps to a pairing Isorun does not list (e.g. sm as 1/2048,
 *   which Isorun rejects with `unsupported vm size`), or xs/md/lg/xl send other numbers.
 * - Bigger-than-listed class: 2xl/3xl claim support though 8 vCPU / 16 GiB is the ceiling.
 * - Silent default boot: an unsupported class (sm, 2xl, 3xl) reaches client.create and
 *   boots the 1 vCPU / 1 GiB default instead of rejecting.
 * - Dropped field: the create path forgets vcpus, memMiB or diskMiB on the way to
 *   client.create, or the platform disk for md/lg/xl is not emitted / not declared in resolved.
 * - Snapshot path: sizeClass with snapshotId reaches restore, which ignores resources.
 * - Conflict accepted: native vcpus/memMiB alongside sizeClass silently win or lose.
 * - Caller disk clobbered: an explicit diskMiB is overwritten by the size's default disk.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    creates: [] as Record<string, unknown>[],
    restores: [] as string[],
  }
  const makeSandbox = (id: string) => ({ id, setTimeout: async () => undefined })
  class Isorun {
    constructor(_options: Record<string, unknown>) {}
    async create(options: Record<string, unknown>) {
      state.creates.push(options)
      return makeSandbox('run-test')
    }
    async restore(id: string) {
      state.restores.push(id)
      return makeSandbox('run-restored')
    }
  }
  return { Isorun, state }
})

vi.mock('isorun', () => ({ Isorun: h.Isorun, Sandbox: class {} }))

import { InstanceSizeError } from '@computesdk/provider'
import { ISORUN_SIZE_SHAPES, isorun } from '../index'

const provider = () => isorun({ apiKey: 'iso_test' })

const expected = {
  xs: { vcpus: 1, memMiB: 1024 },
  md: { vcpus: 2, memMiB: 4096, diskMiB: 16384 },
  lg: { vcpus: 4, memMiB: 8192, diskMiB: 32768 },
  xl: { vcpus: 8, memMiB: 16384, diskMiB: 65536 },
} as const

describe('Isorun standard size mapping (mock-only)', () => {
  beforeEach(() => {
    h.state.creates.length = 0
    h.state.restores.length = 0
  })

  it('supports exactly xs, md, lg and xl', () => {
    const list = provider().sizes.list()
    expect(list.filter(r => r.status === 'supported').map(r => r.requested.sizeClass)).toEqual(['xs', 'md', 'lg', 'xl'])
    expect(Object.keys(ISORUN_SIZE_SHAPES)).toEqual(['xs', 'md', 'lg', 'xl'])
  })

  it.each(Object.entries(expected))('%s resolves to its listed shape and platform disk', (sizeClass, shape) => {
    const r = provider().sizes.resolve(sizeClass as keyof typeof expected)
    expect(r.status).toBe('supported')
    if (r.status !== 'supported') return
    expect(r.nativeOptions).toEqual(shape)
    expect(r.resolved).toEqual({
      vcpus: shape.vcpus, memoryMiB: shape.memMiB, ...('diskMiB' in shape ? { diskMiB: shape.diskMiB } : {}),
    })
    expect(r.belowStandard).toBeUndefined()
  })

  it.each(['sm', '2xl', '3xl'] as const)('%s is unsupported with a reason', (sizeClass) => {
    const r = provider().sizes.resolve(sizeClass)
    expect(r.status).toBe('unsupported')
    if (r.status === 'supported') return
    expect(r.reason).toMatch(/Isorun/)
  })

  it.each(Object.entries(expected))('create({ sizeClass: %s }) forwards vcpus/memMiB/diskMiB to client.create', async (sizeClass, shape) => {
    const sandbox = await provider().instances.create({ sizeClass: sizeClass as keyof typeof expected, timeout: 60_000 })
    expect(h.state.creates).toHaveLength(1)
    expect(h.state.creates[0]).toMatchObject({ image: 'node:22', vcpus: shape.vcpus, memMiB: shape.memMiB, diskMiB: 'diskMiB' in shape ? shape.diskMiB : undefined, timeoutSec: 60 })
    expect(sandbox.sizing?.resolved.vcpus).toBe(shape.vcpus)
    expect(sandbox.sizing?.resolved.memoryMiB).toBe(shape.memMiB)
  })

  it.each(['sm', '2xl', '3xl'] as const)('create({ sizeClass: %s }) rejects before any boot', async (sizeClass) => {
    await expect(provider().instances.create({ sizeClass })).rejects.toMatchObject({ name: 'InstanceSizeError', code: 'unsupported', fallback: false })
    expect(h.state.creates).toHaveLength(0)
  })

  it('keeps an explicit caller diskMiB and declares it', async () => {
    const p = provider()
    const r = p.sizes.resolve('lg', { diskMiB: 8192 })
    expect(r.status === 'supported' && r.nativeOptions).toEqual({ vcpus: 4, memMiB: 8192 })
    expect(r.status === 'supported' && r.resolved).toEqual({ vcpus: 4, memoryMiB: 8192, diskMiB: 8192 })
    await p.instances.create({ sizeClass: 'lg', diskMiB: 8192 })
    expect(h.state.creates[0]).toMatchObject({ vcpus: 4, memMiB: 8192, diskMiB: 8192 })
  })

  it('rejects an invalid caller diskMiB', () => {
    expect(() => provider().sizes.resolve('md', { diskMiB: 0 })).toThrow(InstanceSizeError)
  })

  it.each([{ vcpus: 2 }, { memMiB: 4096 }])('rejects native CPU/RAM alongside sizeClass: %o', async (native) => {
    await expect(provider().instances.create({ sizeClass: 'md', ...native })).rejects.toMatchObject({ code: 'conflict' })
    expect(() => provider().sizes.resolve('md', native)).toThrow(/cannot combine sizeClass/)
    expect(h.state.creates).toHaveLength(0)
  })

  it('refuses sizeClass with snapshotId instead of restoring at the snapshot size', async () => {
    await expect(provider().instances.create({ sizeClass: 'md', snapshotId: 'snap-1' })).rejects.toMatchObject({ code: 'unsupported' })
    expect(h.state.restores).toHaveLength(0)
    expect(h.state.creates).toHaveLength(0)
  })

  it('leaves creates without sizeClass untouched', async () => {
    await provider().instances.create({})
    expect(h.state.creates[0]).toMatchObject({ vcpus: undefined, memMiB: undefined, diskMiB: undefined })
  })
})
