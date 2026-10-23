/**
 * @computesdk/unikraft: the Unikraft Cloud provider for ComputeSDK.
 *
 * Each sandbox is a microVM with the Unikraft Cloud sandbox plugin attached.
 * The provider wraps the `Sandbox` client from `@unikraft/cloud`.
 *
 * @see https://unikraft.com/docs
 */

import { defineProvider, escapeShellArg, resolveVolumeRef } from '@computesdk/provider'
import type {
  CommandResult,
  CreateInstanceOptions,
  FileEntry,
  InstanceInfo,
  RunCommandOptions,
  VolumeMount,
} from '@computesdk/provider'
import { DEFAULT_METRO, UnikraftCloud, UnikraftCloudError } from '@unikraft/cloud'
import type { MetroClient, Sandbox, SandboxSpec } from '@unikraft/cloud'

export interface UnikraftConfig {
  /** API token. If absent, the provider reads the `UKC_TOKEN` environment variable. */
  token?: string
  /**
   * Metro code, for example `was`, or the full API URL of a deployment. If
   * absent, the provider reads `UKC_METRO`, then uses the default metro of
   * `@unikraft/cloud`.
   */
  metro?: string
  /**
   * Image for a sandbox whose create call names none. If absent, the provider
   * reads `UKC_SANDBOX_IMAGE`, then uses the default image of `@unikraft/cloud`.
   */
  image?: string
  /** Sandbox plugin ROM. If absent, the provider reads `UKC_SANDBOX_ROM`, then uses the default ROM. */
  rom?: string
  /** Memory for each sandbox, in MiB, if the create call names none. */
  memoryMb?: number
  /** vCPUs for each sandbox, if the create call names none. */
  vcpus?: number
  /** Default `runCommand` timeout, in milliseconds. Without it a command runs until it exits. */
  timeout?: number
}

// `timeout(1)` exits with 124 when it stops a command, so callers that check
// for it see the same code here.
const TIMEOUT_EXIT_CODE = 124

// The benchmark harness builds a new provider for each iteration. One client
// for each account and metro lets all of them share it.
const clients = new Map<string, MetroClient>()

// The sandbox plugin starts each command with an empty environment. The
// variables of the image and of the instance do not reach it, so the provider
// sends them with every command, and adds the `HOME` of the root user that the
// plugin runs commands as.
const BASE_ENV: Record<string, string> = { HOME: '/root' }

interface SandboxState {
  config: UnikraftConfig
  env: Record<string, string>
}

// `Sandbox` holds neither the provider config nor the create options, so the
// values that `runCommand` needs are kept for each sandbox here.
const sandboxState = new WeakMap<Sandbox, SandboxState>()

