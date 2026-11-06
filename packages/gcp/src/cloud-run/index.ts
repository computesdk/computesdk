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
import { performance } from 'node:perf_hooks'
import { defineProvider, escapeShellArg } from '@computesdk/provider'
import type {
  CommandResult,
  CreateInstanceOptions,
  FileEntry,
  RunCommandOptions,
  InstanceInfo,
} from '@computesdk/provider'

const PROVIDER = 'cloud-run' as const
const DEFAULT_SANDBOX_BINARY = '/usr/local/gcp/bin/sandbox'
const DEFAULT_TIMEOUT_MS = 300_000

export interface CloudRunMount {
  type?: 'bind'
  src: string
  dst: string
}

export type CloudRunExecutionMode = 'ephemeral' | 'stateful'

export interface CloudRunConfig {
  /** URL of the deployed Cloud Run gateway service for remote mode. */
  sandboxUrl?: string
  /** Shared bearer token for the deployed Cloud Run gateway service. */
  sandboxSecret?: string
  /** Optional Google-signed identity token for Cloud Run services that require IAM auth. */
  gatewayAuthToken?: string
  /** Execution mode. Ephemeral uses `sandbox do`; stateful uses `sandbox run`, `exec`, and `delete`. Defaults to ephemeral. */
  executionMode?: CloudRunExecutionMode
  /** Path to the Cloud Run sandbox binary. Defaults to CLOUD_RUN_SANDBOX_BINARY or /usr/local/gcp/bin/sandbox. */
  sandboxBinary?: string
  /** Sandbox CLI mode. Cloud Run's CLI defaults this to local. */
  mode?: 'local' | 'container'
  /** Allow network egress from sandboxed commands. GCP service account access remains blocked by Cloud Run. */
  allowEgress?: boolean
  /** Root filesystem to expose to sandboxes. Defaults to /. */
  rootfs?: string
  /** Working directory for sandboxed commands or newly-created stateful sessions. */
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
  /** Environment variables applied to sandboxed commands or newly-created stateful sessions. */
  env?: Record<string, string>
  /** Extra args passed before the sandbox subcommand, e.g. global debug flags. */
  globalArgs?: string[]
  /** Extra args passed to `sandbox do` and `sandbox run`. */
  runArgs?: string[]
  /** Extra args passed to `sandbox exec` in stateful mode. */
  execArgs?: string[]
}

export interface CloudRunSandbox {
  id: string
  createdAt: Date
  config: CloudRunConfig
  remote: boolean
  /** Session-affinity cookie of the gateway instance that holds this stateful sandbox. */
  affinity?: string
}

export interface CloudRunSnapshot {
  id: string
  provider: typeof PROVIDER
  createdAt: Date
  metadata: { uri?: string; store?: 'gcs' | 'local'; size?: number; sourceSandboxId?: string }
}

/** Sandbox-run session state a gateway request is made for. */
type GatewaySession = { affinity?: string }

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

function getExecutionMode(config: CloudRunConfig): CloudRunExecutionMode {
  return config.executionMode ?? 'ephemeral'
}

function gatewayAuthHeaders(config: CloudRunConfig): Record<string, string> {
  const token = config.gatewayAuthToken ?? process.env.CLOUD_RUN_AUTH_TOKEN
  return token ? { 'Authorization': `Bearer ${token}` } : {}
}

// Stateful sandboxes live on one gateway instance; Cloud Run's session
// affinity cookie routes follow-up requests back to it.
function captureAffinity(response: Response, session?: GatewaySession): void {
  if (!session) return
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  const cookies = headers.getSetCookie?.() ?? (headers.get('set-cookie') ? [headers.get('set-cookie')!] : [])
  const pairs = cookies.map(cookie => cookie.split(';')[0].trim()).filter(Boolean)
  if (pairs.length > 0) session.affinity = pairs.join('; ')
}

async function gatewayFetch(config: CloudRunConfig, path: string, body: Record<string, unknown>, session?: GatewaySession, signal?: AbortSignal): Promise<Response> {
  if (!config.sandboxUrl || !config.sandboxSecret) {
    throw new Error('Missing Cloud Run remote config. Set CLOUD_RUN_SANDBOX_URL and CLOUD_RUN_SANDBOX_SECRET.')
  }
  const baseUrl = config.sandboxUrl.replace(/\/$/, '')
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-ComputeSDK-Cloud-Run-Secret': config.sandboxSecret,
      ...gatewayAuthHeaders(config),
      ...(session?.affinity ? { 'Cookie': session.affinity } : {}),
    },
    body: JSON.stringify(body),
    signal,
  })
  captureAffinity(response, session)
  return response
}

