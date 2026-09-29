import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  class NotFoundError extends Error {
    status = 404
  }

  type Call = { method: string; args: unknown[] }

  const state = {
    calls: [] as Call[],
    clientOptions: [] as Array<Record<string, unknown>>,
    statuses: new Map<string, string>(),
    missing: new Set<string>(),
    listPages: [] as Array<{ runtimes: Array<{ runtimeId: string }>; total: number }>,
    listOffset: 0,
    getMissingAfterList: new Set<string>(),
    cmdResult: {
      stdout: 'ok\n',
      stderr: '',
      exitCode: 0,
      durationMs: 7 as number | undefined,
    },
    snapshotDeleteMissing: false,
    templateDeleteMissing: false,
    blankServiceUrl: false,
    snapshotPages: [] as Array<{
      snapshots: Array<{
        id: string
        name: string
        state: string
        kind: string
        createdAt: string
      }>
      total: number
    }>,
    snapshotOffset: 0,
    templatePages: [] as Array<{
      templates: Array<{ id: string; name: string; createdAt: string }>
    }>,
    templateOffset: 0,
    builders: [] as MockBuilder[],
  }

  const record = (method: string, ...args: unknown[]) => state.calls.push({ method, args })

  class MockBuilder {
    name: string
    description: string
    image?: string
    dockerfileContent?: string
    runs: string[] = []
    vcpuCount?: number
    memoryMb?: number
    diskMb?: number
    tagValues?: Record<string, string>

    constructor(name: string, description = '') {
      this.name = name
      this.description = description
      state.builders.push(this)
    }

    fromImage(image: string) {
      this.image = image
      return this
    }

    dockerfile(content: string) {
      this.dockerfileContent = content
      return this
    }

    run(command: string) {
      this.runs.push(command)
      return this
    }

    vcpu(count: number) {
      this.vcpuCount = count
      return this
    }

    memory(mb: number) {
      this.memoryMb = mb
      return this
    }

    disk(mb: number) {
      this.diskMb = mb
      return this
    }

    tags(values: Record<string, string>) {
      this.tagValues = values
      return this
    }
  }

  const makeSandbox = (id: string) => {
    const info = () => ({
      runtimeId: id,
      status: state.statuses.get(id) ?? 'running',
      startedAt: '2026-09-25T00:00:00.000Z',
      timeoutAt: '2026-09-25T00:30:00.000Z',
      metadata: { team: 'agents' },
      template: 'base-small',
    })

    const sandbox = {
      runtimeId: id,
      get status() {
        return info().status
      },
      get info() {
        return info()
      },
      get startedAt() {
        return info().startedAt
      },
      get timeoutAt() {
        return info().timeoutAt
      },
      get metadata() {
        return info().metadata
      },
      refresh: vi.fn(async () => {
        record('refresh', id)
      }),
      runCmd: vi.fn(async (command: string, options: Record<string, unknown> = {}) => {
        record('runCmd', command, options)
        const onStdout = options.onStdout as ((chunk: string) => void) | undefined
        if (onStdout && !options.background) onStdout('ok\n')
        if (options.background) return { id: 'cmd_1' }
        return { ...state.cmdResult }
      }),
      service: vi.fn(async (port: number) => {
        record('service', port)
        return { url: state.blankServiceUrl ? '' : `https://${port}-${id}.example.com/` }
      }),
      file: {
        read: vi.fn(async (path: string) => {
          record('file.read', path)
          return { content: 'content' }
        }),
        write: vi.fn(async (path: string, content: string) => {
          record('file.write', path, content)
        }),
        createDirectory: vi.fn(async (path: string) => {
          record('file.createDirectory', path)
        }),
        list: vi.fn(async (path: string) => {
          record('file.list', path)
          return {
            files: [
              {
                name: 'a.txt',
                size: 3,
                isDir: false,
                modifiedAt: '2026-09-25T00:00:00.000Z',
              },
              {
                name: 'sub',
                size: 0,
                isDir: true,
                modifiedAt: '2026-09-25T00:00:00.000Z',
              },
              {
                name: 'bad',
                size: 1,
                isDir: false,
                modifiedAt: 'not-a-date',
              },
            ],
          }
        }),
        getInfo: vi.fn(async (path: string) => {
          record('file.getInfo', path)
          return { exists: path === '/tmp/there' }
        }),
        delete: vi.fn(async (path: string) => {
          record('file.delete', path)
        }),
      },
    }
    return sandbox
  }

  class GravixLayer {
    runtime = {
      create: vi.fn(async (body: Record<string, unknown>) => {
        record('runtime.create', body)
        return makeSandbox('rt_new')
      }),
      get: vi.fn(async (id: string) => {
        record('runtime.get', id)
        if (state.missing.has(id) || state.getMissingAfterList.has(id)) {
          throw new NotFoundError('No such runtime.')
        }
        if (id === 'rt_broken') {
          throw Object.assign(new Error('Service unavailable.'), { status: 503 })
        }
        return makeSandbox(id)
      }),
      list: vi.fn(async (opts: { limit?: number; offset?: number } = {}) => {
        record('runtime.list', opts)
        const page = state.listPages[state.listOffset] ?? { runtimes: [], total: 0 }
        state.listOffset += 1
        return page
      }),
      kill: vi.fn(async (id: string) => {
        record('runtime.kill', id)
        if (state.missing.has(id)) throw new NotFoundError('No such runtime.')
      }),
    }
    snapshots = {
      create: vi.fn(async (runtimeId: string, name: string, options: Record<string, unknown> = {}) => {
        record('snapshots.create', runtimeId, name, options)
        return {
          id: 'snap_1',
          name,
          state: 'ready',
          kind: 'cold',
          createdAt: '2026-09-25T01:00:00.000Z',
        }
      }),
      list: vi.fn(async (opts: Record<string, unknown> = {}) => {
        record('snapshots.list', opts)
        const page = state.snapshotPages[state.snapshotOffset] ?? {
          snapshots: [],
          total: 0,
          limit: 0,
          offset: 0,
        }
        state.snapshotOffset += 1
        return page
      }),
      delete: vi.fn(async (id: string) => {
        record('snapshots.delete', id)
        if (state.snapshotDeleteMissing) throw new NotFoundError('No such snapshot.')
      }),
    }
    templates = {
      buildAndWait: vi.fn(async (builder: MockBuilder) => {
        record('templates.buildAndWait', builder)
        return { templateId: 'tpl_1', buildId: 'build_1', status: 'completed', phase: 'completed' }
      }),
      list: vi.fn(async (opts: Record<string, unknown> = {}) => {
        record('templates.list', opts)
        const page = state.templatePages[state.templateOffset] ?? {
          templates: [],
          limit: 0,
          offset: 0,
        }
        state.templateOffset += 1
        return page
      }),
      delete: vi.fn(async (id: string) => {
        record('templates.delete', id)
        if (state.templateDeleteMissing) throw new NotFoundError('No such template.')
      }),
    }

    constructor(options: Record<string, unknown>) {
      state.clientOptions.push(options)
    }
  }

  return { NotFoundError, GravixLayer, TemplateBuilder: MockBuilder, state }
})