function env(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

function getClient(config: UnikraftConfig): MetroClient {
  const token = config.token ?? env('UKC_TOKEN')
  if (!token) {
    throw new Error(
      'Missing Unikraft Cloud token.\n\n' +
        'Get one at https://console.unikraft.cloud\n' +
        'Then pass it: unikraft({ token: "..." })\n' +
        'Or set UKC_TOKEN in your environment.',
    )
  }
  const metro = config.metro ?? env('UKC_METRO') ?? DEFAULT_METRO
  const key = JSON.stringify([token, metro])
  let client = clients.get(key)
  if (!client) {
    // A URL as the metro pins the client to that deployment, and `metro()`
    // then returns that deployment for any code it gets.
    client = new UnikraftCloud({ token, metro }).metro(metro)
    clients.set(key, client)
  }
  return client
}

function remember(sandbox: Sandbox, config: UnikraftConfig, envs?: Record<string, string>): Sandbox {
  sandboxState.set(sandbox, { config, env: { ...BASE_ENV, ...envs } })
  return sandbox
}

function isNotFound(err: unknown): boolean {
  return err instanceof UnikraftCloudError && err.status === 404
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type PlatformVolume = NonNullable<SandboxSpec['volumes']>[number]

// ComputeSDK names a mount by volume and path. The platform wants the
// volume's UUID or name next to the mount point.
function toVolume(mount: VolumeMount): PlatformVolume {
  const ref = resolveVolumeRef(mount.volume)
  const id = ref.id ?? ref.name
  if (!id) {
    throw new Error(
      `A volume mount at ${mount.mountPath} names no volume. Pass the volume's UUID or name as \`volume\`.`,
    )
  }
  return {
    ...(UUID.test(id) ? { uuid: id } : { name: id }),
    at: mount.mountPath,
    ...(mount.readOnly === undefined ? {} : { readonly: mount.readOnly }),
  }
}

function toSpec(config: UnikraftConfig, options: CreateInstanceOptions = {}): SandboxSpec {
  const common = {
    ...(options.envs ? { env: options.envs } : {}),
    ...(options.name ? { name: options.name } : {}),
  }
  const snapshot = options.snapshotId
  if (snapshot) {
    // A clone of an instance template resumes the template's memory, so it
    // takes the image, the size and the plugin of the template. The platform
    // refuses a create that names them again.
    return { ...common, template: UUID.test(snapshot) ? { uuid: snapshot } : { name: snapshot } }
  }
  const image = options.image ?? options.templateId ?? config.image
  const rom = config.rom ?? env('UKC_SANDBOX_ROM')
  const memory = options.memory_mb ?? options.memoryMb ?? config.memoryMb
  const vcpus = options.vcpus ?? config.vcpus
  return {
    ...common,
    ...(image ? { image } : {}),
    ...(rom ? { rom } : {}),
    ...(typeof memory === 'number' ? { memory_mb: memory } : {}),
    ...(typeof vcpus === 'number' ? { vcpus } : {}),
    ...(options.volumes ? { volumes: options.volumes.map(toVolume) } : {}),
    ...(options.service_group ? { service_group: options.service_group } : {}),
  }
}

function mapStatus(state: string): InstanceInfo['status'] {
  switch (state) {
    case 'running':
    case 'starting':
      return 'running'
    case 'stopped':
    case 'stopping':
    case 'draining':
    case 'standby':
      return 'stopped'
    default:
      return 'error'
  }
}

async function runCommand(
  sandbox: Sandbox,
  command: string,
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  const startTime = Date.now()
  const state = sandboxState.get(sandbox)
  const commandOptions = {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    env: { ...(state?.env ?? BASE_ENV), ...options.env },
  }

  if (options.background) {
    await sandbox.start(command, commandOptions)
    return { stdout: '', stderr: '', exitCode: 0, durationMs: Date.now() - startTime }
  }

  const timeout = options.timeout ?? state?.config.timeout
  // `keep` saves the delete request inside the caller's wait. The record is
  // deleted after the result is returned.
  const result = await sandbox.exec(command, {
    ...commandOptions,
    ...(timeout === undefined ? {} : { timeoutSeconds: timeout / 1000 }),
    keep: true,
  })
  const handle = sandbox.command(result.uuid)
  if (result.exitcode === null) {
    // The plugin keeps a command running after a wait times out, so stop it.
    void handle
      .signal('KILL')
      .then(() => handle.delete())
      .catch(() => {})
    return {
      stdout: result.stdout,
      stderr: result.stderr || `Command timed out after ${timeout} ms`,
      exitCode: TIMEOUT_EXIT_CODE,
      durationMs: Date.now() - startTime,
    }
  }
  void handle.delete().catch(() => {})
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitcode,
    durationMs: Date.now() - startTime,
  }
}

type FsRunCommand = (
  sandbox: Sandbox,
  command: string,
  options?: RunCommandOptions,
) => Promise<CommandResult>

export const unikraft = defineProvider<Sandbox, UnikraftConfig>({
  name: 'unikraft',
  methods: {
    instances: {
      create: async (config: UnikraftConfig, options?: CreateInstanceOptions) => {
        const sandbox = await getClient(config).sandboxes.create(
          toSpec(config, options),
          options?.signal ? { signal: options.signal } : {},
        )
        return { instance: remember(sandbox, config, options?.envs), instanceId: sandbox.uuid }
      },

      getById: async (config: UnikraftConfig, sandboxId: string) => {
        try {
          const sandbox = await getClient(config).sandboxes.get({ uuid: sandboxId })
          return { instance: remember(sandbox, config), instanceId: sandboxId }
        } catch (err) {
          if (isNotFound(err)) return null
          throw err
        }
      },

      list: async (config: UnikraftConfig) => {
        const found: Array<{ instance: Sandbox; instanceId: string }> = []
        for await (const sandbox of getClient(config).sandboxes.list()) {
          found.push({ instance: remember(sandbox, config), instanceId: sandbox.uuid })
        }
        return found
      },

      destroy: async (config: UnikraftConfig, sandboxId: string) => {
        try {
          await getClient(config).instances.delete({ uuid: sandboxId })
        } catch (err) {
          if (isNotFound(err)) return
          throw err
        }
      },

      runCommand,

      getInfo: async (sandbox: Sandbox): Promise<InstanceInfo> => {
        const instance = await sandbox.instance
        return {
          id: sandbox.uuid,
          provider: 'unikraft',
          status: mapStatus(instance.state),
          createdAt: new Date(instance.created_at),
          timeout: sandboxState.get(sandbox)?.config.timeout ?? 0,
          metadata: {
            metro: sandbox.metro,
            name: instance.name,
            image: instance.image,
            memoryMb: instance.memory_mb,
            vcpus: instance.vcpus,
            state: instance.state,
          },
        }
      },

      getUrl: async (sandbox: Sandbox, options: { port: number; protocol?: string }) => {
        const instance = await sandbox.instance
        const fqdn = instance.service_group?.domains?.[0]?.fqdn
        if (!fqdn) {
          throw new Error(
            `Sandbox ${sandbox.uuid} has no public service, so port ${options.port} has no URL. ` +
              'Create the sandbox with a `service_group` that exposes the port.',
          )
        }
        return `${options.protocol ?? 'https'}://${fqdn}`
      },

      getInstance: (sandbox: Sandbox) => sandbox,

      filesystem: {
        readFile: async (sandbox: Sandbox, path: string): Promise<string> => {
          return new TextDecoder().decode(await sandbox.readFile(path))
        },

        writeFile: async (sandbox: Sandbox, path: string, content: string): Promise<void> => {
          await sandbox.writeFile(path, content)
        },

        mkdir: async (sandbox: Sandbox, path: string): Promise<void> => {
          await sandbox.mkdir(path)
        },

        readdir: async (sandbox: Sandbox, path: string, run: FsRunCommand): Promise<FileEntry[]> => {
          // `ls -la` and not `find -printf`, because BusyBox images have no `-printf`.
          const r = await run(sandbox, `ls -la "${escapeShellArg(path)}"`)
          if (r.exitCode !== 0) throw new Error(r.stderr || `Cannot read directory: ${path}`)
          const entries: FileEntry[] = []
          for (const line of r.stdout.split('\n')) {
            if (!line.trim() || line.startsWith('total ')) continue
            const parts = line.split(/\s+/)
            if (parts.length < 9) continue
            const name = parts.slice(8).join(' ')
            if (name === '.' || name === '..') continue
            entries.push({
              name,
              type: parts[0].startsWith('d') ? 'directory' : 'file',
              size: Number.parseInt(parts[4], 10) || 0,
            })
          }
          return entries
        },

        exists: async (sandbox: Sandbox, path: string, run: FsRunCommand): Promise<boolean> => {
          const r = await run(sandbox, `test -e "${escapeShellArg(path)}"`)
          return r.exitCode === 0
        },

        remove: async (sandbox: Sandbox, path: string, run: FsRunCommand): Promise<void> => {
          const r = await run(sandbox, `rm -rf "${escapeShellArg(path)}"`)
          if (r.exitCode !== 0) throw new Error(r.stderr || `Failed to remove: ${path}`)
        },
      },
    },
  },
})

export default unikraft
