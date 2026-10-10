/**
 * @computesdk/gravixlayer — GravixLayer provider for ComputeSDK.
 *
 * Cloud runtimes with a native filesystem API, live command streaming,
 * port publishing, templates, and snapshots.
 *
 * @see https://gravixlayer.ai
 */

import { defineProvider } from '@computesdk/provider'

import type {
  CommandResult,
  CreateInstanceOptions,
  CreateSnapshotOptions,
  CreateTemplateOptions,
  FileEntry,
  ListSnapshotsOptions,
  ListTemplatesOptions,
  Provider,
  ProviderTemplateManager,
  RunCommandOptions,
  SandboxInfo,
} from '@computesdk/provider'
import { GravixLayer, Runtime, TemplateBuilder, type RuntimeInfo } from 'gravixlayer'

export type { Runtime as GravixLayerRuntime }

export interface GravixLayerConfig {
  apiKey?: string
  baseUrl?: string
  cloud?: string
  region?: string
  timeout?: number
  maxRetries?: number
  http2?: boolean
}

/** Snapshot returned by this provider's snapshot manager. */
export interface GravixLayerSnapshot {
  id: string
  provider: 'gravixlayer'
  createdAt: Date
  metadata: {
    name: string
    state: string
    kind: string
  }
}

/** Template returned by this provider's template manager. */
export interface GravixLayerTemplate {
  id: string
  provider: 'gravixlayer'
  name: string
  createdAt: Date
}

/** Extra fields accepted on template.create beyond ComputeSDK's base options. */
export interface GravixLayerCreateTemplateOptions extends CreateTemplateOptions {
  fromImage?: string
  dockerfile?: string
  run?: string[]
  vcpu?: number
  memoryMb?: number
  diskMb?: number
}

/** Public provider with GravixLayer-specific template.create options. */
export interface GravixLayerProvider
  extends Provider<Runtime, GravixLayerTemplate, GravixLayerSnapshot> {
  template: ProviderTemplateManager<GravixLayerTemplate, GravixLayerCreateTemplateOptions>
}

interface ResolvedClientOptions {
  apiKey: string
  baseUrl?: string
  cloud?: string
  region?: string
  timeout?: number
  maxRetries: number
  http2: boolean
}

const clients = new Map<string, GravixLayer>()

/**
 * Fast path over `clients`: a provider instance's config object resolves once,
 * and later calls on the same instance skip resolution and the identity string.
 * The entry also snapshots the raw config fields and the env vars resolution
 * consulted, so a mutated config object or a changed env var falls through to a
 * fresh resolve — identical semantics to resolving on every call. `WeakMap`
 * means the entry dies with the config; it cannot leak. Two provider instances
 * with equivalent options still share one client through the `clients` map.
 */
interface CachedResolution {
  client: GravixLayer
  config: Pick<
    GravixLayerConfig,
    'apiKey' | 'baseUrl' | 'cloud' | 'region' | 'timeout' | 'maxRetries' | 'http2'
  >
  env: [string | undefined, string | undefined, string | undefined, string | undefined]
}

let clientsByConfig = new WeakMap<GravixLayerConfig, CachedResolution>()

/** Clear the module-level GravixLayer client caches. For tests only. */
export function clearGravixLayerClients(): void {
  clients.clear()
  clientsByConfig = new WeakMap()
}

const createTimeoutMs = new WeakMap<object, number>()

/**
 * ComputeSDK status for every runtime status the API reports. Only a running
 * runtime accepts commands, so a paused or stopping one reports `stopped`.
 * A `Map`, so no status string can resolve to an `Object.prototype` member.
 */
const SANDBOX_STATUS: ReadonlyMap<string, SandboxInfo['status']> = new Map([
  ['creating', 'running'],
  ['running', 'running'],
  ['paused', 'stopped'],
  ['stopping', 'stopped'],
  ['stopped', 'stopped'],
  ['terminated', 'stopped'],
  ['timed_out', 'stopped'],
  ['failed', 'error'],
])

/** Statuses the API no longer counts as live. `getById` reports these as gone. */
const ENDED_STATUSES: ReadonlySet<string> = new Set(['stopped', 'failed', 'terminated', 'timed_out'])