vi.mock('gravixlayer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('gravixlayer')>()
  return {
    GravixLayer: h.GravixLayer,
    TemplateBuilder: h.TemplateBuilder,
    Runtime: actual.Runtime,
  }
})

import { clearGravixLayerClients, gravixlayer } from '../index'

function provider(config: Parameters<typeof gravixlayer>[0] = {}) {
  return gravixlayer({ apiKey: 'gk_test', ...config })
}

const calls = (method: string) => h.state.calls.filter((call) => call.method === method)

beforeEach(() => {
  clearGravixLayerClients()
  h.state.calls = []
  h.state.clientOptions = []
  h.state.statuses.clear()
  h.state.missing.clear()
  h.state.listPages = []
  h.state.listOffset = 0
  h.state.getMissingAfterList.clear()
  h.state.cmdResult = { stdout: 'ok\n', stderr: '', exitCode: 0, durationMs: 7 }
  h.state.snapshotDeleteMissing = false
  h.state.templateDeleteMissing = false
  h.state.blankServiceUrl = false
  h.state.snapshotPages = []
  h.state.snapshotOffset = 0
  h.state.templatePages = []
  h.state.templateOffset = 0
  h.state.builders = []
  delete process.env.GRAVIXLAYER_API_KEY
  delete process.env.GRAVIXLAYER_BASE_URL
  delete process.env.GRAVIXLAYER_CLOUD
  delete process.env.GRAVIXLAYER_REGION
})

