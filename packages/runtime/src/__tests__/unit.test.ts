import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  class NotFoundError extends Error {
    status = 404
    code = 'not_found'
  }

  type Call = { method: string; args: unknown[] }
  type ExecResult = {
    exitCode: number | null
    stdout: string
    stderr: string
    timedOut: boolean
    durationMs?: number
  }

  const state = {
    calls: [] as Call[],
    clientOptions: [] as Array<Record<string, unknown>>,
    states: new Map<string, string>(),
    missing: new Set<string>(),
    execResult: undefined as ExecResult | undefined,
    pages: [] as string[][],
    snapshotDeleteMissing: false,
    extraSnapshots: 0,
  }

  const record = (method: string, ...args: unknown[]) => state.calls.push({ method, args })

  const makeSandbox = (id: string) => {
    const info = () => ({
      id,
      kind: 'sandbox',
      name: 'named',
      labels: { team: 'a' },
      state: state.states.get(id) ?? 'running',
      region: 'us-east',
      vcpu: 2,
      memoryMiB: 4096,
      diskMiB: 10240,
      timeoutSeconds: 1800,
      createdAt: '2026-09-25T00:00:00.000Z',
      expiresAt: '2026-09-25T00:30:00.000Z',
    })
    const sandbox = {
      id,
      get state() {
        return info().state
      },
      get info() {
        return info()
      },
      refresh: vi.fn(async () => {
        record('refresh', id)
      }),
      waitFor: vi.fn(async (target: string) => {
        record('waitFor', id, target)
        state.states.set(id, target)
      }),
      stop: vi.fn(async () => {
        record('stop', id)
        state.states.set(id, 'stopped')
      }),
      exec: vi.fn(async (command: unknown, options: Record<string, unknown> = {}) => {
        record('exec', command, options)
        const onStdout = options.onStdout as ((text: string) => void) | undefined
        onStdout?.('ok\n')
        return (
          state.execResult ?? {
            exitCode: 0,
            stdout: 'ok\n',
            stderr: '',
            timedOut: false,
            durationMs: 7,
          }
        )
      }),
      spawn: vi.fn(async (command: unknown, options: Record<string, unknown> = {}) => {
        record('spawn', command, options)
        return { id: 'proc_1' }
      }),
      snapshot: vi.fn(async (options: Record<string, unknown>) => {
        record('snapshot', id, options)
        return {
          id: 'snap_1',
          name: options.name ?? null,
          state: 'capturing',
          sourceSandboxId: id,
          createdAt: '2026-09-25T01:00:00.000Z',
          readyAt: null,
          expiresAt: '2026-10-02T01:00:00.000Z',
        }
      }),
      previews: {
        create: vi.fn(async (port: number, input: Record<string, unknown>) => {
          record('previews.create', port, input)
          const url = `https://${port}-${id}.runtimehost.com/`
          return input.visibility === 'public'
            ? { url, token: null, urlWithToken: null }
            : { url, token: 'tok', urlWithToken: `${url}?runtime_preview_token=tok` }
        }),
      },
      files: {
        readText: vi.fn(async (path: string) => {
          record('files.readText', path)
          if (path.startsWith('/nonexistent')) throw new NotFoundError('No such file.')
          return 'content'
        }),
        write: vi.fn(async (path: string, data: string) => record('files.write', path, data)),
        mkdir: vi.fn(async (path: string, options: unknown) =>
          record('files.mkdir', path, options),
        ),
        list: vi.fn(async (path: string) => {
          record('files.list', path)
          return [
            {
              name: 'a.txt',
              path: `${path}/a.txt`,
              type: 'file',
              size: 3,
              mode: '0644',
              modifiedAt: '2026-09-25T00:00:00.000Z',
            },
            {
              name: 'sub',
              path: `${path}/sub`,
              type: 'directory',
              size: 0,
              mode: '0755',
              modifiedAt: '2026-09-25T00:00:00.000Z',
            },
            {
              name: 'link',
              path: `${path}/link`,
              type: 'symlink',
              size: 4,
              mode: '0777',
              modifiedAt: '2026-09-25T00:00:00.000Z',
            },
          ]
        }),
        exists: vi.fn(async (path: string) => {
          record('files.exists', path)
          return path === '/tmp/there'
        }),
        remove: vi.fn(async (path: string, options: unknown) => {
          record('files.remove', path, options)
          return true
        }),
      },
    }
    return sandbox
  }

  class Runtime {
    sandboxes = {
      create: vi.fn(async (body: Record<string, unknown>, options: Record<string, unknown>) => {
        record('sandboxes.create', body, options)
        return makeSandbox('sbx_new')
      }),
      get: vi.fn(async (id: string) => {
        record('sandboxes.get', id)
        if (state.missing.has(id)) throw new NotFoundError('No such sandbox.')
        if (id === 'sbx_broken')
          throw Object.assign(new Error('Service unavailable.'), { status: 503 })
        return makeSandbox(id)
      }),
      list: vi.fn(async () => {
        record('sandboxes.list')
        return {
          async *[Symbol.asyncIterator]() {
            for (const ids of state.pages) for (const id of ids) yield makeSandbox(id)
          },
        }
      }),
    }
    snapshots = {
      list: vi.fn(async (filter: Record<string, unknown>) => {
        record('snapshots.list', filter)
        const snapshot = (id: string) => ({
          id,
          name: id.slice(5),
          state: 'ready',
          sourceSandboxId: 'sbx_1',
          createdAt: '2026-09-25T02:00:00.000Z',
          readyAt: '2026-09-25T02:00:05.000Z',
          expiresAt: '2026-10-02T02:00:00.000Z',
        })
        return {
          async *[Symbol.asyncIterator]() {
            yield snapshot('snap_a')
            for (let n = 0; n < state.extraSnapshots; n++) yield snapshot(`snap_${n}`)
          },
        }
      }),
      delete: vi.fn(async (id: string) => {
        record('snapshots.delete', id)
        if (state.snapshotDeleteMissing) throw new NotFoundError('No such snapshot.')
      }),
    }
    constructor(options: Record<string, unknown>) {
      state.clientOptions.push(options)
    }
  }

  return { NotFoundError, Runtime, state }
})

