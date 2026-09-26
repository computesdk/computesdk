import { describe, it, expect, vi, afterEach } from 'vitest'
import { defineProvider } from '../factory.js'
import type { CommandResult, SandboxInfo } from '../types/index.js'

const { daemonSeedScriptCommand } = vi.hoisted(() => ({
  daemonSeedScriptCommand: vi.fn(),
}))

vi.mock('daemond', () => ({
  daemonSeedScriptCommand,
  // Real enough for the tests: the marker command is the JSON payload itself,
  // and the fake runCommand returns an already-parsed invocation on stdout.
  parseSeedInvocationOutput: (raw: string) =>
    JSON.parse(raw.trim().split('\n').filter(Boolean).pop()!),
}))

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

type JobState = {
  jobId: string
  pid: number
  stdout: string
  stderr: string
  status: 'running' | 'exited'
  exitCode: number | null
  signal: string | null
}

type FakeState = {
  job: JobState
  stdinWrites: string[]
  statusSnapshots?: Partial<JobState>[]
  statusDelayMs?: number
  statusInFlight?: number
  maxStatusInFlight?: number
  waitReturnsRunning?: boolean
  failBootstrap?: boolean
  failRequests?: Record<string, { exitCode: number; stderr: string }>
  getUrl?: (sandbox: unknown, options: { port: number; protocol?: string }) => Promise<string>
}

function makeMethods(state: FakeState) {
  return {
    create: vi.fn().mockResolvedValue({
      sandbox: { id: 'test-proc', status: 'running' },
      sandboxId: 'test-proc',
    }),
    getById: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    destroy: vi.fn().mockResolvedValue(undefined),
    runCommand: vi.fn(async (_sandbox: unknown, command: string): Promise<CommandResult> => {
      const payload = JSON.parse(command)

      if (state.failBootstrap) {
        return {
          stdout: '',
          stderr: 'daemond: sandbox lacks a JavaScript runtime',
          exitCode: 127,
          durationMs: 3,
        }
      }

      const respond = (cmd: Record<string, unknown>): CommandResult => ({
        stdout: JSON.stringify({
          token: 'tok',
          requestId: 'req',
          daemon: {
            reused: false,
            pid: 1,
            sseUrl: 'http://127.0.0.1:38989/events?token=tok',
          },
          command: cmd,
        }),
        stderr: '',
        exitCode: 0,
        durationMs: 1,
      })

      const jobSnapshot = () => ({
        jobId: state.job.jobId,
        pid: state.job.pid,
        status: state.job.status,
        exitCode: state.job.exitCode,
        signal: state.job.signal,
        stdout: state.job.stdout,
        stderr: state.job.stderr,
        combined: state.job.stdout + state.job.stderr,
        truncated: false,
      })

      if (typeof payload.stdin === 'string') {
        const fail = state.failRequests?.stdin
        if (fail) return { stdout: '', stderr: fail.stderr, exitCode: fail.exitCode, durationMs: 1 }
        state.stdinWrites.push(Buffer.from(String(payload.data), 'base64').toString('utf8'))
        return respond(jobSnapshot())
      }
      if (typeof payload.closeStdin === 'string') {
        return respond(jobSnapshot())
      }
      if (typeof payload.status === 'string') {
        state.statusInFlight = (state.statusInFlight ?? 0) + 1
        state.maxStatusInFlight = Math.max(state.maxStatusInFlight ?? 0, state.statusInFlight)
        try {
          if (state.statusDelayMs) {
            await new Promise((r) => setTimeout(r, state.statusDelayMs))
          }
          const next = state.statusSnapshots?.shift()
          if (next) Object.assign(state.job, next)
          return respond(jobSnapshot())
        } finally {
          state.statusInFlight!--
        }
      }
      if (typeof payload.wait === 'string') {
        if (state.waitReturnsRunning) return respond(jobSnapshot())
        return respond({ ...jobSnapshot(), status: 'exited', exitCode: 0 })
      }
      if (typeof payload.kill === 'string') {
        state.job.signal = String(payload.signal ?? 'SIGTERM')
        state.job.status = 'exited'
        return respond(jobSnapshot())
      }
      // exec payloads (bootstrap `true` and the detached job)
      if (payload.detach === true) {
        return respond(jobSnapshot())
      }
      return respond({
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        combined: '',
      })
    }),
    getInfo: vi.fn().mockResolvedValue({
      id: 'test-proc',
      provider: 'mock',
      status: 'running',
      createdAt: new Date(),
      timeout: 300000,
    } as SandboxInfo),
    getUrl: state.getUrl ?? (async () => { throw new Error('port not exposed') }),
  }
}