describe('client', () => {
  it('does not throw at factory time when the key is missing', () => {
    expect(() => gravixlayer({})).not.toThrow()
  })

  it('throws a helpful error naming apiKey and GRAVIXLAYER_API_KEY on first use', async () => {
    await expect(gravixlayer({}).sandbox.create()).rejects.toThrow(
      /apiKey.*GRAVIXLAYER_API_KEY|GRAVIXLAYER_API_KEY.*apiKey/,
    )
    await expect(gravixlayer({}).sandbox.create()).rejects.toThrow(/gravixlayer\.ai/i)
    await expect(gravixlayer({ apiKey: '   ' }).sandbox.create()).rejects.toThrow(/apiKey/)
  })

  it('prefers an explicit apiKey over the env var and caches by resolved identity', async () => {
    process.env.GRAVIXLAYER_API_KEY = 'gk_env'
    const a = gravixlayer({ apiKey: 'gk_same' })
    const b = gravixlayer({ apiKey: 'gk_same' })
    await a.sandbox.create()
    await b.sandbox.create()
    expect(h.state.clientOptions).toHaveLength(1)
    expect(h.state.clientOptions[0]).toEqual({
      apiKey: 'gk_same',
      maxRetries: 0,
      http2: true,
    })

    await gravixlayer({ apiKey: 'gk_other' }).sandbox.create()
    expect(h.state.clientOptions).toHaveLength(2)
    expect(h.state.clientOptions[1]).toMatchObject({ apiKey: 'gk_other' })
  })

  it('passes overridden maxRetries and http2 into the constructor', async () => {
    await gravixlayer({ apiKey: 'gk_test', maxRetries: 2, http2: false }).sandbox.create()
    expect(h.state.clientOptions[0]).toEqual({
      apiKey: 'gk_test',
      maxRetries: 2,
      http2: false,
    })
  })

  it('passes optional baseUrl, cloud, region, and timeout when set', async () => {
    await gravixlayer({
      apiKey: 'gk_test',
      baseUrl: 'https://example.test',
      cloud: 'aws',
      region: 'us-east-1',
      timeout: 30_000,
    }).sandbox.create()
    expect(h.state.clientOptions[0]).toEqual({
      apiKey: 'gk_test',
      baseUrl: 'https://example.test',
      cloud: 'aws',
      region: 'us-east-1',
      timeout: 30_000,
      maxRetries: 0,
      http2: true,
    })
  })

  it('rejects a negative timeout and a fractional maxRetries before opening a client', async () => {
    await expect(gravixlayer({ apiKey: 'gk_test', timeout: -1 }).sandbox.create()).rejects.toThrow(
      /timeout must be a non-negative finite/,
    )
    await expect(
      gravixlayer({ apiKey: 'gk_test', maxRetries: 1.5 }).sandbox.create(),
    ).rejects.toThrow(/maxRetries must be a non-negative integer/)
    expect(h.state.clientOptions).toHaveLength(0)
  })
})

