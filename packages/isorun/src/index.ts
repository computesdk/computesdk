/**
 * @computesdk/isorun — Isorun provider for ComputeSDK.
 *
 * Thin wrapper around `isorun` that maps the ComputeSDK provider
 * interface to Isorun's sandbox API.
 *
 * @see https://isorun.ai
 */

import { Isorun, Sandbox } from 'isorun'
import { defineProvider, escapeShellArg } from '@computesdk/provider'

import type {
  CommandResult,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
  SandboxInfo,
} from '@computesdk/provider'

export interface IsorunConfig {
  /** API key. Falls back to `ISORUN_API_KEY` env var. The runner endpoint is derived from the key. */
  apiKey?: string
}

type ConfigWithClient = IsorunConfig & { __client?: Isorun }

function getClient(config: ConfigWithClient): Isorun {
  if (!config.__client) {
    const apiKey = config.apiKey ?? process.env.ISORUN_API_KEY
    if (!apiKey) {
      throw new Error(`Missing Isorun API key. Provide 'apiKey' in config or set ISORUN_API_KEY.`)
    }
    config.__client = new Isorun({ apiKey })
  }
  return config.__client
}

type Runtime = 'node' | 'python'

function defaultImage(runtime?: Runtime): string {
  return runtime === 'python' ? 'python:3.12-slim' : 'node:22'
}

const DEFAULT_TIMEOUT_MS = 300_000

const sandboxTimeouts = new WeakMap<Sandbox, number>()

type FsRunCommand = (sandbox: Sandbox, command: string, options?: RunCommandOptions) => Promise<CommandResult>

export interface IsorunSnapshot {
  id: string
  provider: string
  createdAt: Date
  metadata?: Record<string, unknown>
}

