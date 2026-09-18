/**
 * @computesdk/brezel — Brezel provider for ComputeSDK.
 *
 * Brezel supplies self-hosted Firecracker sandboxes backed by a prequalified,
 * immutable environment revision. The provider deliberately does not build or
 * mutate an environment on the benchmark path.
 *
 * @see https://github.com/infercrane/brezel
 */

import { BrezelClient, BrezelError, Sandbox } from '@infercrane/brezel'
import { defineProvider } from '@computesdk/provider'

import type {
  CommandResult,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
  SandboxInfo,
} from '@computesdk/provider'

export interface BrezelConfig {
  /** Project-scoped service token. Falls back to BREZEL_API_KEY. */
  apiKey?: string
  /** HTTPS API endpoint. Falls back to BREZEL_API_URL. */
  baseUrl?: string
  /** Brezel project boundary. Falls back to BREZEL_PROJECT_ID. */
  project?: string
  /** Prequalified immutable environment revision. Falls back to BREZEL_ENVIRONMENT_REVISION. */
  environmentRevision?: string
  /** Permit outbound internet access for created sandboxes. */
  allowInternet?: boolean
  /** API operation timeout in milliseconds. */
  apiTimeoutMs?: number
}

type ConfigWithClient = BrezelConfig & { __client?: BrezelClient }

const DEFAULT_TIMEOUT_MS = 300_000
const DELETE_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 100

const sandboxTimeouts = new WeakMap<Sandbox, number>()
const sandboxEnvironments = new WeakMap<Sandbox, Record<string, string>>()
const sandboxClients = new WeakMap<Sandbox, BrezelClient>()

function required(value: string | undefined, variable: string): string {
  if (!value) throw new Error(`Missing ${variable}. Provide it in config or set ${variable}.`)
  return value
}

function getClient(config: ConfigWithClient): BrezelClient {
  if (!config.__client) {
    config.__client = new BrezelClient({
      token: required(config.apiKey ?? process.env.BREZEL_API_KEY, 'BREZEL_API_KEY'),
      baseUrl: required(config.baseUrl ?? process.env.BREZEL_API_URL, 'BREZEL_API_URL'),
      project: required(config.project ?? process.env.BREZEL_PROJECT_ID, 'BREZEL_PROJECT_ID'),
      timeoutMs: config.apiTimeoutMs,
    })
  }
  return config.__client
}

function environmentRevision(config: BrezelConfig, options?: CreateSandboxOptions): string {
  return required(
    options?.templateId ?? config.environmentRevision ?? process.env.BREZEL_ENVIRONMENT_REVISION,
    'BREZEL_ENVIRONMENT_REVISION',
  )
}

function allowInternet(config: BrezelConfig): boolean {
  if (config.allowInternet !== undefined) return config.allowInternet
  const raw = process.env.BREZEL_ALLOW_INTERNET
  if (raw === undefined) return false
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new Error('BREZEL_ALLOW_INTERNET must be exactly true or false')
}

function terminal(status: unknown): boolean {
  return status === 'deleted' || status === 'expired'
}

function status(state: unknown): SandboxInfo['status'] {
  if (state === 'failed') return 'error'
  if (state === 'paused' || state === 'standby' || state === 'stopped' || terminal(state)) return 'stopped'
  return 'running'
}

function isMissing(error: unknown): boolean {
  return error instanceof BrezelError && error.status === 404
}

function resourceString(resource: Record<string, unknown>, name: string): string {
  const value = resource[name]
  if (typeof value !== 'string' || !value) {
    throw new Error(`Brezel sandbox response is missing ${name}`)
  }
  return value
}

function validateEnvironment(environment: Record<string, string> | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(environment ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`Invalid environment variable name: ${JSON.stringify(name)}`)
    }
    result[name] = String(value)
  }
  return result
}

function commandArgv(command: string, background: boolean): string[] {
  if (!background) return ['/bin/sh', '-lc', command]
  // The command is passed as a positional argument rather than interpolated,
  // so shell metacharacters in the caller's command cannot alter this wrapper.
  return [
    '/bin/sh',
    '-lc',
    'nohup /bin/sh -lc "$1" sh >/dev/null 2>&1 </dev/null &',
    'sh',
    command,
  ]
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function waitUntilDeleted(client: BrezelClient, id: string): Promise<void> {
  const deadline = Date.now() + DELETE_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const current = await client.sandbox(id)
      if (terminal(current.resource.state)) return
    } catch (error) {
      if (isMissing(error)) return
      throw error
    }
    await sleep(POLL_INTERVAL_MS)
  }
  throw new Error(`Timed out waiting for Brezel sandbox deletion: ${id}`)
}

type FsRunCommand = (sandbox: Sandbox, command: string, options?: RunCommandOptions) => Promise<CommandResult>