/** Runtime IDs are UUIDs. A string of any other shape cannot name a runtime. */
const RUNTIME_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 404
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateEnvironment(
  environment: Record<string, string> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(environment ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`Invalid environment variable name: ${JSON.stringify(name)}`)
    }
    result[name] = String(value)
  }
  return result
}

/** Convert a millisecond timeout to whole seconds. Zero is allowed. */
function toTimeoutSeconds(ms: number, what: string): number {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`GravixLayer ${what} must be a non-negative finite number of milliseconds`)
  }
  return Math.ceil(ms / 1000)
}

function nonempty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function resolveClientOptions(config: GravixLayerConfig): ResolvedClientOptions {
  const apiKey = (config.apiKey ?? process.env.GRAVIXLAYER_API_KEY)?.trim()
  if (!apiKey) {
    throw new Error(
      'GravixLayer requires an API key. Pass `apiKey` or set the `GRAVIXLAYER_API_KEY` environment variable. Get a key at https://gravixlayer.ai .',
    )
  }

  const maxRetries = config.maxRetries ?? 0
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new Error('GravixLayer maxRetries must be a non-negative integer')
  }

  const resolved: ResolvedClientOptions = {
    apiKey,
    maxRetries,
    http2: config.http2 ?? true,
  }

  const baseUrl = nonempty(config.baseUrl ?? process.env.GRAVIXLAYER_BASE_URL)
  if (baseUrl !== undefined) resolved.baseUrl = baseUrl

  const cloud = nonempty(config.cloud ?? process.env.GRAVIXLAYER_CLOUD)
  if (cloud !== undefined) resolved.cloud = cloud

  const region = nonempty(config.region ?? process.env.GRAVIXLAYER_REGION)
  if (region !== undefined) resolved.region = region

  if (config.timeout !== undefined) {
    if (!Number.isFinite(config.timeout) || config.timeout < 0) {
      throw new Error('GravixLayer timeout must be a non-negative finite number of milliseconds')
    }
    resolved.timeout = config.timeout
  }

  return resolved
}

function clientIdentity(options: ResolvedClientOptions): string {
  return JSON.stringify([
    options.apiKey,
    options.baseUrl ?? null,
    options.cloud ?? null,
    options.region ?? null,
    options.timeout ?? null,
    options.maxRetries,
    options.http2,
  ])
}

function getClient(config: GravixLayerConfig): GravixLayer {
  const cached = clientsByConfig.get(config)
  if (
    cached &&
    cached.config.apiKey === config.apiKey &&
    cached.config.baseUrl === config.baseUrl &&
    cached.config.cloud === config.cloud &&
    cached.config.region === config.region &&
    cached.config.timeout === config.timeout &&
    cached.config.maxRetries === config.maxRetries &&
    cached.config.http2 === config.http2 &&
    // env is only consulted when the matching config field is unset
    (config.apiKey !== undefined || process.env.GRAVIXLAYER_API_KEY === cached.env[0]) &&
    (config.baseUrl !== undefined || process.env.GRAVIXLAYER_BASE_URL === cached.env[1]) &&
    (config.cloud !== undefined || process.env.GRAVIXLAYER_CLOUD === cached.env[2]) &&
    (config.region !== undefined || process.env.GRAVIXLAYER_REGION === cached.env[3])
  ) {
    return cached.client
  }
  const options = resolveClientOptions(config)
  const key = clientIdentity(options)
  let client = clients.get(key)
  if (!client) {
    client = new GravixLayer({
      apiKey: options.apiKey,
      ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
      ...(options.cloud !== undefined ? { cloud: options.cloud } : {}),
      ...(options.region !== undefined ? { region: options.region } : {}),
      ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
      maxRetries: options.maxRetries,
      http2: options.http2,
    })
    clients.set(key, client)
  }
  clientsByConfig.set(config, {
    client,
    config: {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      cloud: config.cloud,
      region: config.region,
      timeout: config.timeout,
      maxRetries: config.maxRetries,
      http2: config.http2,
    },
    env: [
      process.env.GRAVIXLAYER_API_KEY,
      process.env.GRAVIXLAYER_BASE_URL,
      process.env.GRAVIXLAYER_CLOUD,
      process.env.GRAVIXLAYER_REGION,
    ],
  })
  return client
}