export const isorun = defineProvider<Sandbox, ConfigWithClient, never, IsorunSnapshot>({
  name: 'isorun',
  methods: {
    sandbox: {
      create: async (config: ConfigWithClient, options?: CreateSandboxOptions) => {
        const client = getClient(config)
        const runtime = (options?.runtime as Runtime | undefined) ?? 'node'
        const timeoutMs = options?.timeout ?? DEFAULT_TIMEOUT_MS
        const sandbox = await client.create({
          image: options?.image || defaultImage(runtime),
          vcpus: options?.vcpus,
          memMiB: options?.memMiB,
          diskMiB: options?.diskMiB,
          timeoutSec: Math.max(1, Math.ceil(timeoutMs / 1000)),
        })
        sandboxTimeouts.set(sandbox, timeoutMs)
        return { sandbox, sandboxId: sandbox.id }
      },

      getById: async (config: ConfigWithClient, sandboxId: string) => {
        const sandbox = await getClient(config).get(sandboxId)
        if (!sandbox) return null
        return { sandbox, sandboxId }
      },

      list: async (config: ConfigWithClient) => {
        const sandboxes = await getClient(config).list()
        return sandboxes.map(sandbox => ({ sandbox, sandboxId: sandbox.id }))
      },

      destroy: async (config: ConfigWithClient, sandboxId: string) => {
        const sandbox = await getClient(config).get(sandboxId)
        if (sandbox) await sandbox.destroy()
      },

      runCommand: async (sandbox: Sandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now()
        let fullCommand = command

        if (options?.env && Object.keys(options.env).length > 0) {
          const prefix = Object.entries(options.env)
            .map(([k, v]) => {
              // Env var names are POSIX identifiers; reject anything else so a
              // malicious key (e.g. `x; rm -rf /`, `$(...)`) can't break out of
              // the assignment and inject a command. Values are escaped below.
              if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
                throw new Error(`Invalid environment variable name: ${JSON.stringify(k)}`)
              }
              return `${k}="${escapeShellArg(String(v))}"`
            })
            .join(' ')
          fullCommand = `${prefix} ${fullCommand}`
        }
        if (options?.cwd) {
          fullCommand = `cd "${escapeShellArg(options.cwd)}" && ${fullCommand}`
        }
        if (options?.background) {
          fullCommand = `nohup sh -c "${escapeShellArg(fullCommand)}" >/dev/null 2>&1 &`
        }

        const result = await sandbox.exec(fullCommand, Math.max(1, Math.ceil((options?.timeout ?? DEFAULT_TIMEOUT_MS) / 1000)))
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          durationMs: Date.now() - startTime,
        }
      },

      getInfo: async (sandbox: Sandbox): Promise<SandboxInfo> => {
        const i = await sandbox.info()
        return {
          id: sandbox.id,
          provider: 'isorun',
          status: i.status === 'running' ? 'running' : i.status === 'error' ? 'error' : 'stopped',
          createdAt: new Date(i.createdAt),
          timeout: sandboxTimeouts.get(sandbox) ?? DEFAULT_TIMEOUT_MS,
          metadata: { createMs: i.createMs, image: i.image },
        }
      },

      getUrl: async (sandbox: Sandbox, options: { port: number; protocol?: string }) => {
        const url = sandbox.url(options.port)
        if (options.protocol) {
          const u = new URL(url)
          u.protocol = `${options.protocol}:`
          return u.toString()
        }
        return url
      },

      getInstance: (sandbox: Sandbox) => sandbox,

      filesystem: {
        readFile: async (sandbox: Sandbox, path: string): Promise<string> => {
          return sandbox.readFile(path)
        },

        writeFile: async (sandbox: Sandbox, path: string, content: string): Promise<void> => {
          await sandbox.writeFile(path, content)
        },

        mkdir: async (sandbox: Sandbox, path: string, runCommand: FsRunCommand): Promise<void> => {
          const r = await runCommand(sandbox, `mkdir -p "${escapeShellArg(path)}"`)
          if (r.exitCode !== 0) throw new Error(r.stderr || `Failed to create directory: ${path}`)
        },

        readdir: async (sandbox: Sandbox, path: string, runCommand: FsRunCommand): Promise<FileEntry[]> => {
          // ls -la, not find -printf: BusyBox images (Alpine) lack -printf
          const r = await runCommand(sandbox, `ls -la "${escapeShellArg(path)}"`)
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

        exists: async (sandbox: Sandbox, path: string, runCommand: FsRunCommand): Promise<boolean> => {
          const r = await runCommand(sandbox, `test -e "${escapeShellArg(path)}"`)
          return r.exitCode === 0
        },

        remove: async (sandbox: Sandbox, path: string, runCommand: FsRunCommand): Promise<void> => {
          const r = await runCommand(sandbox, `rm -rf "${escapeShellArg(path)}"`)
          if (r.exitCode !== 0) throw new Error(r.stderr || `Failed to remove: ${path}`)
        },
      },
    },

    snapshot: {
      create: async (config: ConfigWithClient, sandboxId: string): Promise<IsorunSnapshot> => {
        const sandbox = await getClient(config).get(sandboxId)
        if (!sandbox) throw new Error(`Sandbox not found: ${sandboxId}`)
        const snap = await sandbox.snapshot()
        return {
          id: snap.id,
          provider: 'isorun',
          createdAt: new Date(snap.createdAt),
          metadata: { runId: snap.runId, sizeBytes: snap.sizeBytes },
        }
      },

      list: async (config: ConfigWithClient): Promise<IsorunSnapshot[]> => {
        const entries = await getClient(config).listSnapshots()
        return entries.map(e => ({
          id: e.id,
          provider: 'isorun',
          createdAt: new Date(e.createdAt),
          metadata: { runId: e.runId, sizeBytes: e.sizeBytes },
        }))
      },

      delete: async (config: ConfigWithClient, snapshotId: string): Promise<void> => {
        try {
          await getClient(config).deleteSnapshot(snapshotId)
        } catch { /* idempotent: snapshot may already be gone */ }
      },
    },
  },
})