describe('create', () => {
  it('maps templateId, envs, timeout, metadata, and signal', async () => {
    const controller = new AbortController()
    const sandbox = await provider().sandbox.create({
      templateId: 'base-small',
      envs: { FOO: 'bar' },
      timeout: 90_500,
      metadata: { job: 'build' },
      signal: controller.signal,
      name: 'ignored',
      cpu: 99,
      memory: 999,
    })

    expect(sandbox.sandboxId).toBe('rt_new')
    expect(sandbox.provider).toBe('gravixlayer')
    expect(calls('runtime.create')[0].args[0]).toEqual({
      template: 'base-small',
      envVars: { FOO: 'bar' },
      timeoutSeconds: 91,
      timeout: 180_000,
      metadata: { job: 'build' },
      signal: controller.signal,
    })
  })

  it('starts from a snapshot without sending a template', async () => {
    await provider().sandbox.create({ snapshotId: 'snap_1' })
    expect(calls('runtime.create')[0].args[0]).toEqual({ snapshot: 'snap_1' })
  })

  it('refuses a template and a snapshot together', async () => {
    await expect(
      provider().sandbox.create({ templateId: 'base-small', snapshotId: 'snap_1' }),
    ).rejects.toThrow(/template or a snapshot, not both/)
    expect(calls('runtime.create')).toHaveLength(0)
  })

  it('rejects invalid environment variable names before creating', async () => {
    await expect(provider().sandbox.create({ envs: { 'BAD-NAME': 'x' } })).rejects.toThrow(
      /Invalid environment variable name/,
    )
    expect(calls('runtime.create')).toHaveLength(0)
  })

  it('rejects a negative or non-finite timeout', async () => {
    await expect(provider().sandbox.create({ timeout: -1 })).rejects.toThrow(/non-negative finite/)
    await expect(provider().sandbox.create({ timeout: Number.NaN })).rejects.toThrow(
      /non-negative finite/,
    )
    expect(calls('runtime.create')).toHaveLength(0)
  })

  it('allows a zero timeout and passes timeoutSeconds 0', async () => {
    await provider().sandbox.create({ timeout: 0 })
    expect(calls('runtime.create')[0].args[0]).toMatchObject({
      timeoutSeconds: 0,
      timeout: 180_000,
    })
  })

  it('does not disable the HTTP timeout when the provider sets one', async () => {
    await provider({ timeout: 5_000 }).sandbox.create({ templateId: 'base-small' })
    expect(calls('runtime.create')[0].args[0]).not.toHaveProperty('timeout')
  })

  it('leaves snapshot restore on the SDK timeout budget', async () => {
    await provider().sandbox.create({ snapshotId: 'snap_1' })
    expect(calls('runtime.create')[0].args[0]).not.toHaveProperty('timeout')
  })

  it('passes string cloud and region overrides on create', async () => {
    await provider().sandbox.create({ cloud: 'gcp', region: 'us-central1' })
    expect(calls('runtime.create')[0].args[0]).toMatchObject({
      cloud: 'gcp',
      region: 'us-central1',
    })
  })

  it('uses image when templateId is absent', async () => {
    await provider().sandbox.create({ image: 'node-22' })
    expect(calls('runtime.create')[0].args[0]).toMatchObject({ template: 'node-22' })
  })
})

describe('runCommand', () => {
  it('maps cwd, env, and timeout, and forwards server durationMs', async () => {
    const sandbox = await provider().sandbox.create()
    const result = await sandbox.runCommand('echo hi', {
      cwd: '/workspace',
      env: { A: '1' },
      timeout: 5_000,
    })

    expect(calls('runCmd')[0].args).toEqual([
      'echo hi',
      { workingDir: '/workspace', environment: { A: '1' }, timeoutSeconds: 5 },
    ])
    expect(result).toEqual({ stdout: 'ok\n', stderr: '', exitCode: 0, durationMs: 7 })
  })

  it('starts background commands and returns empty output with exitCode 0', async () => {
    const sandbox = await provider().sandbox.create()
    const result = await sandbox.runCommand('sleep 1', { background: true })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
    expect(calls('runCmd')[0].args[1]).toMatchObject({ background: true })
  })

  it('rejects background mode with streaming callbacks', async () => {
    const sandbox = await provider().sandbox.create()
    await expect(
      sandbox.runCommand('sleep 1', { background: true, onStdout: () => undefined }),
    ).rejects.toThrow(/streaming callbacks does not support background mode/)
    expect(calls('runCmd')).toHaveLength(0)
  })

  it('forwards onStdout and uses streamCommand through the sandbox', async () => {
    const sandbox = await provider().sandbox.create()
    const chunks: string[] = []
    const result = await sandbox.runCommand('printf ok', {
      onStdout: (text) => chunks.push(text),
    })

    expect(chunks).toEqual(['ok\n'])
    expect(result.stdout).toBe('ok\n')
    expect(calls('runCmd')[0].args[1]).toMatchObject({ onStdout: expect.any(Function) })
  })

  it('rejects invalid command env names before contacting the API', async () => {
    const sandbox = await provider().sandbox.create()
    await expect(sandbox.runCommand('true', { env: { '1bad': 'x' } })).rejects.toThrow(
      /Invalid environment variable name/,
    )
    expect(calls('runCmd')).toHaveLength(0)
  })

  it('falls back to local elapsed time when durationMs is missing', async () => {
    h.state.cmdResult = { stdout: '', stderr: '', exitCode: 0, durationMs: undefined }
    const sandbox = await provider().sandbox.create()
    const result = await sandbox.runCommand('true')
    expect(typeof result.durationMs).toBe('number')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })
})

