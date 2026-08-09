/**
 * @computesdk/runtools — RunTools provider for ComputeSDK.
 *
 * Uses the public @runtools-ai/sdk surface, so benchmark traffic follows the
 * same create, exec, URL, and destroy paths as every other RunTools customer.
 */

import { RunTools, RunToolsApiError } from '@runtools-ai/sdk'
import { defineProvider } from '@computesdk/provider'

import type {
  Sandbox as NativeSandbox,
  SandboxCreateOptions as NativeCreateOptions,
  SandboxState as NativeSandboxState,
  SandboxStatus as NativeSandboxStatus,
  SandboxSummary as NativeSandboxSummary,
} from '@runtools-ai/sdk'
import type {
  CommandResult,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
  SandboxInfo,
} from '@computesdk/provider'

const PROVIDER_NAME = 'runtools'
const DEFAULT_TEMPLATE = 'base-ubuntu'
const DEFAULT_TIMEOUT_MS = 300_000

export interface RunToolsConfig {
  /** RunTools API key. Falls back to RUNTOOLS_API_KEY. */
  apiKey?: string
  /** RunTools API origin. Falls back to RUNTOOLS_API_URL, then production. */
  apiUrl?: string
  /** Default RunTools sandbox template. */
  template?: string
  /** Default ComputeSDK timeout and RunTools idle lease, in milliseconds. */
  timeout?: number
}

/** ComputeSDK options plus RunTools-native create fields. */
export interface RunToolsCreateOptions extends CreateSandboxOptions {
  template?: string
  tags?: string[]
  sshKeys?: string[]
  rootPassword?: string
  idleTimeout?: number
  resources?: {
    vcpus?: number
    memory?: string
    disk?: string
  }
}

interface SandboxContext {
  client: RunTools
  timeout: number
  createdAt?: Date
  template?: string
}

const clients = new WeakMap<RunToolsConfig, RunTools>()
const sandboxContexts = new WeakMap<NativeSandbox, SandboxContext>()

function env(key: string): string | undefined {
  return typeof process !== 'undefined' ? process.env?.[key] : undefined
}

function getClient(config: RunToolsConfig): RunTools {
  let client = clients.get(config)
  if (client) return client

  const apiKey = config.apiKey ?? env('RUNTOOLS_API_KEY')
  if (!apiKey) {
    throw new Error(
      "Missing RunTools API key. Provide 'apiKey' in config or set RUNTOOLS_API_KEY.",
    )
  }

  client = new RunTools({
    apiKey,
    apiUrl: config.apiUrl ?? env('RUNTOOLS_API_URL'),
  })
  clients.set(config, client)
  return client
}