async function gatewayRequest(config: CloudRunConfig, path: string, body: Record<string, unknown> = {}, session?: GatewaySession): Promise<any> {
  const response = await gatewayFetch(config, path, body, session)

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

export type CloudRunGatewayFeature = 'stateful' | 'exec-stream' | 'snapshot' | 'fork'

const gatewayFeatureCache = new Map<string, Promise<string[]>>()

/** Features advertised by the gateway's `/v1/health`; gateways that predate feature flags report none. */
function gatewayFeatures(config: CloudRunConfig): Promise<string[]> {
  const baseUrl = config.sandboxUrl!.replace(/\/$/, '')
  let features = gatewayFeatureCache.get(baseUrl)
  if (!features) {
    features = fetch(`${baseUrl}/v1/health`, { headers: gatewayAuthHeaders(config) })
      .then(async response => {
        const data = await response.json() as { features?: unknown }
        return Array.isArray(data.features) ? data.features.map(String) : []
      })
    features.catch(() => gatewayFeatureCache.delete(baseUrl))
    gatewayFeatureCache.set(baseUrl, features)
  }
  return features
}

async function requireGatewayFeature(config: CloudRunConfig, feature: CloudRunGatewayFeature, what: string): Promise<void> {
  if (!isRemote(config)) throw new Error(`Cloud Run ${what} requires the remote gateway (set CLOUD_RUN_SANDBOX_URL and CLOUD_RUN_SANDBOX_SECRET).`)
  if (!(await gatewayFeatures(config)).includes(feature)) {
    throw new Error(`The Cloud Run gateway at ${config.sandboxUrl} does not support ${what}; redeploy it with the current @computesdk/gcp gateway (npx computesdk-cloud-run).`)
  }
}

function toSnapshot(data: any): CloudRunSnapshot {
  return {
    id: data.snapshotId,
    provider: PROVIDER,
    createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
    metadata: { uri: data.uri, store: data.store, size: data.size, sourceSandboxId: data.sourceSandboxId },
  }
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

function pushExecArgs(args: string[], config: CloudRunConfig, env?: Record<string, string>, workdir?: string): void {
  if (workdir ?? config.workdir) args.push('--workdir', workdir ?? config.workdir!)
  for (const [key, value] of Object.entries({ ...config.env, ...env })) {
    validateEnvName(key)
    args.push('-e', `${key}=${value}`)
  }
  args.push(...(config.execArgs ?? []))
}

function sandboxRequestBody(config: CloudRunConfig, body: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...body,
    executionMode: getExecutionMode(config),
    allowEgress: config.allowEgress,
    rootfs: config.rootfs,
    template: config.template,
    persistDir: config.persistDir,
    overlayDir: config.overlayDir,
    write: config.write,
    mounts: config.mounts,
    runArgs: config.runArgs,
    execArgs: config.execArgs,
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
      // A full inherited env can exceed the kernel's argv+env limit (E2BIG);
      // the CLI receives sandbox env via --env args, not the process env.
      env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? '/root' },
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
  const start = performance.now()
  if (sandbox.remote) {
    try {
      const executionMode = getExecutionMode(sandbox.config)
      const result = await gatewayRequest(sandbox.config, executionMode === 'stateful' ? '/v1/sandbox/exec' : '/v1/sandbox/do', sandboxRequestBody(sandbox.config, {
        sandboxId: sandbox.id,
        command: withShellOptions(command, options),
        cwd: options?.cwd ?? sandbox.config.workdir,
        env: { ...sandbox.config.env, ...options?.env },
        timeout: options?.timeout,
      }), sandbox)
      return {
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        exitCode: result.exitCode ?? 0,
        durationMs: Math.round(performance.now() - start),
      }
    } catch (error) {
      return { stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 127, durationMs: Math.round(performance.now() - start) }
    }
  }

  const executionMode = getExecutionMode(sandbox.config)
  const args = [...buildBaseArgs(sandbox.config), executionMode === 'stateful' ? 'exec' : 'do']
  if (executionMode === 'stateful') {
    args.push(sandbox.id)
    pushExecArgs(args, sandbox.config, options?.env, options?.cwd)
  } else {
    pushRunArgs(args, sandbox.config, options?.env, options?.cwd)
    args.push(...(sandbox.config.runArgs ?? []))
  }
  args.push('--', '/bin/sh', '-c', withShellOptions(command, options))
  const result = await runSandboxCli(sandbox.config, args, {
    timeout: options?.timeout,
    onStdout: options?.onStdout,
    onStderr: options?.onStderr,
  })
  return { ...result, durationMs: Math.round(performance.now() - start) }
}

async function streamInSandbox(sandbox: CloudRunSandbox, command: string, options: RunCommandOptions): Promise<CommandResult> {
  if (!sandbox.remote) return execInSandbox(sandbox, command, options)
  const start = performance.now()
  const { onStdout, onStderr, ...rest } = options
  let features: string[] = []
  try { features = await gatewayFeatures(sandbox.config) } catch { /* treated as a gateway without streaming */ }
  if (!features.includes('exec-stream')) {
    // Older gateways only answer at exit; deliver the output then.
    const result = await execInSandbox(sandbox, command, rest)
    if (result.stdout) onStdout?.(result.stdout)
    if (result.stderr) onStderr?.(result.stderr)
    return result
  }

  let stdout = ''
  let stderr = ''
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), (options.timeout ?? DEFAULT_TIMEOUT_MS) + 30_000)
  try {
    const response = await gatewayFetch(sandbox.config, '/v1/sandbox/exec/stream', sandboxRequestBody(sandbox.config, {
      sandboxId: sandbox.id,
      command: withShellOptions(command, rest),
      cwd: options.cwd ?? sandbox.config.workdir,
      env: { ...sandbox.config.env, ...options.env },
      timeout: options.timeout,
    }), sandbox, controller.signal)
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({})) as { error?: string }
      throw new Error(data.error || `Cloud Run gateway request failed: ${response.status}`)
    }
    const decoder = new TextDecoder()
    let buffered = ''
    let exitCode: number | undefined
    const handleLine = (line: string) => {
      if (!line.trim()) return
      const event = JSON.parse(line) as { type: string; data?: string; exitCode?: number; error?: string }
      if (event.type === 'stdout' && event.data) { stdout += event.data; onStdout?.(event.data) }
      else if (event.type === 'stderr' && event.data) { stderr += event.data; onStderr?.(event.data) }
      else if (event.type === 'exit') exitCode = event.exitCode ?? 1
      else if (event.type === 'error') throw new Error(event.error || 'Cloud Run gateway stream failed')
    }
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffered += decoder.decode(chunk, { stream: true })
      const lines = buffered.split('\n')
      buffered = lines.pop() ?? ''
      for (const line of lines) handleLine(line)
    }
    handleLine(buffered + decoder.decode())
    if (exitCode === undefined) throw new Error('Cloud Run gateway stream ended without an exit status')
    return { stdout, stderr, exitCode, durationMs: Math.round(performance.now() - start) }
  } catch (error) {
    const message = controller.signal.aborted ? `Command timed out after ${options.timeout ?? DEFAULT_TIMEOUT_MS}ms` : error instanceof Error ? error.message : String(error)
    return { stdout, stderr: stderr || message, exitCode: controller.signal.aborted ? 124 : 127, durationMs: Math.round(performance.now() - start) }
  } finally {
    clearTimeout(timer)
  }
}

