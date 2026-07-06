/**
 * @computesdk/cloud-run - Google Cloud Run Sandboxes provider.
 *
 * Cloud Run Sandboxes are currently exposed as an in-container `sandbox` CLI.
 * This provider must run inside a Cloud Run service deployed with
 * `gcloud beta run deploy --sandbox-launcher`.
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access } from 'node:fs/promises'
import { defineProvider, escapeShellArg } from '@computesdk/provider'
import type {
  CommandResult,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
  SandboxInfo,
} from '@computesdk/provider'

const PROVIDER = 'cloud-run' as const
const DEFAULT_SANDBOX_BINARY = '/usr/local/gcp/bin/sandbox'
const DEFAULT_TIMEOUT_MS = 300_000

export interface CloudRunMount {
  type?: 'bind'
  src: string
  dst: string
}

export interface CloudRunConfig {
  /** URL of the deployed Cloud Run gateway service for remote mode. */
  sandboxUrl?: string
  /** Shared bearer token for the deployed Cloud Run gateway service. */
  sandboxSecret?: string
  /** Optional Google-signed identity token for Cloud Run services that require IAM auth. */
  gatewayAuthToken?: string
  /** Path to the Cloud Run sandbox binary. Defaults to CLOUD_RUN_SANDBOX_BINARY or /usr/local/gcp/bin/sandbox. */
  sandboxBinary?: string
  /** Sandbox CLI mode. Cloud Run's CLI defaults this to local. */
  mode?: 'local' | 'container'
  /** Allow network egress from sandboxed commands. GCP service account access remains blocked by Cloud Run. */
  allowEgress?: boolean
  /** Root filesystem to expose to sandboxes. Defaults to /. */
  rootfs?: string
  /** Working directory for newly-created persistent sandbox sessions. */
  workdir?: string
  /** Container template name for Cloud Run multi-container services. */
  template?: string
  /** Writable persistent host path shared across executions. */
  persistDir?: string
  /** Writable overlay directory. Caller is responsible for cleanup. */
  overlayDir?: string
  /** Allow mounted filesystems to be writable. */
  write?: boolean
  /** Bind mounts to attach to the sandbox. */
  mounts?: CloudRunMount[]
  /** Environment variables applied when the persistent sandbox starts. */
  env?: Record<string, string>
  /** Extra args passed before the sandbox subcommand, e.g. global debug flags. */
  globalArgs?: string[]
  /** Extra args passed to `sandbox do`. */
  runArgs?: string[]
}

export interface CloudRunSandbox {
  id: string
  createdAt: Date
  config: CloudRunConfig
  remote: boolean
}

const activeSandboxes = new Map<string, CloudRunSandbox>()

interface SpawnResult {
  stdout: string
  stderr: string
  exitCode: number
}

function getBinary(config: CloudRunConfig): string {
  return config.sandboxBinary ?? process.env.CLOUD_RUN_SANDBOX_BINARY ?? DEFAULT_SANDBOX_BINARY
}

function isRemote(config: CloudRunConfig): boolean {
  return !!(config.sandboxUrl && config.sandboxSecret)
}

async function gatewayRequest(config: CloudRunConfig, path: string, body: Record<string, unknown> = {}): Promise<any> {
  if (!config.sandboxUrl || !config.sandboxSecret) {
    throw new Error('Missing Cloud Run remote config. Set CLOUD_RUN_SANDBOX_URL and CLOUD_RUN_SANDBOX_SECRET.')
  }
  const baseUrl = config.sandboxUrl.replace(/\/$/, '')
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-ComputeSDK-Cloud-Run-Secret': config.sandboxSecret,
      ...(config.gatewayAuthToken ?? process.env.CLOUD_RUN_AUTH_TOKEN
        ? { 'Authorization': `Bearer ${config.gatewayAuthToken ?? process.env.CLOUD_RUN_AUTH_TOKEN}` }
        : {}),
    },
    body: JSON.stringify(body),
  })

  let data: any
  try {
    data = await response.json()
  } catch {
    const text = await response.text().catch(() => '(unreadable)')
    throw new Error(`Cloud Run gateway request failed: ${response.status} - ${text.slice(0, 200)}`)
  }

  if (!response.ok) throw new Error(data.error || `Cloud Run gateway request failed: ${response.status}`)
  return data
}