/**
 * The SDK keeps a small HTTP/2 session pool per origin: a burst spreads over
 * a handful of connections whose handshakes run in parallel, while a quiet
 * caller keeps one session. `maxRetries: 0` keeps a refused create from
 * sleeping inside the caller's timer. `connect()` is intentionally not
 * called: it issues its own request and would compete with create.
 *
 * The client default HTTP timeout is 60s, which is shorter than a slow boot
 * and shorter than the benchmark's 120s create budget. This ceiling is the
 * same budget the SDK uses for snapshot restore. It does not add latency on
 * a fast create; it only releases the HTTP/2 stream if a boot never returns.
 * `0` would hold that stream until the process exits.
 */
const CREATE_HTTP_TIMEOUT_MS = 180_000

/** In-flight or completed publish, so concurrent getUrl calls share one request. */
const publishedUrls = new WeakMap<Runtime, Map<number, Promise<string>>>()

/** A status this version does not know is reported as stopped, never as running. */
function mapStatus(status: string): SandboxInfo['status'] {
  return SANDBOX_STATUS.get(status) ?? 'stopped'
}

function parseCreatedAt(startedAt: string | undefined): Date {
  if (startedAt) {
    const date = new Date(startedAt)
    if (!Number.isNaN(date.getTime())) return date
  }
  return new Date()
}

function leaseTimeoutMs(startedAt: string | undefined, timeoutAt: string | undefined): number {
  if (!startedAt || !timeoutAt) return 0
  const start = new Date(startedAt).getTime()
  const end = new Date(timeoutAt).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  const delta = end - start
  return delta > 0 ? delta : 0
}

function rememberTimeout(sandbox: Runtime, timeoutMs: number | undefined): Runtime {
  if (timeoutMs !== undefined) createTimeoutMs.set(sandbox, timeoutMs)
  return sandbox
}

function bindRuntime(client: GravixLayer, info: RuntimeInfo): Runtime {
  return new Runtime(client.runtime, info)
}

async function publishedUrl(sandbox: Runtime, port: number): Promise<string> {
  let ports = publishedUrls.get(sandbox)
  const existing = ports?.get(port)
  if (existing) return existing

  const pending = sandbox.service(port).then((handle) => {
    if (!handle.url) {
      throw new Error(`GravixLayer did not return a URL for port ${port}.`)
    }
    return handle.url
  })
  if (!ports) {
    ports = new Map()
    publishedUrls.set(sandbox, ports)
  }
  ports.set(port, pending)
  try {
    return await pending
  } catch (error) {
    ports.delete(port)
    throw error
  }
}

async function runCommand(
  sandbox: Runtime,
  command: string,
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  const started = performance.now()

  if (options.background && (options.onStdout || options.onStderr)) {
    throw new Error('runCommand with streaming callbacks does not support background mode.')
  }

  const environment = validateEnvironment(options.env)
  const opts: {
    workingDir?: string
    environment?: Record<string, string>
    timeoutSeconds?: number
    background?: boolean
    onStdout?: (chunk: string) => void
    onStderr?: (chunk: string) => void
  } = {}

  if (options.cwd) opts.workingDir = options.cwd
  if (Object.keys(environment).length > 0) opts.environment = environment
  if (options.timeout !== undefined) {
    opts.timeoutSeconds = toTimeoutSeconds(options.timeout, 'command timeout')
  }
  if (options.onStdout) opts.onStdout = options.onStdout
  if (options.onStderr) opts.onStderr = options.onStderr

  if (options.background) {
    await sandbox.runCmd(command, { ...opts, background: true })
    return { stdout: '', stderr: '', exitCode: 0, durationMs: elapsedMs(started) }
  }

  const result = await sandbox.runCmd(command, opts)
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    durationMs:
      typeof result.durationMs === 'number' && Number.isFinite(result.durationMs)
        ? Math.max(0, result.durationMs)
        : elapsedMs(started),
  }
}

