/**
 * @computesdk/runtime — Runtime provider for ComputeSDK.
 *
 * Runtime runs each sandbox as a Firecracker microVM with its own kernel.
 * This provider drives it through Runtime's TypeScript SDK, `withruntime`.
 *
 * @see https://withruntime.com
 */

import { defineProvider } from '@computesdk/provider'

import type {
  CommandResult,
  CreateSandboxOptions,
  CreateSnapshotOptions,
  FileEntry,
  ListSnapshotsOptions,
  RunCommandOptions,
  SandboxInfo,
} from '@computesdk/provider'
import type {
  CreateSandbox,
  Runtime,
  Sandbox as RuntimeSandbox,
  SandboxInfo as RuntimeSandboxInfo,
  Snapshot as RuntimeSnapshotRecord,
} from 'withruntime'

export type { RuntimeSandbox }

export interface RuntimeConfig {
  /** Runtime API key. Falls back to RUNTIME_API_KEY, then the key `npx withruntime login` saved. */
  apiKey?: string
  /** API origin. Falls back to RUNTIME_API_URL, then https://api.withruntime.com. */
  baseUrl?: string
  /**
   * Defaults for every sandbox this provider creates: `image`, `region`,
   * `vcpu`, `memoryMiB`, `diskMiB`, `funding`, `network` and any other field
   * Runtime's create accepts. Per-call options override them.
   */
  create?: CreateSandbox
  /** `private` (default): the URL from getUrl carries a signed token. `public`: anyone with the address. */
  previewVisibility?: 'private' | 'public'
  /** How long a private preview's token lasts, in seconds (60 to 604800; Runtime's default is one day). */
  previewTtlSeconds?: number
}

/** A Runtime snapshot as ComputeSDK's snapshot manager returns it. */
export interface RuntimeSnapshot {
  id: string
  provider: 'runtime'
  createdAt: Date
  metadata: {
    name: string | null
    state: RuntimeSnapshotRecord['state']
    sourceSandboxId: string
    readyAt: string | null
    expiresAt: string
  }
}

type RuntimeModule = typeof import('withruntime')

/** Timed-out commands report this exit code, as `timeout(1)` does. */
const TIMEOUT_EXIT_CODE = 124
/** Runtime's default lease when create is given no timeout: 30 minutes. */
const DEFAULT_LEASE_MS = 1_800_000
/** The longest a command may run through Runtime's exec: 24 hours. */
const MAX_COMMAND_TIMEOUT_MS = 86_400_000

/**
 * The exit code a shell would report. Runtime's API gives a command killed by
 * a signal as the negative signal number (a timed-out command is killed with
 * SIGKILL and reads -9), where a shell says 128 plus the signal: -15 is 143.
 * A timed-out command reports 124 whatever killed it, as `timeout(1)` does.
 */
function shellExitCode(result: { exitCode: number | null; timedOut: boolean }): number {
  if (result.timedOut) return TIMEOUT_EXIT_CODE
  if (result.exitCode === null) return 1
  return result.exitCode < 0 ? 128 - result.exitCode : result.exitCode
}

let sdk: Promise<RuntimeModule> | undefined

/**
 * `withruntime` is published as ES modules only. Loading it with a dynamic
 * import, on first use, lets this package's CommonJS build load it as well:
 * `import()` works from CommonJS on every supported Node version, where
 * `require()` of an ES-module-only package does not.
 */
function loadSdk(): Promise<RuntimeModule> {
  sdk ??= import('withruntime').catch((error: unknown) => {
    sdk = undefined
    throw error
  })
  return sdk
}

const clients = new WeakMap<RuntimeConfig, Promise<Runtime>>()

function getClient(config: RuntimeConfig): Promise<Runtime> {
  let client = clients.get(config)
  if (!client) {
    client = loadSdk().then(({ Runtime }) => {
      return new Runtime({
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
        ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
      })
    })
    clients.set(config, client)
  }
  return client
}

interface SandboxState {
  /** Environment variables given at create, applied to every command. */
  env: Record<string, string>
  /** The timeout given at create, in milliseconds. */
  timeoutMs?: number
  config: RuntimeConfig
}

const sandboxState = new WeakMap<RuntimeSandbox, SandboxState>()

function track(
  sandbox: RuntimeSandbox,
  config: RuntimeConfig,
  extra: Partial<SandboxState> = {},
): RuntimeSandbox {
  sandboxState.set(sandbox, { env: {}, ...sandboxState.get(sandbox), ...extra, config })
  return sandbox
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 404
  )
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