async function assertSandboxBinary(config: CloudRunConfig): Promise<void> {
  const binary = getBinary(config)
  if (binary.includes('/')) {
    try {
      await access(binary)
    } catch {
      throw new Error(
        `Cloud Run sandbox binary not found at ${binary}. ` +
        `Deploy this service with 'gcloud beta run deploy --sandbox-launcher' or set CLOUD_RUN_SANDBOX_BINARY.`
      )
    }
  }
}

function validateEnvName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid environment variable name: ${JSON.stringify(name)}`)
  }
}

function formatMount(mount: CloudRunMount): string {
  return `type=${mount.type ?? 'bind'},src=${mount.src},dst=${mount.dst}`
}

function pushRunArgs(args: string[], config: CloudRunConfig, env?: Record<string, string>, workdir?: string): void {
  if (config.allowEgress) args.push('--allow-egress')
  if (config.rootfs) args.push('--rootfs', config.rootfs)
  if (workdir ?? config.workdir) args.push('--workdir', workdir ?? config.workdir!)
  if (config.template) args.push('--template', config.template)
  if (config.persistDir) args.push('--persist-dir', config.persistDir)
  if (config.overlayDir) args.push('--overlaydir', config.overlayDir)
  if (config.write) args.push('--write')
  for (const mount of config.mounts ?? []) args.push('--mount', formatMount(mount))
  for (const [key, value] of Object.entries({ ...config.env, ...env })) {
    validateEnvName(key)
    args.push('-e', `${key}=${value}`)
  }
}

function buildBaseArgs(config: CloudRunConfig): string[] {
  const args = [...(config.globalArgs ?? [])]
  if (config.mode) args.push('--mode', config.mode)
  return args
}

async function runSandboxCli(
  config: CloudRunConfig,
  args: string[],
  options?: { timeout?: number; onStdout?: (data: string) => void; onStderr?: (data: string) => void }
): Promise<SpawnResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options?.timeout ?? DEFAULT_TIMEOUT_MS)

  return new Promise<SpawnResult>((resolve, reject) => {
    const child = spawn(getBinary(config), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: controller.signal,
    })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      const data = chunk.toString('utf8')
      stdout += data
      options?.onStdout?.(data)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      const data = chunk.toString('utf8')
      stderr += data
      options?.onStderr?.(data)
    })
    child.on('error', (error) => {
      clearTimeout(timeout)
      if ((error as NodeJS.ErrnoException).name === 'AbortError') {
        resolve({ stdout, stderr: stderr || `Command timed out after ${options?.timeout ?? DEFAULT_TIMEOUT_MS}ms`, exitCode: 124 })
        return
      }
      reject(error)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timeout)
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        resolve({ stdout, stderr: stderr || `Command terminated by ${signal}`, exitCode: 124 })
        return
      }
      resolve({ stdout, stderr, exitCode: code ?? 1 })
    })
  })
}

function withShellOptions(command: string, options?: RunCommandOptions): string {
  let fullCommand = command
  if (options?.cwd) fullCommand = `cd "${escapeShellArg(options.cwd)}" && ${fullCommand}`
  if (options?.background) fullCommand = `nohup /bin/sh -c "${escapeShellArg(fullCommand)}" >/dev/null 2>&1 &`
  return fullCommand
}

async function execInSandbox(sandbox: CloudRunSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> {
  const start = Date.now()
  if (sandbox.remote) {
    try {
      const result = await gatewayRequest(sandbox.config, '/v1/sandbox/exec', {
        sandboxId: sandbox.id,
        command: withShellOptions(command, options),
        cwd: options?.cwd ?? sandbox.config.workdir,
        env: { ...sandbox.config.env, ...options?.env },
        timeout: options?.timeout,
      })
      return {
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        exitCode: result.exitCode ?? 0,
        durationMs: Date.now() - start,
      }
    } catch (error) {
      return { stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 127, durationMs: Date.now() - start }
    }
  }

  const args = [...buildBaseArgs(sandbox.config), 'do']
  pushRunArgs(args, sandbox.config, options?.env, options?.cwd)
  args.push(...(sandbox.config.runArgs ?? []))
  args.push('--', '/bin/sh', '-c', withShellOptions(command, options))
  const result = await runSandboxCli(sandbox.config, args, {
    timeout: options?.timeout,
    onStdout: options?.onStdout,
    onStderr: options?.onStderr,
  })
  return { ...result, durationMs: Date.now() - start }
}

type FsRunCommand = (sandbox: CloudRunSandbox, command: string, options?: RunCommandOptions) => Promise<CommandResult>

export const cloudRun = defineProvider<CloudRunSandbox, CloudRunConfig>({
  name: PROVIDER,
  methods: {
    sandbox: {
      create: async (config: CloudRunConfig = {}, options?: CreateSandboxOptions) => {
        const sandboxConfig = {
          ...config,
          env: { ...config.env, ...options?.envs },
          workdir: options?.directory ?? config.workdir,
        }
        if (isRemote(config)) {
          const sandboxId = options?.name ?? `cloud-run-${randomUUID()}`
          const response = await gatewayRequest(config, '/v1/sandbox/create', {
            sandboxId,
            timeout: options?.timeout,
          })
          const sandbox = { id: response.sandboxId ?? sandboxId, createdAt: new Date(), config: sandboxConfig, remote: true }
          activeSandboxes.set(sandbox.id, sandbox)
          return { sandbox, sandboxId: sandbox.id }
        }

        await assertSandboxBinary(sandboxConfig)
        const sandboxId = options?.name ?? `cloud-run-${randomUUID()}`
        const sandbox = { id: sandboxId, createdAt: new Date(), config: sandboxConfig, remote: false }
        activeSandboxes.set(sandboxId, sandbox)
        return { sandbox, sandboxId }
      },

      getById: async (config: CloudRunConfig, sandboxId: string) => {
        if (isRemote(config)) {
          try {
            await gatewayRequest(config, '/v1/sandbox/info', { sandboxId })
            const sandbox = activeSandboxes.get(sandboxId) ?? { id: sandboxId, createdAt: new Date(), config, remote: true }
            return { sandbox, sandboxId }
          } catch { return null }
        }
        const sandbox = activeSandboxes.get(sandboxId) ?? { id: sandboxId, createdAt: new Date(), config, remote: false }
        return { sandbox, sandboxId }
      },

      list: async (_config: CloudRunConfig) => Array.from(activeSandboxes.entries()).map(([sandboxId, sandbox]) => ({ sandbox, sandboxId })),

      destroy: async (config: CloudRunConfig, sandboxId: string) => {
        if (isRemote(config)) {
          try {
            await gatewayRequest(config, '/v1/sandbox/destroy', { sandboxId })
          } finally {
            activeSandboxes.delete(sandboxId)
          }
          return
        }

        activeSandboxes.delete(sandboxId)
      },

      runCommand: execInSandbox,

      getInfo: async (sandbox: CloudRunSandbox): Promise<SandboxInfo> => ({
        id: sandbox.id,
        provider: PROVIDER,
        status: 'running',
        createdAt: sandbox.createdAt,
        timeout: DEFAULT_TIMEOUT_MS,
        metadata: {
          remote: sandbox.remote,
          mode: sandbox.config.mode ?? 'local',
          allowEgress: sandbox.config.allowEgress ?? false,
          rootfs: sandbox.config.rootfs ?? '/',
          persistDir: sandbox.config.persistDir,
          overlayDir: sandbox.config.overlayDir,
        },
      }),

      getUrl: async (_sandbox: CloudRunSandbox, options: { port: number; protocol?: string }) => {
        throw new Error(`Cloud Run Sandboxes do not expose per-sandbox ports through the sandbox CLI. Cannot expose port ${options.port}.`)
      },

      filesystem: {
        readFile: async (sandbox: CloudRunSandbox, path: string, runCommand: FsRunCommand): Promise<string> => {
          if (sandbox.remote) return gatewayRequest(sandbox.config, '/v1/sandbox/readFile', { sandboxId: sandbox.id, path })
          const escapedPath = escapeShellArg(path)
          const r = await runCommand(sandbox, `if [ -f "${escapedPath}" ]; then base64 "${escapedPath}" | tr -d '\\n'; else exit 1; fi`)
          if (r.exitCode !== 0) throw new Error(r.stderr || `File not found: ${path}`)
          return Buffer.from(r.stdout, 'base64').toString('utf8')
        },
        writeFile: async (sandbox: CloudRunSandbox, path: string, content: string, runCommand: FsRunCommand): Promise<void> => {
          if (sandbox.remote) {
            await gatewayRequest(sandbox.config, '/v1/sandbox/writeFile', { sandboxId: sandbox.id, path, content })
            return
          }
          const escapedPath = escapeShellArg(path)
          const b64 = Buffer.from(content, 'utf8').toString('base64')
          const r = await runCommand(sandbox, `mkdir -p "$(dirname "${escapedPath}")" && printf '%s' '${b64}' | base64 -d > "${escapedPath}"`)
          if (r.exitCode !== 0) throw new Error(r.stderr || `Failed to write: ${path}`)
        },
        mkdir: async (sandbox: CloudRunSandbox, path: string, runCommand: FsRunCommand): Promise<void> => {
          if (sandbox.remote) {
            await gatewayRequest(sandbox.config, '/v1/sandbox/mkdir', { sandboxId: sandbox.id, path })
            return
          }
          const r = await runCommand(sandbox, `mkdir -p "${escapeShellArg(path)}"`)
          if (r.exitCode !== 0) throw new Error(r.stderr || `Failed to create directory: ${path}`)
        },
        readdir: async (sandbox: CloudRunSandbox, path: string, runCommand: FsRunCommand): Promise<FileEntry[]> => {
          if (sandbox.remote) return gatewayRequest(sandbox.config, '/v1/sandbox/readdir', { sandboxId: sandbox.id, path })
          const r = await runCommand(sandbox, `ls -la "${escapeShellArg(path)}"`)
          if (r.exitCode !== 0) throw new Error(r.stderr || `Cannot read directory: ${path}`)
          const entries: FileEntry[] = []
          for (const line of r.stdout.split('\n')) {
            if (!line.trim() || line.startsWith('total ')) continue
            const parts = line.trim().split(/\s+/)
            if (parts.length < 9) continue
            const name = parts.slice(8).join(' ')
            if (name === '.' || name === '..') continue
            entries.push({ name, type: parts[0].startsWith('d') ? 'directory' : 'file', size: Number.parseInt(parts[4], 10) || 0 })
          }
          return entries
        },
        exists: async (sandbox: CloudRunSandbox, path: string, runCommand: FsRunCommand): Promise<boolean> => {
          if (sandbox.remote) return gatewayRequest(sandbox.config, '/v1/sandbox/exists', { sandboxId: sandbox.id, path })
          const r = await runCommand(sandbox, `test -e "${escapeShellArg(path)}"`)
          return r.exitCode === 0
        },
        remove: async (sandbox: CloudRunSandbox, path: string, runCommand: FsRunCommand): Promise<void> => {
          if (sandbox.remote) {
            await gatewayRequest(sandbox.config, '/v1/sandbox/remove', { sandboxId: sandbox.id, path })
            return
          }
          const r = await runCommand(sandbox, `rm -rf "${escapeShellArg(path)}"`)
          if (r.exitCode !== 0) throw new Error(r.stderr || `Failed to remove: ${path}`)
        },
      },

      getInstance: (sandbox: CloudRunSandbox) => sandbox,
    },
  },
})

export type { CloudRunSandbox as CloudRunSandboxInstance }