export const brezel = defineProvider<Sandbox, ConfigWithClient>({
  name: 'brezel',
  methods: {
    sandbox: {
      create: async (config: ConfigWithClient, options?: CreateSandboxOptions) => {
        if (options?.snapshotId) throw new Error('Brezel snapshots are not exposed through ComputeSDK yet')
        if (options?.image) throw new Error('Use a prequalified Brezel environment revision instead of image')
        if (options?.signal?.aborted) throw options.signal.reason ?? new Error('Sandbox creation aborted')

        const timeoutMs = options?.timeout ?? DEFAULT_TIMEOUT_MS
        const sandbox = await getClient(config).createSandbox({
          environmentRevision: environmentRevision(config, options),
          ttlSeconds: Math.max(1, Math.ceil(timeoutMs / 1000)),
          allowInternet: allowInternet(config),
        })
        sandboxTimeouts.set(sandbox, timeoutMs)
        sandboxEnvironments.set(sandbox, validateEnvironment(options?.envs))
        sandboxClients.set(sandbox, getClient(config))

        if (options?.signal?.aborted) {
          await sandbox.delete().catch(() => {})
          throw options.signal.reason ?? new Error('Sandbox creation aborted')
        }
        return { sandbox, sandboxId: sandbox.id }
      },

      getById: async (config: ConfigWithClient, sandboxId: string) => {
        try {
          const sandbox = await getClient(config).sandbox(sandboxId)
          if (terminal(sandbox.resource.state)) return null
          sandboxClients.set(sandbox, getClient(config))
          return { sandbox, sandboxId }
        } catch (error) {
          if (isMissing(error)) return null
          throw error
        }
      },

      list: async (config: ConfigWithClient) => {
        const client = getClient(config)
        const resources = await client.listSandboxes()
        const active = resources.filter(resource => !terminal(resource.state))
        return Promise.all(active.map(async resource => {
          const sandbox = await client.sandbox(resourceString(resource, 'id'))
          sandboxClients.set(sandbox, client)
          return { sandbox, sandboxId: sandbox.id }
        }))
      },

      destroy: async (config: ConfigWithClient, sandboxId: string) => {
        const client = getClient(config)
        try {
          const sandbox = await client.sandbox(sandboxId)
          await sandbox.delete()
        } catch (error) {
          if (!isMissing(error)) throw error
          return
        }
        await waitUntilDeleted(client, sandboxId)
      },

      runCommand: async (sandbox: Sandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startedAt = performance.now()
        const timeoutMs = options?.timeout ?? sandboxTimeouts.get(sandbox) ?? DEFAULT_TIMEOUT_MS
        const stdoutDecoder = new TextDecoder()
        const stderrDecoder = new TextDecoder()
        const result = await sandbox.run(commandArgv(command, options?.background ?? false), {
          cwd: options?.cwd,
          env: {
            ...(sandboxEnvironments.get(sandbox) ?? {}),
            ...validateEnvironment(options?.env),
          },
          timeoutSeconds: Math.max(1, Math.ceil(timeoutMs / 1000)),
          onEvent: event => {
            if ((event.type === 'stdout' || event.type === 'stderr') && typeof event.data === 'string') {
              const chunk = Buffer.from(event.data, 'base64')
              if (event.type === 'stdout') options?.onStdout?.(stdoutDecoder.decode(chunk, { stream: true }))
              else options?.onStderr?.(stderrDecoder.decode(chunk, { stream: true }))
            }
          },
        })
        options?.onStdout?.(stdoutDecoder.decode())
        options?.onStderr?.(stderrDecoder.decode())
        return {
          stdout: result.stdoutText,
          stderr: result.stderrText,
          exitCode: result.exitCode,
          durationMs: performance.now() - startedAt,
        }
      },

      getInfo: async (sandbox: Sandbox): Promise<SandboxInfo> => {
        const client = sandboxClients.get(sandbox)
        if (!client) throw new Error(`Brezel client is unavailable for sandbox: ${sandbox.id}`)
        const current = await client.sandbox(sandbox.id)
        const resource = current.resource
        return {
          id: sandbox.id,
          provider: 'brezel',
          status: status(resource.state),
          createdAt: new Date(resourceString(resource, 'created_at')),
          timeout: sandboxTimeouts.get(sandbox) ?? DEFAULT_TIMEOUT_MS,
          metadata: {
            environmentRevision: resource.environment_revision,
            revision: resource.revision,
          },
        }
      },

      getUrl: async (sandbox: Sandbox, options: { port: number; protocol?: string }) => {
        const value = await sandbox.preview(options.port)
        if (!options.protocol) return value
        const url = new URL(value)
        url.protocol = `${options.protocol}:`
        return url.toString()
      },

      getInstance: (sandbox: Sandbox) => sandbox,

      filesystem: {
        readFile: async (sandbox: Sandbox, path: string): Promise<string> => {
          return new TextDecoder('utf-8', { fatal: true }).decode(await sandbox.readFile(path))
        },

        writeFile: async (sandbox: Sandbox, path: string, content: string): Promise<void> => {
          await sandbox.writeFile(path, content)
        },

        mkdir: async (sandbox: Sandbox, path: string): Promise<void> => {
          await sandbox.run(['mkdir', '-p', '--', path], { check: true })
        },

        readdir: async (sandbox: Sandbox, path: string): Promise<FileEntry[]> => {
          const result = await sandbox.run([
            'find', path, '-mindepth', '1', '-maxdepth', '1',
            '-printf', '%f\\0%y\\0%s\\0%T@\\0',
          ], { check: true })
          const values = result.stdoutText.split('\0')
          const entries: FileEntry[] = []
          for (let offset = 0; offset + 3 < values.length; offset += 4) {
            if (!values[offset]) continue
            entries.push({
              name: values[offset],
              type: values[offset + 1] === 'd' ? 'directory' : 'file',
              size: Number.parseInt(values[offset + 2], 10) || 0,
              modified: new Date(Number.parseFloat(values[offset + 3]) * 1000),
            })
          }
          return entries
        },

        exists: async (sandbox: Sandbox, path: string): Promise<boolean> => {
          const result = await sandbox.run(['/bin/sh', '-c', 'test -e "$1"', 'sh', path])
          return result.exitCode === 0
        },

        remove: async (sandbox: Sandbox, path: string): Promise<void> => {
          await sandbox.run(['rm', '-rf', '--', path], { check: true })
        },
      },
    },
  },
})