function isNotFound(error: unknown): boolean {
  return error instanceof RunToolsApiError && error.status === 404
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

export function resolveTemplate(
  options: RunToolsCreateOptions,
  config: RunToolsConfig,
): string {
  const requested = options.template ?? options.templateId ?? options.image ?? config.template
  if (!requested || requested === 'node' || requested === 'python') return DEFAULT_TEMPLATE
  return String(requested)
}

function resolveResources(options: RunToolsCreateOptions): NativeCreateOptions['resources'] {
  const explicit = options.resources
  const vcpus = explicit?.vcpus
    ?? positiveNumber(options.vcpus)
    ?? positiveNumber(options.cpus)
    ?? positiveNumber(options.cpu)

  const memoryMb = positiveNumber(options.memoryMb)
    ?? positiveNumber(options.memoryMiB)
    ?? positiveNumber(options.memMiB)
    ?? positiveNumber(typeof options.memory === 'number' ? options.memory : undefined)
  const diskMiB = positiveNumber(options.diskMiB)

  const memory = explicit?.memory ?? (memoryMb ? `${Math.ceil(memoryMb)}MB` : undefined)
  const disk = explicit?.disk ?? (diskMiB ? `${Math.ceil(diskMiB / 1024)}GB` : undefined)

  if (vcpus === undefined && memory === undefined && disk === undefined) return undefined
  return { vcpus, memory, disk }
}

function contextForSummary(
  client: RunTools,
  timeout: number,
  summary?: NativeSandboxSummary | NativeSandboxState,
): SandboxContext {
  return {
    client,
    timeout,
    createdAt: summary?.createdAt ? new Date(summary.createdAt) : undefined,
    template: summary?.template,
  }
}

function rememberSandbox(
  sandbox: NativeSandbox,
  context: SandboxContext,
): NativeSandbox {
  sandboxContexts.set(sandbox, context)
  return sandbox
}

export function mapStatus(status: NativeSandboxStatus): SandboxInfo['status'] {
  if (status === 'running') return 'running'
  if (
    status === 'failed'
    || status === 'error'
    || status === 'orphaned'
    || status === 'suspected_missing'
  ) return 'error'
  return 'stopped'
}

/** Quote one complete POSIX shell token. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function commandFailure(action: string, result: CommandResult): Error {
  const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`
  return new Error(`${action}: ${detail}`)
}

function assertCommand(action: string, result: CommandResult): void {
  if (result.exitCode !== 0) throw commandFailure(action, result)
}

export function parseFindOutput(stdout: string): FileEntry[] {
  const fields = stdout.split('\0')
  const entries: FileEntry[] = []
  for (let i = 0; i + 3 < fields.length; i += 4) {
    const name = fields[i]
    if (!name) continue
    const type = fields[i + 1]
    const size = Number(fields[i + 2])
    const modifiedSeconds = Number(fields[i + 3])
    entries.push({
      name,
      type: type === 'd' ? 'directory' : 'file',
      size: Number.isFinite(size) ? size : undefined,
      modified: Number.isFinite(modifiedSeconds)
        ? new Date(modifiedSeconds * 1000)
        : undefined,
    })
  }
  return entries
}

type CommandRunner = (
  sandbox: NativeSandbox,
  command: string,
  options?: RunCommandOptions,
) => Promise<CommandResult>

export const runtools = defineProvider<NativeSandbox, RunToolsConfig>({
  name: PROVIDER_NAME,
  methods: {
    sandbox: {
      create: async (config, options) => {
        const client = getClient(config)
        const opts = (options ?? {}) as RunToolsCreateOptions
        const timeout = opts.timeout ?? config.timeout ?? DEFAULT_TIMEOUT_MS
        const template = resolveTemplate(opts, config)

        const sandbox = await client.sandbox.create({
          template,
          name: opts.name,
          tags: opts.tags,
          sshKeys: opts.sshKeys,
          rootPassword: opts.rootPassword,
          resources: resolveResources(opts),
          env: opts.envs,
          idleTimeout: opts.idleTimeout ?? Math.max(1, Math.ceil(timeout / 1000)),
        })

        rememberSandbox(sandbox, contextForSummary(client, timeout, sandbox.state ?? undefined))
        return { sandbox, sandboxId: sandbox.id }
      },

      getById: async (config, sandboxId) => {
        const client = getClient(config)
        const sandbox = client.sandbox.get(sandboxId)
        try {
          const state = await sandbox.refresh()
          rememberSandbox(
            sandbox,
            contextForSummary(client, config.timeout ?? DEFAULT_TIMEOUT_MS, state),
          )
          return { sandbox, sandboxId }
        } catch (error) {
          if (isNotFound(error)) return null
          throw error
        }
      },

      list: async (config) => {
        const client = getClient(config)
        const summaries = await client.sandbox.list()
        return summaries.map((summary) => {
          const sandbox = client.sandbox.get(summary.id)
          rememberSandbox(
            sandbox,
            contextForSummary(client, config.timeout ?? DEFAULT_TIMEOUT_MS, summary),
          )
          return { sandbox, sandboxId: summary.id }
        })
      },

      destroy: async (config, sandboxId) => {
        try {
          await getClient(config).sandbox.destroy(sandboxId)
        } catch (error) {
          if (!isNotFound(error)) throw error
        }
      },

      runCommand: async (sandbox, command, options): Promise<CommandResult> => {
        const startedAt = Date.now()
        const nativeOptions = {
          timeout: options?.timeout,
          cwd: options?.cwd,
          env: { HOME: '/root', ...options?.env },
        }
        const executable = options?.background
          ? `nohup sh -lc ${shellQuote(command)} >/dev/null 2>&1 &`
          : command
        const result = await sandbox.exec(executable, nativeOptions)
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          durationMs: Date.now() - startedAt,
        }
      },

      getInfo: async (sandbox): Promise<SandboxInfo> => {
        const state = sandbox.state ?? await sandbox.refresh()
        const context = sandboxContexts.get(sandbox)
        return {
          id: sandbox.id,
          provider: PROVIDER_NAME,
          status: mapStatus(state.status),
          createdAt: context?.createdAt
            ?? (state.createdAt ? new Date(state.createdAt) : new Date()),
          timeout: context?.timeout ?? DEFAULT_TIMEOUT_MS,
          metadata: {
            template: state.template ?? context?.template,
            sshReady: state.sshReady,
            runtoolsStatus: state.status,
          },
        }
      },

      getUrl: async (sandbox, options): Promise<string> => {
        const context = sandboxContexts.get(sandbox)
        if (!context) throw new Error(`Missing RunTools client context for ${sandbox.id}`)
        const result = await context.client.sandbox.getUrl(sandbox.id, options.port)
        if (!options.protocol) return result.url
        const url = new URL(result.url)
        url.protocol = `${options.protocol}:`
        return url.toString()
      },

      getInstance: (sandbox) => sandbox,

      filesystem: {
        readFile: async (sandbox, path, runCommand: CommandRunner): Promise<string> => {
          const result = await runCommand(sandbox, `cat -- ${shellQuote(path)}`)
          assertCommand(`Failed to read ${path}`, result)
          return result.stdout
        },

        writeFile: async (sandbox, path, content, runCommand: CommandRunner): Promise<void> => {
          const encoded = Buffer.from(content, 'utf8').toString('base64')
          const result = await runCommand(
            sandbox,
            `printf %s ${shellQuote(encoded)} | base64 --decode > ${shellQuote(path)}`,
          )
          assertCommand(`Failed to write ${path}`, result)
        },

        mkdir: async (sandbox, path, runCommand: CommandRunner): Promise<void> => {
          const result = await runCommand(sandbox, `mkdir -p -- ${shellQuote(path)}`)
          assertCommand(`Failed to create ${path}`, result)
        },

        readdir: async (sandbox, path, runCommand: CommandRunner): Promise<FileEntry[]> => {
          const result = await runCommand(
            sandbox,
            `find ${shellQuote(path)} -mindepth 1 -maxdepth 1 -printf '%f\\0%y\\0%s\\0%T@\\0'`,
          )
          assertCommand(`Failed to list ${path}`, result)
          return parseFindOutput(result.stdout)
        },

        exists: async (sandbox, path, runCommand: CommandRunner): Promise<boolean> => {
          const result = await runCommand(sandbox, `test -e ${shellQuote(path)}`)
          if (result.exitCode === 0) return true
          if (result.exitCode === 1) return false
          throw commandFailure(`Failed to inspect ${path}`, result)
        },

        remove: async (sandbox, path, runCommand: CommandRunner): Promise<void> => {
          const result = await runCommand(sandbox, `rm -rf -- ${shellQuote(path)}`)
          assertCommand(`Failed to remove ${path}`, result)
        },
      },
    },
  },
})