function positiveMs(value: number, what: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Runtime ${what} must be a positive finite number of milliseconds`)
  }
  return value
}

function toLabels(
  metadata: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  if (!metadata) return undefined
  const labels: Record<string, string> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined) continue
    labels[key] = typeof value === 'string' ? value : JSON.stringify(value)
  }
  return labels
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) if (typeof value === 'number') return value
  return undefined
}

/** Maps ComputeSDK's create options onto Runtime's create body. */
function createBody(config: RuntimeConfig, options: CreateSandboxOptions = {}): CreateSandbox {
  const image = options.templateId ?? options.image
  if (image && options.snapshotId) {
    throw new Error('Runtime starts a sandbox from an image or a snapshot, not both')
  }
  const body: CreateSandbox = { ...config.create }
  if (image) {
    body.image = image
    delete body.snapshot
  }
  if (options.snapshotId) {
    body.snapshot = options.snapshotId
    delete body.image
  }
  if (options.name) body.name = options.name
  const labels = toLabels(options.metadata)
  if (labels) body.labels = { ...body.labels, ...labels }
  if (options.timeout !== undefined) {
    body.timeoutSeconds = Math.ceil(positiveMs(options.timeout, 'sandbox timeout') / 1000)
  }
  const vcpu = firstNumber(options.vcpus, options.vcpu)
  if (vcpu !== undefined) body.vcpu = vcpu
  const memoryMiB = firstNumber(options.memoryMiB, options.memMiB)
  if (memoryMiB !== undefined) body.memoryMiB = memoryMiB
  if (options.diskMiB !== undefined) body.diskMiB = options.diskMiB
  if (typeof options.region === 'string') body.region = options.region
  return body
}

function status(state: RuntimeSandboxInfo['state']): SandboxInfo['status'] {
  if (state === 'running' || state === 'starting' || state === 'resuming') return 'running'
  return 'stopped'
}

function toSnapshot(snapshot: RuntimeSnapshotRecord): RuntimeSnapshot {
  return {
    id: snapshot.id,
    provider: 'runtime',
    createdAt: new Date(snapshot.createdAt),
    metadata: {
      name: snapshot.name,
      state: snapshot.state,
      sourceSandboxId: snapshot.sourceSandboxId,
      readyAt: snapshot.readyAt,
      expiresAt: snapshot.expiresAt,
    },
  }
}

async function runCommand(
  sandbox: RuntimeSandbox,
  command: string,
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  const startedAt = Date.now()
  const state = sandboxState.get(sandbox)
  const timeoutMs =
    options.timeout === undefined ? undefined : positiveMs(options.timeout, 'command timeout')
  if (timeoutMs !== undefined && timeoutMs > MAX_COMMAND_TIMEOUT_MS) {
    throw new Error('Runtime command timeout cannot exceed 86400000 milliseconds (24 hours)')
  }
  const env = { ...state?.env, ...validateEnvironment(options.env) }
  const shared = {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(Object.keys(env).length > 0 ? { env } : {}),
    ...(timeoutMs === undefined ? {} : { timeoutMs: Math.ceil(timeoutMs) }),
  }

  if (options.background) {
    // Runtime keeps a background process running after this call returns;
    // its output stays readable through getInstance().processes.
    await sandbox.spawn(command, shared)
    return { stdout: '', stderr: '', exitCode: 0, durationMs: Date.now() - startedAt }
  }

  // A string command runs under `bash -c`. With callbacks, Runtime streams
  // the output from its API as the command writes it.
  const result = await sandbox.exec(command, {
    ...shared,
    ...(options.onStdout ? { onStdout: options.onStdout } : {}),
    ...(options.onStderr ? { onStderr: options.onStderr } : {}),
  })
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: shellExitCode(result),
    durationMs: typeof result.durationMs === 'number' ? result.durationMs : Date.now() - startedAt,
  }
}

export const runtime = defineProvider<RuntimeSandbox, RuntimeConfig, never, RuntimeSnapshot>({
  name: 'runtime',
  methods: {
    sandbox: {
      create: async (config: RuntimeConfig, options?: CreateSandboxOptions) => {
        const env = validateEnvironment(options?.envs)
        const body = createBody(config, options)
        const client = await getClient(config)
        const sandbox = await client.sandboxes.create(
          body,
          options?.signal ? { signal: options.signal } : {},
        )
        track(sandbox, config, {
          env,
          ...(options?.timeout === undefined ? {} : { timeoutMs: options.timeout }),
        })
        return { sandbox, sandboxId: sandbox.id }
      },

      getById: async (config: RuntimeConfig, sandboxId: string) => {
        const client = await getClient(config)
        try {
          const sandbox = await client.sandboxes.get(sandboxId)
          if (sandbox.state === 'stopped' || sandbox.state === 'stopping') return null
          return { sandbox: track(sandbox, config), sandboxId: sandbox.id }
        } catch (error) {
          if (isNotFound(error)) return null
          throw error
        }
      },

      list: async (config: RuntimeConfig) => {
        const client = await getClient(config)
        const page = await client.sandboxes.list()
        const sandboxes: Array<{ sandbox: RuntimeSandbox; sandboxId: string }> = []
        for await (const sandbox of page) {
          sandboxes.push({ sandbox: track(sandbox, config), sandboxId: sandbox.id })
        }
        return sandboxes
      },

      destroy: async (config: RuntimeConfig, sandboxId: string) => {
        const client = await getClient(config)
        let sandbox: RuntimeSandbox
        try {
          sandbox = await client.sandboxes.get(sandboxId)
        } catch (error) {
          if (isNotFound(error)) return
          throw error
        }
        if (sandbox.state === 'stopped') return
        if (sandbox.state === 'stopping') {
          await sandbox.waitFor('stopped')
          return
        }
        await sandbox.stop()
      },

      runCommand,

      // Runtime streams a command's output over its own API, so ComputeSDK
      // needs neither its in-sandbox bridge nor a routable port for it.
      streamCommand: runCommand,

      getInfo: async (sandbox: RuntimeSandbox): Promise<SandboxInfo> => {
        await sandbox.refresh()
        const info = sandbox.info
        return {
          id: sandbox.id,
          provider: 'runtime',
          status: status(info.state),
          createdAt: new Date(info.createdAt),
          timeout:
            sandboxState.get(sandbox)?.timeoutMs ??
            (typeof info.timeoutSeconds === 'number'
              ? info.timeoutSeconds * 1000
              : DEFAULT_LEASE_MS),
          metadata: {
            name: info.name,
            labels: info.labels,
            state: info.state,
            region: info.region,
            vcpu: info.vcpu,
            memoryMiB: info.memoryMiB,
            diskMiB: info.diskMiB,
            expiresAt: info.expiresAt,
          },
        }
      },

      getUrl: async (sandbox: RuntimeSandbox, options: { port: number; protocol?: string }) => {
        const { port } = options
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new Error(`Invalid port: ${port}`)
        }
        const config = sandboxState.get(sandbox)?.config
        const visibility = config?.previewVisibility ?? 'private'
        const preview = await sandbox.previews.create(port, {
          visibility,
          ...(visibility === 'private' && config?.previewTtlSeconds
            ? { ttlSeconds: config.previewTtlSeconds }
            : {}),
        })
        // A private preview's link carries its token; a browser opening it
        // keeps the token as a cookie for that one site.
        const value = preview.urlWithToken ?? preview.url
        if (!options.protocol) return value
        const url = new URL(value)
        url.protocol = `${options.protocol.replace(/:$/, '')}:`
        return url.toString()
      },

      getInstance: (sandbox: RuntimeSandbox) => sandbox,

      filesystem: {
        readFile: async (sandbox: RuntimeSandbox, path: string): Promise<string> => {
          return sandbox.files.readText(path)
        },

        writeFile: async (
          sandbox: RuntimeSandbox,
          path: string,
          content: string,
        ): Promise<void> => {
          await sandbox.files.write(path, content)
        },

        mkdir: async (sandbox: RuntimeSandbox, path: string): Promise<void> => {
          await sandbox.files.mkdir(path, { parents: true })
        },

        readdir: async (sandbox: RuntimeSandbox, path: string): Promise<FileEntry[]> => {
          const entries = await sandbox.files.list(path)
          return entries.map((entry) => ({
            name: entry.name,
            type: entry.type === 'directory' ? 'directory' : 'file',
            size: entry.size,
            modified: new Date(entry.modifiedAt),
          }))
        },

        exists: async (sandbox: RuntimeSandbox, path: string): Promise<boolean> => {
          return sandbox.files.exists(path)
        },

        remove: async (sandbox: RuntimeSandbox, path: string): Promise<void> => {
          await sandbox.files.remove(path, { recursive: true })
        },
      },
    },

    snapshot: {
      create: async (config: RuntimeConfig, sandboxId: string, options?: CreateSnapshotOptions) => {
        const client = await getClient(config)
        const sandbox = await client.sandboxes.get(sandboxId)
        const labels = toLabels(options?.metadata)
        // Runtime pauses a running sandbox for the moment the snapshot takes,
        // then wakes it.
        const snapshot = await sandbox.snapshot({
          ...(options?.name ? { name: options.name } : {}),
          ...(labels ? { labels } : {}),
        })
        return toSnapshot(snapshot)
      },

      list: async (config: RuntimeConfig, options?: ListSnapshotsOptions) => {
        const client = await getClient(config)
        const page = await client.snapshots.list({
          ...(options?.sandboxId ? { sandboxId: options.sandboxId } : {}),
          ...(options?.limit ? { limit: Math.min(options.limit, 100) } : {}),
        })
        const snapshots = await page.toArray(options?.limit ?? 10_000)
        return snapshots.map(toSnapshot)
      },

      delete: async (config: RuntimeConfig, snapshotId: string) => {
        const client = await getClient(config)
        try {
          await client.snapshots.delete(snapshotId)
        } catch (error) {
          if (!isNotFound(error)) throw error
        }
      },
    },
  },
})