function makeSandbox(state: FakeState) {
  const methods = makeMethods(state)
  daemonSeedScriptCommand.mockImplementation((_config: unknown, payload: unknown) =>
    typeof payload === 'string' ? payload : JSON.stringify(payload)
  )
  const provider = defineProvider({ name: 'mock', methods: { sandbox: methods } })({ apiKey: 'k' })
  return { methods, provider }
}

function freshJob(): JobState {
  return {
    jobId: 'job-1',
    pid: 42,
    stdout: '',
    stderr: '',
    status: 'running',
    exitCode: null,
    signal: null,
  }
}

describe('startProcess', () => {
  it('bootstraps once then execs with detach and stdin', async () => {
    const state = { job: freshJob(), stdinWrites: [] as string[] }
    const { methods, provider } = makeSandbox(state)
    const sandbox = await provider.sandbox.create()

    const proc = await sandbox.startProcess('cat', { stdin: true })

    expect(proc.jobId).toBe('job-1')
    expect(proc.pid).toBe(42)
    // bootstrap + exec
    expect(daemonSeedScriptCommand).toHaveBeenCalledTimes(2)
    expect(daemonSeedScriptCommand).toHaveBeenNthCalledWith(
      2,
      { ssePort: 38989 },
      {
        command: 'sh',
        args: ['-lc', 'cat'],
        cwd: undefined,
        env: undefined,
        detach: true,
        stdin: true,
        requestId: expect.any(String),
      },
      undefined
    )
    expect(methods.runCommand).toHaveBeenCalledTimes(2)
  })

  it('sends stdin writes as base64 with base64 argv encoding', async () => {
    const state = { job: freshJob(), stdinWrites: [] as string[] }
    const { provider } = makeSandbox(state)
    const sandbox = await provider.sandbox.create()

    const proc = await sandbox.startProcess('cat', { stdin: true })
    await proc.write('hi\n')
    await proc.write(new Uint8Array([104, 105]))

    expect(state.stdinWrites).toEqual(['hi\n', 'hi'])
    expect(daemonSeedScriptCommand).toHaveBeenCalledWith(
      { ssePort: 38989 },
      { stdin: 'job-1', data: Buffer.from('hi\n').toString('base64'), encoding: 'base64' },
      { argvEncoding: 'base64' }
    )
  })

  it('falls back to polling, delivers stdout diffs sequentially, and fires onExit once', async () => {
    const state: FakeState = {
      job: freshJob(),
      stdinWrites: [] as string[],
      // Slow statuses + a fast poll interval would overlap under setInterval;
      // the sequential loop must never run two status requests at once.
      statusDelayMs: 30,
      statusSnapshots: [
        { stdout: 'a\n' },
        { stdout: 'a\nb\n' },
        { stdout: 'a\nb\n', status: 'exited' as const, exitCode: 0 },
      ] as Partial<JobState>[],
    }
    const { provider } = makeSandbox(state)
    const sandbox = await provider.sandbox.create()

    const chunks: string[] = []
    const onExit = vi.fn()
    const proc = await sandbox.startProcess('yes', {
      onStdout: (c) => chunks.push(c),
      onExit,
      pollIntervalMs: 5,
    })

    const result = await proc.wait()
    // Let the polling loop observe the exited snapshot.
    await new Promise((r) => setTimeout(r, 150))

    expect(chunks.join('')).toBe('a\nb\n')
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(onExit).toHaveBeenCalledWith({ exitCode: 0, signal: null })
    expect(result.exitCode).toBe(0)
    expect(state.maxStatusInFlight ?? 0).toBeLessThanOrEqual(1)
  })

  it('drives callbacks from status snapshots when SSE opens', async () => {
    const state = {
      job: freshJob(),
      stdinWrites: [] as string[],
      statusSnapshots: [
        { stdout: 'a\n' },
        { stdout: 'a\nb\n' },
        { stdout: 'a\nb\n', status: 'exited' as const, exitCode: 0 },
      ] as Partial<JobState>[],
      getUrl: vi.fn().mockResolvedValue('https://derived.mock.dev'),
    }
    const { provider } = makeSandbox(state)
    const sandbox = await provider.sandbox.create()

    let streamController!: ReadableStreamDefaultController<Uint8Array>
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start: (c) => {
        streamController = c
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, body }) as unknown as Response)
    )

    const chunks: string[] = []
    const onExit = vi.fn()
    await sandbox.startProcess('yes', {
      onStdout: (c) => chunks.push(c),
      onExit,
      pollIntervalMs: 5,
    })

    // Let the stream open (fires the initial flush refresh).
    await new Promise((r) => setTimeout(r, 30))
    streamController.enqueue(
      encoder.encode('data: {"type":"command.stdout","jobId":"job-1","chunk":"junk"}\n\n')
    )
    await new Promise((r) => setTimeout(r, 30))
    streamController.enqueue(
      encoder.encode('data: {"type":"command.exit","jobId":"job-1","exitCode":0,"signal":null}\n\n')
    )
    await new Promise((r) => setTimeout(r, 100))
    streamController.close()

    // Chunks come from status snapshots, not the SSE chunk payload.
    expect(chunks).toEqual(['a\n', 'b\n'])
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(onExit).toHaveBeenCalledWith({ exitCode: 0, signal: null })
  })

  it('starts polling when the SSE stream never opens', async () => {
    vi.useFakeTimers()
    try {
      const state = {
        job: freshJob(),
        stdinWrites: [] as string[],
        statusSnapshots: [{ stdout: 'a\n', status: 'exited' as const, exitCode: 0 }] as Partial<JobState>[],
        getUrl: vi.fn().mockResolvedValue('https://derived.mock.dev'),
      }
      const { methods, provider } = makeSandbox(state)
      const sandbox = await provider.sandbox.create()

      // fetch never resolves on its own — the open timer must cut over to
      // polling. It honors the AbortSignal like a real fetch.
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url: unknown, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
            })
        )
      )

      const chunks: string[] = []
      const onExit = vi.fn()
      await sandbox.startProcess('yes', {
        onStdout: (c) => chunks.push(c),
        onExit,
        pollIntervalMs: 5,
      })

      await vi.advanceTimersByTimeAsync(5100)

      const statusCalls = methods.runCommand.mock.calls.filter(([, cmd]) => {
        try {
          return typeof JSON.parse(cmd as string).status === 'string'
        } catch {
          return false
        }
      })
      expect(statusCalls.length).toBeGreaterThan(0)
      expect(chunks.join('')).toBe('a\n')
      expect(onExit).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects wait when the timeout elapses before exit', async () => {
    const state = { job: freshJob(), stdinWrites: [] as string[], waitReturnsRunning: true }
    const { provider } = makeSandbox(state)
    const sandbox = await provider.sandbox.create()

    const proc = await sandbox.startProcess('sleep 60')
    await expect(proc.wait({ timeout: 100 })).rejects.toThrow(/daemond:.*did not exit/)
  })

  it('sends kill with the requested signal', async () => {
    const state = { job: freshJob(), stdinWrites: [] as string[] }
    const { provider } = makeSandbox(state)
    const sandbox = await provider.sandbox.create()

    const proc = await sandbox.startProcess('sleep 60')
    await proc.kill('SIGKILL')

    expect(daemonSeedScriptCommand).toHaveBeenCalledWith(
      { ssePort: 38989 },
      { kill: 'job-1', signal: 'SIGKILL' },
      undefined
    )
  })

  it('rejects with a daemond-prefixed error when bootstrap fails', async () => {
    const state = { job: freshJob(), stdinWrites: [] as string[], failBootstrap: true }
    const { provider } = makeSandbox(state)
    const sandbox = await provider.sandbox.create()

    await expect(sandbox.startProcess('cat')).rejects.toThrow(/^daemond:/)
  })

  it('rejects writes when the daemon reports the job exited', async () => {
    const state = {
      job: freshJob(),
      stdinWrites: [] as string[],
      failRequests: { stdin: { exitCode: 1, stderr: 'seed daemon: job job-1 has exited' } },
    }
    const { provider } = makeSandbox(state)
    const sandbox = await provider.sandbox.create()

    const proc = await sandbox.startProcess('cat', { stdin: true })
    await expect(proc.write('x')).rejects.toThrow(/has exited/)
  })
})