type FsRunCommand = (sandbox: CloudRunSandbox, command: string, options?: RunCommandOptions) => Promise<CommandResult>

export const cloudRun = defineProvider<CloudRunSandbox, CloudRunConfig, any, CloudRunSnapshot>({
  name: PROVIDER,
  methods: {
    instances: {
      create: async (config: CloudRunConfig = {}, options?: CreateInstanceOptions) => {
        const snapshotId = options?.snapshotId
        if (snapshotId) await requireGatewayFeature(config, 'snapshot', 'snapshots')
        const sandboxConfig: CloudRunConfig = {
          ...config,
          env: { ...config.env, ...options?.envs },
          workdir: options?.directory ?? config.workdir,
          // Shared `ephemeral` create option overrides the configured
          // executionMode for this sandbox: true -> ephemeral, false -> stateful.
          // A snapshot restores into a stateful sandbox.
          executionMode: snapshotId
            ? 'stateful'
            : options?.ephemeral !== undefined
              ? options.ephemeral
                ? 'ephemeral'
                : 'stateful'
              : config.executionMode,
        }
        if (isRemote(config)) {
          const sandboxId = options?.name ?? `cloud-run-${randomUUID()}`
          if (getExecutionMode(sandboxConfig) === 'stateful') {
            const session: GatewaySession = {}
            const response = await gatewayRequest(config, '/v1/sandbox/create', sandboxRequestBody(sandboxConfig, {
              sandboxId,
              env: sandboxConfig.env,
              workdir: sandboxConfig.workdir,
              timeout: options?.timeout,
              ...(snapshotId ? { snapshotId } : {}),
            }), session)
            const sandbox = { id: response.sandboxId ?? sandboxId, createdAt: new Date(), config: sandboxConfig, remote: true, affinity: session.affinity }
            activeSandboxes.set(sandbox.id, sandbox)
            return { instance: sandbox, instanceId: sandbox.id }
          }
          const sandbox = { id: sandboxId, createdAt: new Date(), config: sandboxConfig, remote: true }
          activeSandboxes.set(sandbox.id, sandbox)
          return { instance: sandbox, instanceId: sandbox.id }
        }

        await assertSandboxBinary(sandboxConfig)
        const sandboxId = options?.name ?? `cloud-run-${randomUUID()}`
        if (getExecutionMode(sandboxConfig) === 'stateful') {
          const args = [...buildBaseArgs(sandboxConfig), 'run', sandboxId, '--detach']
          pushRunArgs(args, sandboxConfig, options?.envs, options?.directory)
          args.push(...(sandboxConfig.runArgs ?? []))
          const result = await runSandboxCli(sandboxConfig, args, { timeout: options?.timeout })
          if (result.exitCode !== 0) {
            throw new Error(result.stderr || `Failed to create Cloud Run sandbox ${sandboxId}`)
          }
        }
        const sandbox = { id: sandboxId, createdAt: new Date(), config: sandboxConfig, remote: false }
        activeSandboxes.set(sandboxId, sandbox)
        return { instance: sandbox, instanceId: sandboxId }
      },

      getById: async (config: CloudRunConfig, sandboxId: string) => {
        if (isRemote(config)) {
          try {
            const known = activeSandboxes.get(sandboxId)
            await gatewayRequest(config, '/v1/sandbox/info', { sandboxId }, known)
            const sandbox = known ?? { id: sandboxId, createdAt: new Date(), config, remote: true }
            return { instance: sandbox, instanceId: sandboxId }
          } catch { return null }
        }
        const sandbox = activeSandboxes.get(sandboxId) ?? { id: sandboxId, createdAt: new Date(), config, remote: false }
        return { instance: sandbox, instanceId: sandboxId }
      },

      list: async (_config: CloudRunConfig) => Array.from(activeSandboxes.entries()).map(([sandboxId, sandbox]) => ({ instance: sandbox, instanceId: sandboxId })),

      destroy: async (config: CloudRunConfig, sandboxId: string) => {
        // Destroy receives only an id, so resolve the mode the sandbox was
        // actually created with — a per-sandbox `ephemeral` override beats the
        // provider's configured executionMode.
        const known = activeSandboxes.get(sandboxId)
        const effectiveConfig = known?.config ?? config
        if (isRemote(config)) {
          try {
            if (getExecutionMode(effectiveConfig) === 'stateful') await gatewayRequest(config, '/v1/sandbox/destroy', { sandboxId }, known)
          } finally {
            activeSandboxes.delete(sandboxId)
          }
          return
        }
        if (getExecutionMode(effectiveConfig) === 'stateful') {
          const result = await runSandboxCli(config, [...buildBaseArgs(config), 'delete', sandboxId, '--force', '--stdin=false', '--stdout=false', '--stderr=false'], { timeout: 30_000 })
          if (result.exitCode !== 0 && result.exitCode !== 124 && !/not found|does not exist/i.test(result.stderr)) {
            throw new Error(result.stderr || `Failed to delete Cloud Run sandbox ${sandboxId}`)
          }
        }
        activeSandboxes.delete(sandboxId)
      },

      runCommand: execInSandbox,

      streamCommand: streamInSandbox,

      getInfo: async (sandbox: CloudRunSandbox): Promise<InstanceInfo> => ({
        id: sandbox.id,
        provider: PROVIDER,
        status: 'running',
        createdAt: sandbox.createdAt,
        timeout: DEFAULT_TIMEOUT_MS,
        metadata: {
          remote: sandbox.remote,
          executionMode: getExecutionMode(sandbox.config),
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
          if (sandbox.remote) return gatewayRequest(sandbox.config, '/v1/sandbox/readFile', sandboxRequestBody(sandbox.config, { sandboxId: sandbox.id, path }), sandbox)
          const escapedPath = escapeShellArg(path)
          const r = await runCommand(sandbox, `if [ -f "${escapedPath}" ]; then base64 "${escapedPath}" | tr -d '\\n'; else exit 1; fi`)
          if (r.exitCode !== 0) throw new Error(r.stderr || `File not found: ${path}`)
          return Buffer.from(r.stdout, 'base64').toString('utf8')
        },
        writeFile: async (sandbox: CloudRunSandbox, path: string, content: string, runCommand: FsRunCommand): Promise<void> => {
          if (sandbox.remote) {
            await gatewayRequest(sandbox.config, '/v1/sandbox/writeFile', sandboxRequestBody(sandbox.config, { sandboxId: sandbox.id, path, content }), sandbox)
            return
          }
          const escapedPath = escapeShellArg(path)
          const b64 = Buffer.from(content, 'utf8').toString('base64')
          const r = await runCommand(sandbox, `mkdir -p "$(dirname "${escapedPath}")" && printf '%s' '${b64}' | base64 -d > "${escapedPath}"`)
          if (r.exitCode !== 0) throw new Error(r.stderr || `Failed to write: ${path}`)
        },
        mkdir: async (sandbox: CloudRunSandbox, path: string, runCommand: FsRunCommand): Promise<void> => {
          if (sandbox.remote) {
            await gatewayRequest(sandbox.config, '/v1/sandbox/mkdir', sandboxRequestBody(sandbox.config, { sandboxId: sandbox.id, path }), sandbox)
            return
          }
          const r = await runCommand(sandbox, `mkdir -p "${escapeShellArg(path)}"`)
          if (r.exitCode !== 0) throw new Error(r.stderr || `Failed to create directory: ${path}`)
        },
        readdir: async (sandbox: CloudRunSandbox, path: string, runCommand: FsRunCommand): Promise<FileEntry[]> => {
          if (sandbox.remote) return gatewayRequest(sandbox.config, '/v1/sandbox/readdir', sandboxRequestBody(sandbox.config, { sandboxId: sandbox.id, path }), sandbox)
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
          if (sandbox.remote) return gatewayRequest(sandbox.config, '/v1/sandbox/exists', sandboxRequestBody(sandbox.config, { sandboxId: sandbox.id, path }), sandbox)
          const r = await runCommand(sandbox, `test -e "${escapeShellArg(path)}"`)
          return r.exitCode === 0
        },
        remove: async (sandbox: CloudRunSandbox, path: string, runCommand: FsRunCommand): Promise<void> => {
          if (sandbox.remote) {
            await gatewayRequest(sandbox.config, '/v1/sandbox/remove', sandboxRequestBody(sandbox.config, { sandboxId: sandbox.id, path }), sandbox)
            return
          }
          const r = await runCommand(sandbox, `rm -rf "${escapeShellArg(path)}"`)
          if (r.exitCode !== 0) throw new Error(r.stderr || `Failed to remove: ${path}`)
        },
      },

      getInstance: (sandbox: CloudRunSandbox) => sandbox,
    },

    snapshot: {
      // Proven against a deployed v2 gateway: `sandbox tar`/`fork` export the
      // writable rootfs overlay; /tmp and --mount paths are excluded, the source
      // keeps running and fork restarts the startup command (no memory).
      capabilities: {
        scope: 'rootfs',
        memory: false,
        destroysSource: false,
        source: 'kept',
        excludes: ['/tmp'],
        fork: true,
        createOptions: { ephemeral: false },
      },
      create: async (config: CloudRunConfig, sandboxId: string, options?: { name?: string }) => {
        await requireGatewayFeature(config, 'snapshot', 'snapshots')
        const sandbox = activeSandboxes.get(sandboxId)
        if (sandbox && getExecutionMode(sandbox.config) !== 'stateful') {
          throw new Error('Cloud Run snapshots need a stateful sandbox; create it with executionMode: \'stateful\' or ephemeral: false.')
        }
        const data = await gatewayRequest(config, '/v1/sandbox/snapshot', { sandboxId, ...(options?.name ? { snapshotId: options.name } : {}) }, sandbox)
        return toSnapshot(data)
      },
      list: async (config: CloudRunConfig) => {
        await requireGatewayFeature(config, 'snapshot', 'snapshots')
        const items = await gatewayRequest(config, '/v1/snapshot/list', {})
        return (items as any[]).map(toSnapshot)
      },
      delete: async (config: CloudRunConfig, snapshotId: string) => {
        await requireGatewayFeature(config, 'snapshot', 'snapshots')
        await gatewayRequest(config, '/v1/snapshot/delete', { snapshotId })
      },
    },
  },
})

export type { CloudRunSandbox as CloudRunSandboxInstance }
