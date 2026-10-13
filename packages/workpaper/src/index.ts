/**
 * @computesdk/workpaper — Workpaper provider for ComputeSDK.
 *
 * Thin wrapper around the `workpaper` SDK. Each instance is a Workpaper
 * computer: a Linux microVM that keeps its files and running processes
 * across pause and resume, and can be forked.
 *
 * @see https://workpaper.co
 */

import { Workpaper, Computer, type Size } from 'workpaper'
import { defineProvider, escapeShellArg } from '@computesdk/provider'

import type {
  CommandResult,
  CreateInstanceOptions,
  FileEntry,
  RunCommandOptions,
  InstanceInfo,
} from '@computesdk/provider'

export interface WorkpaperConfig {
  /** API key (`workpaper keys create <name>`). Falls back to `WORKPAPER_API_KEY`. */
  apiKey?: string
  /** small (2 vCPU / 4 GB), large (4 vCPU / 8 GB) or xlarge (8 vCPU / 16 GB). Default small. */
  size?: Size
}

type ConfigWithClient = WorkpaperConfig & { __client?: Workpaper }

function getClient(config: ConfigWithClient): Workpaper {
  if (!config.__client) {
    const apiKey = config.apiKey ?? process.env.WORKPAPER_API_KEY
    if (!apiKey) {
      throw new Error(`Missing Workpaper API key. Provide 'apiKey' in config or set WORKPAPER_API_KEY.`)
    }
    config.__client = new Workpaper({ apiKey })
  }
  return config.__client
}

/** The smallest size with at least the requested vCPUs and memory. */
function sizeFor(config: WorkpaperConfig, options?: CreateInstanceOptions): Size {
  const vcpus = options?.vcpus ?? 0
  const memMiB = options?.memMiB ?? 0
  if (!vcpus && !memMiB) return config.size ?? 'small'
  if (vcpus <= 2 && memMiB <= 4096) return 'small'
  if (vcpus <= 4 && memMiB <= 8192) return 'large'
  return 'xlarge'
}

const DEFAULT_TIMEOUT_MS = 300_000

let seq = 0
/** Computer names: lowercase letters, digits and dashes, at most 32 characters. */
const newName = () => `csdk-${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`

async function find(config: ConfigWithClient, id: string): Promise<Computer | undefined> {
  return (await getClient(config).list()).find(c => c.id === id)
}

type FsRunCommand = (computer: Computer, command: string, options?: RunCommandOptions) => Promise<CommandResult>

export const workpaper = defineProvider<Computer, ConfigWithClient>({
  name: 'workpaper',
  methods: {
    instances: {
      create: async (config: ConfigWithClient, options?: CreateInstanceOptions) => {
        const timeoutMs = options?.timeout ?? DEFAULT_TIMEOUT_MS
        const computer = await getClient(config).create(newName(), {
          size: sizeFor(config, options),
          timeout: Math.max(1, Math.ceil(timeoutMs / 1000)),
        })
        return { instance: computer, instanceId: computer.id }
      },

      getById: async (config: ConfigWithClient, id: string) => {
        const computer = await find(config, id)
        return computer ? { instance: computer, instanceId: computer.id } : null
      },

      list: async (config: ConfigWithClient) => {
        const computers = await getClient(config).list()
        return computers.map(computer => ({ instance: computer, instanceId: computer.id }))
      },

      destroy: async (config: ConfigWithClient, id: string) => {
        await (await find(config, id))?.delete()
      },

      runCommand: async (computer: Computer, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now()
        // Environment variables go to the process directly, never through the shell.
        const env = options?.env ? Object.fromEntries(Object.entries(options.env).map(([k, v]) => [k, String(v)])) : undefined
        const fullCommand = options?.background
          ? `nohup sh -c "${escapeShellArg(command)}" >/dev/null 2>&1 &`
          : command
        const result = await computer.exec(fullCommand, {
          cwd: options?.cwd,
          env,
          timeoutMs: options?.timeout,
        })
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          durationMs: Date.now() - startTime,
        }
      },

      getInfo: async (computer: Computer): Promise<InstanceInfo> => ({
        id: computer.id,
        provider: 'workpaper',
        status: computer.running ? 'running' : 'stopped',
        createdAt: new Date(),
        timeout: Math.max(0, computer.stopsAt.getTime() - Date.now()),
        metadata: { name: computer.name, cpus: computer.cpus, memoryMB: computer.memoryMB },
      }),

      getUrl: async () => {
        throw new Error('Workpaper computers do not accept incoming connections')
      },

      getInstance: (computer: Computer) => computer,

      filesystem: {
        readFile: async (computer: Computer, path: string): Promise<string> => computer.readText(path),

        writeFile: async (computer: Computer, path: string, content: string): Promise<void> => {
          await computer.write(path, content)
        },

        mkdir: async (computer: Computer, path: string, runCommand: FsRunCommand): Promise<void> => {
          const r = await runCommand(computer, `mkdir -p "${escapeShellArg(path)}"`)
          if (r.exitCode !== 0) throw new Error(r.stderr || `Failed to create directory: ${path}`)
        },

        readdir: async (computer: Computer, path: string, runCommand: FsRunCommand): Promise<FileEntry[]> => {
          const r = await runCommand(computer, `ls -la "${escapeShellArg(path)}"`)
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

        exists: async (computer: Computer, path: string, runCommand: FsRunCommand): Promise<boolean> => {
          const r = await runCommand(computer, `test -e "${escapeShellArg(path)}"`)
          return r.exitCode === 0
        },

        remove: async (computer: Computer, path: string, runCommand: FsRunCommand): Promise<void> => {
          const r = await runCommand(computer, `rm -rf "${escapeShellArg(path)}"`)
          if (r.exitCode !== 0) throw new Error(r.stderr || `Failed to remove: ${path}`)
        },
      },
    },
  },
})