vi.mock('withruntime', () => ({ Runtime: h.Runtime, NotFoundError: h.NotFoundError }))

import { runtime } from '../index'

function provider(config: Parameters<typeof runtime>[0] = {}) {
  return runtime({ apiKey: 'rk_test', ...config })
}

const calls = (method: string) => h.state.calls.filter((call) => call.method === method)

beforeEach(() => {
  h.state.calls = []
  h.state.clientOptions = []
  h.state.states.clear()
  h.state.missing.clear()
  h.state.execResult = undefined
  h.state.pages = []
  h.state.snapshotDeleteMissing = false
  h.state.extraSnapshots = 0
})

describe('create', () => {
  it('maps ComputeSDK options onto Runtime create fields', async () => {
    const controller = new AbortController()
    const sandbox = await provider({
      create: { region: 'us-east', vcpu: 1, labels: { team: 'agents' }, funding: 'trial' },
    }).sandbox.create({
      templateId: 'node-22',
      name: 'worker-1',
      metadata: { job: 'build', attempt: 2 },
      timeout: 90_500,
      vcpus: 4,
      memoryMiB: 8192,
      diskMiB: 20480,
      signal: controller.signal,
    })

    expect(sandbox.sandboxId).toBe('sbx_new')
    expect(sandbox.provider).toBe('runtime')
    const [body, options] = calls('sandboxes.create')[0].args
    expect(body).toEqual({
      region: 'us-east',
      funding: 'trial',
      image: 'node-22',
      name: 'worker-1',
      labels: { team: 'agents', job: 'build', attempt: '2' },
      timeoutSeconds: 91,
      vcpu: 4,
      memoryMiB: 8192,
      diskMiB: 20480,
    })
    expect(options).toEqual({ signal: controller.signal })
    expect(h.state.clientOptions).toEqual([{ apiKey: 'rk_test' }])
  })

  it('starts from a snapshot and drops a configured image', async () => {
    await provider({ create: { image: 'base' } }).sandbox.create({ snapshotId: 'snap_1' })
    expect(calls('sandboxes.create')[0].args[0]).toEqual({ snapshot: 'snap_1' })
  })

  it('refuses an image and a snapshot together before creating anything', async () => {
    await expect(
      provider().sandbox.create({ templateId: 'node-22', snapshotId: 'snap_1' }),
    ).rejects.toThrow(/image or a snapshot, not both/)
    expect(calls('sandboxes.create')).toHaveLength(0)
  })

  it('rejects invalid environment variable names before creating anything', async () => {
    await expect(provider().sandbox.create({ envs: { 'BAD-NAME': 'x' } })).rejects.toThrow(
      /Invalid environment variable name/,
    )
    expect(calls('sandboxes.create')).toHaveLength(0)
  })

  it('rejects a non-positive timeout before creating anything', async () => {
    await expect(provider().sandbox.create({ timeout: 0 })).rejects.toThrow(/positive finite/)
    expect(calls('sandboxes.create')).toHaveLength(0)
  })

  it('reuses one client per provider', async () => {
    const compute = provider()
    await compute.sandbox.create()
    await compute.sandbox.create()
    expect(h.state.clientOptions).toHaveLength(1)
  })
})

