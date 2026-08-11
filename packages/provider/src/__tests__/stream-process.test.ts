import { describe, it, expect, vi } from 'vitest'
import {
  streamCommandViaProcess,
  TIMEOUT_EXIT_CODE,
  START_FAILURE_EXIT_CODE
} from '../stream-process'
import type { StreamedProcess } from '../stream-process'

/**
 * A process whose output and exit are driven by the test, so "arrived while the
 * command was still running" is an observable fact rather than a guess.
 */
function fakeProcess(overrides: Partial<StreamedProcess> = {}) {
  const queued: string[] = []
  const waiters: Array<() => void> = []
  let running = true
  let exitCode: number | undefined

  const wake = () => {
    while (waiters.length > 0) (waiters.shift() as () => void)()
  }

  async function* follow(
    buffer: string[],
    signal: AbortSignal
  ): AsyncIterable<string> {
    while (true) {
      while (buffer.length > 0) yield buffer.shift() as string
      if (!running || signal.aborted) return
      await new Promise<void>((resolve) => {
        waiters.push(resolve)
        signal.addEventListener('abort', () => resolve(), { once: true })
      })
    }
  }

  const err: string[] = []
  const process: StreamedProcess = {
    followStdout: (signal) => follow(queued, signal),
    followStderr: (signal) => follow(err, signal),
    status: async () => ({ running, exitCode }),
    kill: vi.fn(async () => {}),
    bufferedStdout: async () => 'tick 1\ntick 2\n',
    bufferedStderr: async () => '',
    ...overrides
  }

  return {
    process,
    emit: (text: string) => {
      queued.push(text)
      wake()
    },
    emitErr: (text: string) => {
      err.push(text)
      wake()
    },
    exit: (code: number) => {
      running = false
      exitCode = code
      wake()
    }
  }
}

describe('streamCommandViaProcess', () => {
  it('delivers output while the command is still running', async () => {
    const fake = fakeProcess()
    const seen: string[] = []

    const running = streamCommandViaProcess(async () => fake.process, {
      onStdout: (text) => seen.push(text)
    })

    fake.emit('tick 1\n')
    await vi.waitFor(() => expect(seen).toEqual(['tick 1\n']))
    fake.emit('tick 2\n')
    await vi.waitFor(() => expect(seen).toEqual(['tick 1\n', 'tick 2\n']))

    fake.exit(0)
    const result = await running
    expect(result).toMatchObject({ stdout: 'tick 1\ntick 2\n', exitCode: 0 })
  })

  it('keeps stderr separate', async () => {
    const fake = fakeProcess()
    const running = streamCommandViaProcess(async () => fake.process, {
      onStderr: () => {}
    })
    fake.emitErr('boom\n')
    fake.exit(2)
    await expect(running).resolves.toMatchObject({
      stderr: 'boom\n',
      exitCode: 2
    })
  })

  it('recovers the tail and the real exit code after a follow drops', async () => {
    const fake = fakeProcess({
      // eslint-disable-next-line require-yield
      followStdout: async function* () {
        throw new Error('connection reset')
      }
    })
    const seen: string[] = []

    const running = streamCommandViaProcess(async () => fake.process, {
      onStdout: (text) => seen.push(text)
    })
    fake.exit(3)

    const result = await running
    expect(seen).toEqual(['tick 1\ntick 2\n'])
    expect(result).toMatchObject({ stdout: 'tick 1\ntick 2\n', exitCode: 3 })
  })

  it('keeps the deadline armed when a follow dropped and the process lives on', async () => {
    // A dropped follow is not an exit, so the timeout must still be the thing
    // that stops the command rather than being cleared with it.
    const fake = fakeProcess({
      // eslint-disable-next-line require-yield
      followStdout: async function* () {
        throw new Error('connection reset')
      }
    })

    const result = await streamCommandViaProcess(async () => fake.process, {
      timeout: 30,
      onStdout: () => {}
    })

    expect(fake.process.kill).toHaveBeenCalled()
    expect(result.exitCode).toBe(TIMEOUT_EXIT_CODE)
  })

  it('returns at the deadline even when the kill never answers', async () => {
    const fake = fakeProcess({ kill: vi.fn(() => new Promise<void>(() => {})) })

    const result = await streamCommandViaProcess(async () => fake.process, {
      timeout: 10,
      onStdout: () => {}
    })
    expect(result.exitCode).toBe(TIMEOUT_EXIT_CODE)
  })

  it('does not call a finished command timed out when its status is slow', async () => {
    const fake = fakeProcess()
    fake.process.status = async () => {
      await new Promise((resolve) => setTimeout(resolve, 40))
      return { running: false, exitCode: 0 }
    }

    const running = streamCommandViaProcess(async () => fake.process, {
      timeout: 20,
      onStdout: () => {}
    })
    fake.exit(0)

    await expect(running).resolves.toMatchObject({ exitCode: 0 })
  })

  it('reports a process that could not be started', async () => {
    const result = await streamCommandViaProcess(
      async () => {
        throw new Error('sandbox is not running')
      },
      { onStdout: () => {} }
    )

    expect(result).toMatchObject({
      stderr: 'sandbox is not running',
      exitCode: START_FAILURE_EXIT_CODE
    })
  })
})