describe('lifecycle', () => {
  it('returns null for 404 and terminated statuses, and rethrows other failures', async () => {
    h.state.missing.add('rt_gone')
    h.state.statuses.set('rt_terminated', 'terminated')
    h.state.statuses.set('rt_stopped', 'stopped')
    const compute = provider()

    await expect(compute.sandbox.getById('rt_gone')).resolves.toBeNull()
    await expect(compute.sandbox.getById('rt_terminated')).resolves.toBeNull()
    await expect(compute.sandbox.getById('rt_stopped')).resolves.toBeNull()
    await expect(compute.sandbox.getById('rt_broken')).rejects.toThrow(/Service unavailable/)
    expect((await compute.sandbox.getById('rt_live'))?.sandboxId).toBe('rt_live')
  })

  it('destroys via kill and treats 404 as success', async () => {
    h.state.missing.add('rt_gone')
    const compute = provider()
    await expect(compute.sandbox.destroy('rt_gone')).resolves.toBeUndefined()
    await compute.sandbox.destroy('rt_live')
    expect(calls('runtime.kill').map((call) => call.args[0])).toEqual(['rt_gone', 'rt_live'])
  })

  it('lists every runtime across pages without a follow-up get', async () => {
    const firstPageIds = Array.from({ length: 100 }, (_, i) => ({ runtimeId: `rt_${i}` }))
    h.state.listPages = [
      { runtimes: firstPageIds, total: 101 },
      { runtimes: [{ runtimeId: 'rt_last' }], total: 101 },
    ]

    const listed = await provider().sandbox.list()
    expect(listed).toHaveLength(101)
    expect(listed[0].sandboxId).toBe('rt_0')
    expect(listed[listed.length - 1].sandboxId).toBe('rt_last')
    expect(calls('runtime.list')).toHaveLength(2)
    expect(calls('runtime.get')).toHaveLength(0)
  })

  it('stops when a later page repeats an earlier runtime', async () => {
    const page = {
      runtimes: Array.from({ length: 100 }, (_, index) => ({ runtimeId: `rt_${index}` })),
      total: 10_000,
    }
    h.state.listPages = [page, page]

    const listed = await provider().sandbox.list()
    expect(listed).toHaveLength(100)
    expect(calls('runtime.list')).toHaveLength(2)
  })

  it('skips rows that have no runtime id', async () => {
    h.state.listPages = [
      { runtimes: [{ runtimeId: '' }, { runtimeId: 'rt_ok' }], total: 2 },
    ]

    const listed = await provider().sandbox.list()
    expect(listed.map((entry) => entry.sandboxId)).toEqual(['rt_ok'])
  })

  it('maps getInfo status, provider, and remembered timeout', async () => {
    const sandbox = await provider().sandbox.create({ timeout: 60_000 })
    h.state.statuses.set('rt_new', 'paused')
    const info = await sandbox.getInfo()

    expect(info).toMatchObject({
      id: 'rt_new',
      provider: 'gravixlayer',
      status: 'running',
      timeout: 60_000,
      metadata: { team: 'agents' },
    })
    expect(info.createdAt.toISOString()).toBe('2026-09-25T00:00:00.000Z')

    h.state.statuses.set('rt_new', 'failed')
    expect((await sandbox.getInfo()).status).toBe('error')

    h.state.statuses.set('rt_new', 'terminated')
    expect((await sandbox.getInfo()).status).toBe('stopped')
  })

  it('derives timeout from startedAt and timeoutAt when create timeout was not set', async () => {
    const sandbox = await provider().sandbox.getById('rt_live')
    expect((await sandbox!.getInfo()).timeout).toBe(1_800_000)
  })
})