describe('runCommand', () => {
  it('applies create-time envs to every command, under the command env', async () => {
    const sandbox = await provider().sandbox.create({ envs: { A: '1', B: '2' } })
    await sandbox.runCommand('echo "$A $B"', {
      env: { B: 'override' },
      cwd: '/workspace',
      timeout: 5_000,
    })

    expect(calls('exec')[0].args).toEqual([
      'echo "$A $B"',
      { cwd: '/workspace', env: { A: '1', B: 'override' }, timeoutMs: 5_000 },
    ])
  })

  it('does not carry create-time envs to a sandbox reached by getById', async () => {
    const sandbox = await provider().sandbox.getById('sbx_other')
    await sandbox?.runCommand('true')
    expect(calls('exec')[0].args).toEqual(['true', {}])
  })

  it('reports a timed-out command as exit code 124', async () => {
    h.state.execResult = {
      exitCode: null,
      stdout: 'starting\n',
      stderr: '',
      timedOut: true,
      durationMs: 5_001,
    }
    const sandbox = await provider().sandbox.create()
    const result = await sandbox.runCommand('sleep 60', { timeout: 5_000 })
    expect(result).toEqual({ stdout: 'starting\n', stderr: '', exitCode: 124, durationMs: 5_001 })
  })

  it('reports 124 for a timed-out command that Runtime killed (exit code -9)', async () => {
    // What the live API returned on 25 September 2026 for `sleep 5` with a 1 s timeout.
    h.state.execResult = { exitCode: -9, stdout: '', stderr: '', timedOut: true, durationMs: 1_013 }
    const sandbox = await provider().sandbox.create()
    expect((await sandbox.runCommand('sleep 5', { timeout: 1_000 })).exitCode).toBe(124)
  })

  it('reports a command killed by a signal as 128 plus the signal, as a shell does', async () => {
    // `sh -c 'kill -TERM $$'` on the live API: exit code -15, not timed out.
    h.state.execResult = { exitCode: -15, stdout: '', stderr: '', timedOut: false, durationMs: 2 }
    const sandbox = await provider().sandbox.create()
    expect((await sandbox.runCommand("sh -c 'kill -TERM $$'")).exitCode).toBe(143)
  })

  it('keeps a non-zero exit code', async () => {
    h.state.execResult = {
      exitCode: 3,
      stdout: '',
      stderr: 'err\n',
      timedOut: false,
      durationMs: 4,
    }
    const sandbox = await provider().sandbox.create()
    expect((await sandbox.runCommand('exit 3')).exitCode).toBe(3)
  })

  it('starts background commands as Runtime processes', async () => {
    const sandbox = await provider().sandbox.create({ envs: { A: '1' } })
    const result = await sandbox.runCommand('sleep 1', { background: true })

    expect(result.exitCode).toBe(0)
    expect(calls('exec')).toHaveLength(0)
    expect(calls('spawn')[0].args).toEqual(['sleep 1', { env: { A: '1' } }])
  })

  it('streams through Runtime rather than the in-sandbox bridge', async () => {
    const sandbox = await provider().sandbox.create()
    const chunks: string[] = []
    const result = await sandbox.runCommand('printf ok', { onStdout: (text) => chunks.push(text) })

    expect(chunks).toEqual(['ok\n'])
    expect(result.stdout).toBe('ok\n')
    // One call: the command itself, with no daemon bootstrap before it.
    expect(calls('exec')).toHaveLength(1)
    expect(calls('exec')[0].args[0]).toBe('printf ok')
  })

  it('rejects invalid timeouts before contacting Runtime', async () => {
    const sandbox = await provider().sandbox.create()
    await expect(sandbox.runCommand('true', { timeout: Number.NaN })).rejects.toThrow(
      /positive finite/,
    )
    await expect(sandbox.runCommand('true', { timeout: 86_400_001 })).rejects.toThrow(/24 hours/)
    expect(calls('exec')).toHaveLength(0)
  })
})

