import { describe, it, expect, vi, afterEach } from 'vitest'
import { defineProvider } from '../factory.js'
import { EGRESS_SHIM_DIR } from '../egress.js'
import type { CommandResult, FileEntry, SandboxInfo } from '../types/index.js'

const { daemonSeedScriptCommand, egressShimScript } = vi.hoisted(() => ({
  daemonSeedScriptCommand: vi.fn(),
  egressShimScript: vi.fn(() => '// shim source'),
}))

vi.mock('daemond', () => ({
  daemonSeedScriptCommand,
  egressShimScript,
  parseSeedInvocationOutput: (raw: string) =>
    JSON.parse(raw.trim().split('\n').filter(Boolean).pop()!),
}))

afterEach(() => {
  vi.resetAllMocks()
  egressShimScript.mockImplementation(() => '// shim source')
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
  filesystem?: {
    written: Map<string, string>
    failOn?: string
  }
}

function makeMethods(state: FakeState) {
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
    stdoutBytes: Buffer.byteLength(state.job.stdout),
    stderrBytes: Buffer.byteLength(state.job.stderr),
  })

  const respond = (cmd: Record<string, unknown>): CommandResult => ({
    stdout: JSON.stringify({
      token: 'tok',
      requestId: 'req',
      daemon: { reused: false, pid: 1, sseUrl: 'http://127.0.0.1:38989/events?token=tok' },
      command: cmd,
    }),
    stderr: '',
    exitCode: 0,
    durationMs: 1,
  })

  const filesystem = state.filesystem
    ? (() => {
        const fsState = state.filesystem!
        const maybeFail = (path: string) => {
          if (fsState.failOn && path.includes(fsState.failOn)) {
            throw new Error('write denied')
          }
        }
        return {
          readFile: vi.fn(async () => ''),
          writeFile: vi.fn(async (_s: unknown, path: string, content: string) => {
            maybeFail(path)
            fsState.written.set(path, content)
          }),
          mkdir: vi.fn(async () => {}),
          readdir: vi.fn(async () => [] as FileEntry[]),
          exists: vi.fn(async () => false),
          remove: vi.fn(async () => {}),
        }
      })()
    : undefined

  return {
    create: vi.fn().mockResolvedValue({
      sandbox: { id: 'test-egress', status: 'running' },
      sandboxId: 'test-egress',
    }),
    getById: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    destroy: vi.fn().mockResolvedValue(undefined),
    runCommand: vi.fn(async (_sandbox: unknown, command: string): Promise<CommandResult> => {
      const payload = JSON.parse(command)
      if (typeof payload.status === 'string') {
        return respond(jobSnapshot())
      }
      if (payload.detach === true) {
        return respond(jobSnapshot())
      }
      return respond({ exitCode: 0, signal: null, stdout: '', stderr: '', combined: '' })
    }),
    getInfo: vi.fn().mockResolvedValue({
      id: 'test-egress',
      provider: 'mock',
      status: 'running',
      createdAt: new Date(),
      timeout: 300000,
    } as SandboxInfo),
    getUrl: async () => { throw new Error('port not exposed') },
    filesystem,
  }
}

function freshJob(): JobState {
  return {
    jobId: 'job-egress',
    pid: 42,
    stdout: 'EGRESS_READY {"port":43111,"caCertPath":"/tmp/computesdk-egress/ca.pem"}\n',
    stderr: '',
    status: 'running',
    exitCode: null,
    signal: null,
  }
}

const EGRESS = {
  injectorUrl: 'https://platform.example.com/api/ci/cred-proxy',
  injectorToken: 'run-token-1',
  credentialedHosts: ['api.openai.com', '*.github.com'],
}

function makeSandbox(state: FakeState, withFilesystem = true) {
  const methods = makeMethods(state)
  daemonSeedScriptCommand.mockImplementation((_config: unknown, payload: unknown) =>
    typeof payload === 'string' ? payload : JSON.stringify(payload)
  )
  const provider = defineProvider({ name: 'mock', methods: { sandbox: methods } })({ apiKey: 'k' })
  return { methods, provider, withFilesystem }
}