describe('getUrl', () => {
  it('returns the published service URL and reuses it for the same port', async () => {
    const sandbox = await provider().sandbox.create()
    expect(await sandbox.getUrl({ port: 3000 })).toBe('https://3000-rt_new.example.com/')
    expect(await sandbox.getUrl({ port: 3000 })).toBe('https://3000-rt_new.example.com/')
    expect(calls('service')).toHaveLength(1)
    expect(calls('service')[0].args[0]).toBe(3000)
  })

  it('publishes a port once when getUrl is called concurrently', async () => {
    const sandbox = await provider().sandbox.create()
    const [first, second] = await Promise.all([
      sandbox.getUrl({ port: 3000 }),
      sandbox.getUrl({ port: 3000 }),
    ])
    expect(first).toBe('https://3000-rt_new.example.com/')
    expect(second).toBe(first)
    expect(calls('service')).toHaveLength(1)
  })

  it('retries a publish that returned an empty URL', async () => {
    h.state.blankServiceUrl = true
    const sandbox = await provider().sandbox.create()
    await expect(sandbox.getUrl({ port: 3000 })).rejects.toThrow(/did not return a URL/)
    h.state.blankServiceUrl = false
    expect(await sandbox.getUrl({ port: 3000 })).toBe('https://3000-rt_new.example.com/')
    expect(calls('service')).toHaveLength(2)
  })

  it('rewrites the protocol when requested', async () => {
    const sandbox = await provider().sandbox.create()
    expect(await sandbox.getUrl({ port: 8080, protocol: 'wss' })).toBe(
      'wss://8080-rt_new.example.com/',
    )
  })

  it('rejects an invalid port', async () => {
    const sandbox = await provider().sandbox.create()
    await expect(sandbox.getUrl({ port: 0 })).rejects.toThrow(/Invalid port/)
    await expect(sandbox.getUrl({ port: 70_000 })).rejects.toThrow(/Invalid port/)
    expect(calls('service')).toHaveLength(0)
  })
})

describe('filesystem', () => {
  it('uses the native file API', async () => {
    const sandbox = await provider().sandbox.create()

    await sandbox.filesystem.writeFile('/tmp/a.txt', 'hello')
    expect(await sandbox.filesystem.readFile('/tmp/a.txt')).toBe('content')
    await sandbox.filesystem.mkdir('/tmp/deep')
    expect(await sandbox.filesystem.exists('/tmp/there')).toBe(true)
    expect(await sandbox.filesystem.exists('/tmp/absent')).toBe(false)
    await sandbox.filesystem.remove('/tmp/dir')

    expect(calls('file.write')[0].args).toEqual(['/tmp/a.txt', 'hello'])
    expect(calls('file.read')[0].args).toEqual(['/tmp/a.txt'])
    expect(calls('file.createDirectory')[0].args).toEqual(['/tmp/deep'])
    expect(calls('file.getInfo')[0].args).toEqual(['/tmp/there'])
    expect(calls('file.delete')[0].args).toEqual(['/tmp/dir'])
    expect(calls('runCmd')).toHaveLength(0)
  })

  it('maps directory entries and omits invalid modified dates', async () => {
    const sandbox = await provider().sandbox.create()
    const entries = await sandbox.filesystem.readdir('/tmp')
    expect(entries.map(({ name, type, size }) => ({ name, type, size }))).toEqual([
      { name: 'a.txt', type: 'file', size: 3 },
      { name: 'sub', type: 'directory', size: 0 },
      { name: 'bad', type: 'file', size: 1 },
    ])
    expect(entries[0].modified).toEqual(new Date('2026-09-25T00:00:00.000Z'))
    expect(entries[2].modified).toBeUndefined()
  })
})

describe('snapshots', () => {
  it('requires a name and calls snapshots.create', async () => {
    await expect(provider().snapshot!.create('rt_live')).rejects.toThrow(
      /GravixLayer snapshots require a name/,
    )
    expect(calls('snapshots.create')).toHaveLength(0)

    const snapshot = await provider().snapshot!.create('rt_live', {
      name: 'warm',
      description: 'deps',
    } as { name: string; description: string })

    expect(calls('snapshots.create')[0].args).toEqual(['rt_live', 'warm', { description: 'deps' }])
    expect(snapshot).toMatchObject({
      id: 'snap_1',
      provider: 'gravixlayer',
      metadata: { name: 'warm', state: 'ready', kind: 'cold' },
    })
  })

  it('lists snapshots filtered by sandboxId as runtimeId', async () => {
    h.state.snapshotPages = [
      {
        snapshots: [
          {
            id: 'snap_a',
            name: 'a',
            state: 'ready',
            kind: 'cold',
            createdAt: '2026-09-25T02:00:00.000Z',
          },
        ],
        total: 1,
      },
    ]
    const snapshots = await provider().snapshot!.list({ sandboxId: 'rt_1', limit: 5 })
    expect(calls('snapshots.list')[0].args[0]).toEqual({
      limit: 5,
      offset: 0,
      runtimeId: 'rt_1',
    })
    expect(snapshots.map((s) => s.id)).toEqual(['snap_a'])
  })

  it('treats deleting a missing snapshot as done', async () => {
    h.state.snapshotDeleteMissing = true
    await expect(provider().snapshot!.delete('snap_gone')).resolves.toBeUndefined()
  })
})