function elapsedMs(started: number): number {
  return Math.max(0, Math.round(performance.now() - started))
}

const createGravixLayerProvider = defineProvider<
  Runtime,
  GravixLayerConfig,
  GravixLayerTemplate,
  GravixLayerSnapshot
>({
  name: 'gravixlayer',
  methods: {
    instances: {
      create: async (config: GravixLayerConfig, options: CreateInstanceOptions = {}) => {
        if (nonempty(options.image)) {
          throw new Error(
            'GravixLayer runtimes start from a template, not an image. Pass `templateId`, or build a template from the image with `template.create({ name, fromImage })`.',
          )
        }
        const template = nonempty(options.templateId)
        if (template && options.snapshotId) {
          throw new Error('A runtime starts from a template or a snapshot, not both')
        }

        const envVars = validateEnvironment(options.envs)
        const client = getClient(config)

        const body: {
          template?: string
          snapshot?: string
          envVars?: Record<string, string>
          timeoutSeconds?: number
          /** HTTP timeout for this request, in milliseconds. */
          timeout?: number
          metadata?: Record<string, unknown>
          cloud?: string
          region?: string
          signal?: AbortSignal
        } = {}

        if (options.snapshotId) {
          body.snapshot = options.snapshotId
        } else if (template) {
          body.template = template
        }

        if (Object.keys(envVars).length > 0) body.envVars = envVars

        if (options.timeout !== undefined) {
          body.timeoutSeconds = toTimeoutSeconds(options.timeout, 'sandbox timeout')
        }

        if (isPlainObject(options.metadata)) {
          body.metadata = options.metadata
        }

        if (typeof options.cloud === 'string') body.cloud = options.cloud
        if (typeof options.region === 'string') body.region = options.region
        if (options.signal) body.signal = options.signal
        if (!options.snapshotId && config.timeout === undefined) {
          body.timeout = CREATE_HTTP_TIMEOUT_MS
        }

        const sandbox = await client.runtime.create(body)
        // Report the lease the runtime actually got: seconds, rounded up.
        rememberTimeout(
          sandbox,
          body.timeoutSeconds === undefined ? undefined : body.timeoutSeconds * 1000,
        )
        return { instance: sandbox, instanceId: sandbox.runtimeId }
      },

      getById: async (config: GravixLayerConfig, sandboxId: string) => {
        const client = getClient(config)
        if (!RUNTIME_ID.test(sandboxId)) return null
        try {
          const sandbox = await client.runtime.get(sandboxId)
          if (ENDED_STATUSES.has(sandbox.status)) return null
          return { instance: sandbox, instanceId: sandbox.runtimeId }
        } catch (error) {
          if (isNotFound(error)) return null
          throw error
        }
      },

      list: async (config: GravixLayerConfig) => {
        const client = getClient(config)
        const pageSize = 100
        let offset = 0
        const sandboxes: Array<{ instance: Runtime; instanceId: string }> = []
        const seen = new Set<string>()

        for (;;) {
          const page = await client.runtime.list({ limit: pageSize, offset })
          const marker = page.runtimes[0]?.runtimeId
          if (marker && seen.has(marker)) break
          if (marker) seen.add(marker)
          for (const info of page.runtimes) {
            if (!info.runtimeId) continue
            // The list payload is enough to bind a handle. A follow-up get
            // per row would add one round trip per runtime.
            const sandbox = bindRuntime(client, info)
            sandboxes.push({ instance: sandbox, instanceId: sandbox.runtimeId })
          }
          offset += page.runtimes.length
          if (
            page.runtimes.length < pageSize ||
            !Number.isFinite(page.total) ||
            offset >= page.total
          ) {
            break
          }
        }

        return sandboxes
      },

      destroy: async (config: GravixLayerConfig, sandboxId: string) => {
        const client = getClient(config)
        try {
          await client.runtime.kill(sandboxId)
        } catch (error) {
          if (!isNotFound(error)) throw error
        }
      },

      runCommand,

      streamCommand: runCommand,

      getInfo: async (sandbox: Runtime): Promise<SandboxInfo> => {
        await sandbox.refresh()
        const info = sandbox.info
        return {
          id: sandbox.runtimeId,
          provider: 'gravixlayer',
          status: mapStatus(info.status),
          createdAt: parseCreatedAt(info.startedAt),
          timeout:
            createTimeoutMs.get(sandbox) ?? leaseTimeoutMs(info.startedAt, info.timeoutAt),
          ...(info.metadata !== undefined ? { metadata: info.metadata } : {}),
        }
      },

      getUrl: async (sandbox: Runtime, options: { port: number; protocol?: string }) => {
        const { port } = options
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new Error(`Invalid port: ${port}`)
        }
        const value = await publishedUrl(sandbox, port)
        if (!options.protocol) return value
        const url = new URL(value)
        url.protocol = `${options.protocol.replace(/:$/, '')}:`
        return url.toString()
      },

      getInstance: (sandbox: Runtime) => sandbox,

      filesystem: {
        readFile: async (sandbox: Runtime, path: string): Promise<string> => {
          return (await sandbox.file.read(path)).content
        },

        writeFile: async (sandbox: Runtime, path: string, content: string): Promise<void> => {
          await sandbox.file.write(path, content)
        },

        mkdir: async (sandbox: Runtime, path: string): Promise<void> => {
          await sandbox.file.createDirectory(path)
        },

        readdir: async (sandbox: Runtime, path: string): Promise<FileEntry[]> => {
          const listing = await sandbox.file.list(path)
          return listing.files.map((entry) => {
            const fileEntry: FileEntry = {
              name: entry.name,
              type: entry.isDir ? 'directory' : 'file',
              size: entry.size,
            }
            const modified = new Date(entry.modifiedAt)
            if (!Number.isNaN(modified.getTime())) {
              fileEntry.modified = modified
            }
            return fileEntry
          })
        },

        exists: async (sandbox: Runtime, path: string): Promise<boolean> => {
          return (await sandbox.file.getInfo(path)).exists
        },

        remove: async (sandbox: Runtime, path: string): Promise<void> => {
          await sandbox.file.delete(path)
        },
      },
    },

    snapshot: {
      create: async (
        config: GravixLayerConfig,
        sandboxId: string,
        options?: CreateSnapshotOptions,
      ): Promise<GravixLayerSnapshot> => {
        const name = nonempty(options?.name)
        if (!name) {
          throw new Error('GravixLayer snapshots require a name.')
        }
        const client = getClient(config)
        const description =
          options &&
          'description' in options &&
          typeof (options as { description?: unknown }).description === 'string'
            ? (options as { description: string }).description
            : undefined
        const snapshot = await client.snapshots.create(sandboxId, name, {
          ...(description !== undefined ? { description } : {}),
        })
        return {
          id: snapshot.id,
          provider: 'gravixlayer',
          createdAt: new Date(snapshot.createdAt),
          metadata: {
            name: snapshot.name,
            state: snapshot.state,
            kind: snapshot.kind,
          },
        }
      },

      list: async (
        config: GravixLayerConfig,
        options?: ListSnapshotsOptions,
      ): Promise<GravixLayerSnapshot[]> => {
        const client = getClient(config)
        const pageSize = 100
        let offset = 0
        const snapshots: GravixLayerSnapshot[] = []
        const limit = options?.limit
        const seen = new Set<string>()

        for (;;) {
          const take =
            limit === undefined ? pageSize : Math.min(pageSize, Math.max(0, limit - snapshots.length))
          if (limit !== undefined && take === 0) break

          const page = await client.snapshots.list({
            limit: take,
            offset,
            ...(options?.sandboxId ? { runtimeId: options.sandboxId } : {}),
          })

          const marker = page.snapshots[0]?.id
          if (marker && seen.has(marker)) break
          if (marker) seen.add(marker)

          for (const snapshot of page.snapshots) {
            snapshots.push({
              id: snapshot.id,
              provider: 'gravixlayer',
              createdAt: new Date(snapshot.createdAt),
              metadata: {
                name: snapshot.name,
                state: snapshot.state,
                kind: snapshot.kind,
              },
            })
            if (limit !== undefined && snapshots.length >= limit) return snapshots
          }

          offset += page.snapshots.length
          if (page.snapshots.length === 0 || offset >= page.total) break
          if (page.snapshots.length < take) break
        }

        return snapshots
      },

      delete: async (config: GravixLayerConfig, snapshotId: string) => {
        const client = getClient(config)
        try {
          await client.snapshots.delete(snapshotId)
        } catch (error) {
          if (!isNotFound(error)) throw error
        }
      },
    },

    template: {
      create: async (
        config: GravixLayerConfig,
        options: GravixLayerCreateTemplateOptions,
      ): Promise<GravixLayerTemplate> => {
        const name = nonempty(options.name)
        if (!name) {
          throw new Error('GravixLayer templates require a name.')
        }

        const fromImage = nonempty(options.fromImage)
        const dockerfile = nonempty(options.dockerfile)
        if (!fromImage && !dockerfile) {
          throw new Error(
            'A GravixLayer template build needs `fromImage` or `dockerfile`. Select an existing template with `templateId` on sandbox create.',
          )
        }
        if (fromImage && dockerfile) {
          throw new Error('Specify either fromImage or dockerfile, not both.')
        }

        const builder = new TemplateBuilder(name, options.description ?? '')
        if (fromImage) builder.fromImage(fromImage)
        if (dockerfile) builder.dockerfile(dockerfile)

        if (Array.isArray(options.run)) {
          for (const command of options.run) {
            if (typeof command === 'string' && command.trim() !== '') {
              builder.run(command)
            }
          }
        }

        if (typeof options.vcpu === 'number' && Number.isFinite(options.vcpu) && options.vcpu > 0) {
          builder.vcpu(options.vcpu)
        }
        if (
          typeof options.memoryMb === 'number' &&
          Number.isFinite(options.memoryMb) &&
          options.memoryMb > 0
        ) {
          builder.memory(options.memoryMb)
        }
        if (
          typeof options.diskMb === 'number' &&
          Number.isFinite(options.diskMb) &&
          options.diskMb > 0
        ) {
          builder.disk(options.diskMb)
        }

        if (options.metadata) {
          const tags: Record<string, string> = {}
          for (const [key, value] of Object.entries(options.metadata)) {
            if (typeof value === 'string') tags[key] = value
          }
          if (Object.keys(tags).length > 0) builder.tags(tags)
        }

        const client = getClient(config)
        const status = await client.templates.buildAndWait(builder)
        return {
          id: status.templateId,
          provider: 'gravixlayer',
          name,
          createdAt: new Date(),
        }
      },

      list: async (
        config: GravixLayerConfig,
        options?: ListTemplatesOptions,
      ): Promise<GravixLayerTemplate[]> => {
        const client = getClient(config)
        const pageSize = 100
        let offset = 0
        const templates: GravixLayerTemplate[] = []
        const limit = options?.limit
        const seen = new Set<string>()

        for (;;) {
          const take =
            limit === undefined ? pageSize : Math.min(pageSize, Math.max(0, limit - templates.length))
          if (limit !== undefined && take === 0) break

          const page = await client.templates.list({ limit: take, offset })
          const marker = page.templates[0]?.id
          if (marker && seen.has(marker)) break
          if (marker) seen.add(marker)
          for (const template of page.templates) {
            templates.push({
              id: template.id,
              provider: 'gravixlayer',
              name: template.name,
              createdAt: new Date(template.createdAt),
            })
            if (limit !== undefined && templates.length >= limit) return templates
          }

          offset += page.templates.length
          // TemplateListResponse has no total; stop on a short/empty page.
          if (page.templates.length === 0 || page.templates.length < take) break
        }

        return templates
      },

      delete: async (config: GravixLayerConfig, templateId: string) => {
        const client = getClient(config)
        try {
          await client.templates.delete(templateId)
        } catch (error) {
          if (!isNotFound(error)) throw error
        }
      },
    },
  },
})

/** Preserve GravixLayer-specific template.create options on the public provider. */
export function gravixlayer(config: GravixLayerConfig = {}): GravixLayerProvider {
  const provider = createGravixLayerProvider(config)
  return { ...provider, template: provider.template! }
}