describe('lifecycle', () => {
  it('returns null for a missing or stopped sandbox and rethrows other failures', async () => {
    h.state.missing.add('sbx_gone')
    h.state.states.set('sbx_stopped', 'stopped')
    const compute = provider()

    await expect(compute.sandbox.getById('sbx_gone')).resolves.toBeNull()
    await expect(compute.sandbox.getById('sbx_stopped')).resolves.toBeNull()
    await expect(compute.sandbox.getById('sbx_broken')).rejects.toThrow(/Service unavailable/)
    expect((await compute.sandbox.getById('sbx_live'))?.sandboxId).toBe('sbx_live')
  })

  it('stops a running sandbox and treats a missing or stopped one as destroyed', async () => {
    h.state.missing.add('sbx_gone')
    h.state.states.set('sbx_stopped', 'stopped')
    h.state.states.set('sbx_stopping', 'stopping')
    const compute = provider()

    await compute.sandbox.destroy('sbx_gone')
    await compute.sandbox.destroy('sbx_stopped')
    await compute.sandbox.destroy('sbx_stopping')
    await compute.sandbox.destroy('sbx_live')

    expect(calls('stop').map((call) => call.args[0])).toEqual(['sbx_live'])
    expect(calls('waitFor')[0].args).toEqual(['sbx_stopping', 'stopped'])
  })

  it('lists every live sandbox across pages', async () => {
    h.state.pages = [['sbx_1', 'sbx_2'], ['sbx_3']]
    const listed = await provider().sandbox.list()
    expect(listed.map((entry) => entry.sandboxId)).toEqual(['sbx_1', 'sbx_2', 'sbx_3'])
  })

  it('maps Runtime states and fields into getInfo', async () => {
    const sandbox = await provider().sandbox.create({ timeout: 60_000 })
    h.state.states.set('sbx_new', 'paused')
    const info = await sandbox.getInfo()

    expect(info).toMatchObject({
      id: 'sbx_new',
      provider: 'runtime',
      status: 'stopped',
      timeout: 60_000,
      metadata: { state: 'paused', region: 'us-east', vcpu: 2, memoryMiB: 4096 },
    })
    expect(info.createdAt.toISOString()).toBe('2026-09-25T00:00:00.000Z')

    h.state.states.set('sbx_new', 'resuming')
    expect((await sandbox.getInfo()).status).toBe('running')
  })

  it('reports the lease Runtime was given, rounded up to whole seconds', async () => {
    const sandbox = await provider().sandbox.create({ timeout: 1_500 })
    const [body] = calls('sandboxes.create')[0].args as [{ timeoutSeconds?: number }]
    expect(body.timeoutSeconds).toBe(2)
    expect((await sandbox.getInfo()).timeout).toBe(2_000)
  })

  it('falls back to the sandbox lease for getInfo timeout', async () => {
    const sandbox = await provider().sandbox.getById('sbx_live')
    expect((await sandbox!.getInfo()).timeout).toBe(1_800_000)
  })
})