describe('templates', () => {
  it('throws without fromImage or dockerfile', async () => {
    await expect(provider().template.create({ name: 'app' })).rejects.toThrow(
      /fromImage.*dockerfile|dockerfile.*fromImage/,
    )
    expect(calls('templates.buildAndWait')).toHaveLength(0)
  })

  it('throws when both fromImage and dockerfile are set', async () => {
    await expect(
      provider().template.create({
        name: 'app',
        fromImage: 'node:22',
        dockerfile: 'FROM scratch',
      }),
    ).rejects.toThrow(/fromImage or dockerfile, not both/)
  })

  it('accepts GravixLayerCreateTemplateOptions on template.create', async () => {
    const template = await provider().template.create({
      name: 'img',
      fromImage: 'python:3.12-slim',
      run: ['echo hi'],
      vcpu: 2,
      memoryMb: 2048,
      diskMb: 8192,
      metadata: { team: 'a' },
    })

    expect(calls('templates.buildAndWait')).toHaveLength(1)
    const builder = h.state.builders[0]
    expect(builder.name).toBe('img')
    expect(builder.image).toBe('python:3.12-slim')
    expect(builder.runs).toEqual(['echo hi'])
    expect(builder.vcpuCount).toBe(2)
    expect(builder.memoryMb).toBe(2048)
    expect(builder.diskMb).toBe(8192)
    expect(builder.tagValues).toEqual({ team: 'a' })
    expect(template).toMatchObject({ id: 'tpl_1', provider: 'gravixlayer', name: 'img' })
  })

  it('builds with fromImage, run steps, sizing, and tags', async () => {
    const template = await provider().template.create({
      name: 'app',
      description: 'demo',
      fromImage: 'node:22',
      run: ['npm install'],
      vcpu: 2,
      memoryMb: 2048,
      diskMb: 8192,
      metadata: { team: 'agents', n: '1' },
    })

    expect(calls('templates.buildAndWait')).toHaveLength(1)
    const builder = h.state.builders[0]
    expect(builder.name).toBe('app')
    expect(builder.image).toBe('node:22')
    expect(builder.runs).toEqual(['npm install'])
    expect(builder.vcpuCount).toBe(2)
    expect(builder.memoryMb).toBe(2048)
    expect(builder.diskMb).toBe(8192)
    expect(builder.tagValues).toEqual({ team: 'agents', n: '1' })
    expect(template).toMatchObject({ id: 'tpl_1', provider: 'gravixlayer', name: 'app' })
  })

  it('lists templates across pages and honors limit', async () => {
    h.state.templatePages = [
      {
        templates: [
          { id: 't1', name: 'one', createdAt: '2026-09-25T00:00:00.000Z' },
          { id: 't2', name: 'two', createdAt: '2026-09-25T00:00:00.000Z' },
        ],
      },
      {
        templates: [{ id: 't3', name: 'three', createdAt: '2026-09-25T00:00:00.000Z' }],
      },
    ]
    const templates = await provider().template.list({ limit: 2 })
    expect(templates.map((t) => t.id)).toEqual(['t1', 't2'])
  })

  it('treats deleting a missing template as done', async () => {
    h.state.templateDeleteMissing = true
    await expect(provider().template.delete('tpl_gone')).resolves.toBeUndefined()
  })
})

describe('getInstance', () => {
  it('returns the native Runtime handle', async () => {
    const sandbox = await provider().sandbox.create()
    expect(sandbox.getInstance().runtimeId).toBe('rt_new')
  })
})