describe('egress router setup', () => {
  it('writes shim + config, starts the router, and exposes sandbox.egress', async () => {
    const state = { job: freshJob(), filesystem: { written: new Map<string, string>() } }
    const { provider } = makeSandbox(state)

    const sandbox = await provider.sandbox.create({ egress: EGRESS })

    expect(sandbox.egress).toEqual({
      proxyUrl: 'http://127.0.0.1:43111',
      caCertPath: '/tmp/computesdk-egress/ca.pem',
      port: 43111,
      processJobId: 'job-egress',
    })

    const written = state.filesystem.written
    expect(written.get(`${EGRESS_SHIM_DIR}/egress-shim.js`)).toBe('// shim source')
    const config = JSON.parse(written.get(`${EGRESS_SHIM_DIR}/config.json`) ?? '{}')
    expect(config).toEqual({
      injectorUrl: EGRESS.injectorUrl,
      injectorToken: EGRESS.injectorToken,
      credentialedHosts: EGRESS.credentialedHosts,
      mode: 'passthrough',
      port: 0,
    })

    // Router started through startProcess → bootstrap + detached exec.
    const execPayloads = daemonSeedScriptCommand.mock.calls
      .map(([, payload]) => payload as { detach?: boolean; args?: string[] })
      .filter((p) => p.detach === true)
    expect(execPayloads).toHaveLength(1)
    expect(execPayloads[0].args?.[1]).toContain('egress-shim.js')
    expect(execPayloads[0].args?.[1]).toContain('config.json')
  })

  it('leaves sandbox.egress unset without the option', async () => {
    const state = { job: freshJob(), filesystem: { written: new Map<string, string>() } }
    const { provider } = makeSandbox(state)
    const sandbox = await provider.sandbox.create()
    expect(sandbox.egress).toBeUndefined()
    expect(state.filesystem.written.size).toBe(0)
  })

  it('surfaces a router startup failure reported by the shim', async () => {
    const state = {
      job: { ...freshJob(), stdout: 'EGRESS_ERROR {"message":"openssl binary not found"}\n' },
      filesystem: { written: new Map<string, string>() },
    }
    const { provider } = makeSandbox(state)
    await expect(provider.sandbox.create({ egress: EGRESS })).rejects.toThrow(
      /egress: router failed to start: openssl binary not found/
    )
  })

  it('surfaces a shim that exits before becoming ready', async () => {
    const state = {
      job: { ...freshJob(), stdout: '', stderr: 'config is invalid', status: 'exited' as const, exitCode: 1 },
      filesystem: { written: new Map<string, string>() },
    }
    const { provider } = makeSandbox(state)
    await expect(provider.sandbox.create({ egress: EGRESS })).rejects.toThrow(
      /egress: router exited before becoming ready — config is invalid/
    )
  })

  it('wraps filesystem unsupported errors with the egress prefix', async () => {
    const state = { job: freshJob(), filesystem: { written: new Map<string, string>(), failOn: 'egress-shim.js' } }
    const { provider } = makeSandbox(state)
    await expect(provider.sandbox.create({ egress: EGRESS })).rejects.toThrow(
      /egress: provider "mock" cannot host the egress router — write denied/
    )
  })

  it('rejects invalid options before touching the sandbox', async () => {
    const state = { job: freshJob(), filesystem: { written: new Map<string, string>() } }
    const { provider } = makeSandbox(state)
    await expect(
      provider.sandbox.create({ egress: { ...EGRESS, credentialedHosts: [] } })
    ).rejects.toThrow(/egress: credentialedHosts must be a non-empty array/)
    await expect(
      provider.sandbox.create({ egress: { ...EGRESS, injectorUrl: 'ftp://x' } })
    ).rejects.toThrow(/egress: injectorUrl must be an http\(s\) URL/)
    expect(state.filesystem.written.size).toBe(0)
  })
})