describe('getUrl', () => {
  it('returns a private preview link that carries its token', async () => {
    const sandbox = await provider({ previewTtlSeconds: 3600 }).sandbox.create()
    const url = await sandbox.getUrl({ port: 3000 })

    expect(url).toBe('https://3000-sbx_new.runtimehost.com/?runtime_preview_token=tok')
    expect(calls('previews.create')[0].args).toEqual([
      3000,
      { visibility: 'private', ttlSeconds: 3600 },
    ])
  })

  it('rewrites the scheme for another protocol', async () => {
    const sandbox = await provider().sandbox.create()
    expect(await sandbox.getUrl({ port: 8080, protocol: 'wss' })).toBe(
      'wss://8080-sbx_new.runtimehost.com/?runtime_preview_token=tok',
    )
  })

  it('shares a public preview when configured to', async () => {
    const sandbox = await provider({ previewVisibility: 'public' }).sandbox.create()
    expect(await sandbox.getUrl({ port: 3000 })).toBe('https://3000-sbx_new.runtimehost.com/')
    expect(calls('previews.create')[0].args).toEqual([3000, { visibility: 'public' }])
  })

  it('rejects an invalid port', async () => {
    const sandbox = await provider().sandbox.create()
    await expect(sandbox.getUrl({ port: 70_000 })).rejects.toThrow(/Invalid port/)
    expect(calls('previews.create')).toHaveLength(0)
  })
})

describe('filesystem', () => {
  it('uses Runtime file calls', async () => {
    const sandbox = await provider().sandbox.create()

    await sandbox.filesystem.writeFile('/tmp/a.txt', 'hello')
    expect(await sandbox.filesystem.readFile('/tmp/a.txt')).toBe('content')
    await sandbox.filesystem.mkdir('/tmp/deep/dir')
    expect(await sandbox.filesystem.exists('/tmp/there')).toBe(true)
    expect(await sandbox.filesystem.exists('/tmp/absent')).toBe(false)
    await sandbox.filesystem.remove('/tmp/dir')

    expect(calls('files.write')[0].args).toEqual(['/tmp/a.txt', 'hello'])
    expect(calls('files.mkdir')[0].args).toEqual(['/tmp/deep/dir', { parents: true }])
    expect(calls('files.remove')[0].args).toEqual(['/tmp/dir', { recursive: true }])
    expect(calls('exec')).toHaveLength(0)
  })

  it('maps directory entries', async () => {
    const sandbox = await provider().sandbox.create()
    const entries = await sandbox.filesystem.readdir('/tmp')
    expect(entries.map(({ name, type, size }) => ({ name, type, size }))).toEqual([
      { name: 'a.txt', type: 'file', size: 3 },
      { name: 'sub', type: 'directory', size: 0 },
      { name: 'link', type: 'file', size: 4 },
    ])
    expect(entries[0].modified).toEqual(new Date('2026-09-25T00:00:00.000Z'))
  })

  it('throws when a file is missing', async () => {
    const sandbox = await provider().sandbox.create()
    await expect(sandbox.filesystem.readFile('/nonexistent/file.txt')).rejects.toThrow(
      /No such file/,
    )
  })
})

describe('snapshots', () => {
  it('snapshots a sandbox with its name and metadata as labels', async () => {
    const snapshot = await provider().snapshot!.create('sbx_live', {
      name: 'base',
      metadata: { step: 'three' },
    })

    expect(calls('snapshot')[0].args).toEqual([
      'sbx_live',
      { name: 'base', labels: { step: 'three' } },
    ])
    expect(snapshot).toMatchObject({
      id: 'snap_1',
      provider: 'runtime',
      metadata: { name: 'base', state: 'capturing', sourceSandboxId: 'sbx_live' },
    })
  })

  it('lists snapshots filtered by sandbox', async () => {
    const snapshots = await provider().snapshot!.list({ sandboxId: 'sbx_1', limit: 5 })
    expect(calls('snapshots.list')[0].args).toEqual([{ sandboxId: 'sbx_1', limit: 5 }])
    expect(snapshots.map((snapshot) => snapshot.id)).toEqual(['snap_a'])
  })

  it('lists every snapshot when no limit is given, past 10,000', async () => {
    h.state.extraSnapshots = 10_000
    const snapshots = await provider().snapshot!.list()
    expect(snapshots).toHaveLength(10_001)
    expect(calls('snapshots.list')[0].args).toEqual([{}])
  })

  it('treats deleting a missing snapshot as done', async () => {
    h.state.snapshotDeleteMissing = true
    await expect(provider().snapshot!.delete('snap_gone')).resolves.toBeUndefined()
  })
})
