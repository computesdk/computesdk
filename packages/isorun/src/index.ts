/**
 * @computesdk/isorun — Isorun provider for ComputeSDK.
 *
 * Thin wrapper around `isorun` that maps the ComputeSDK provider
 * interface to Isorun's sandbox API.
 *
 * @see https://isorun.ai
 */

import { randomUUID } from 'node:crypto'

import { Isorun, Sandbox } from 'isorun'
import { defineProvider, escapeShellArg } from '@computesdk/provider'

import type {
  CommandResult,
  CreateInstanceOptions,
  FileEntry,
  RunCommandOptions,
  InstanceInfo,
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

/** Per-exec wait window, kept under Isorun's ~120s exec request cap. */
const EXEC_WINDOW_SEC = 90
const PENDING = '__ISORUN_PENDING__'
/** Largest body Isorun moves reliably in one transfer: bigger exec output or file downloads truncate and drop the console. */
const READ_CHUNK_BYTES = 256 * 1024
/** Uploads above this silently corrupt, so they go up in pieces. */
const WRITE_CHUNK_BYTES = 4 * 1024 * 1024

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function singleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Errors where the request never reached the guest console, so a retry is safe. */
function isTransient(err: unknown): boolean {
  return /console not connected|broken pipe|transport lost|stream timeout|ECONNRESET|socket hang up/i.test(String((err as Error)?.message ?? err))
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (err) {
      if (i + 1 >= attempts || !isTransient(err)) throw err
      await sleep(1000 * (i + 1))
    }
  }
}

/** Reads `size` bytes of a guest file (`q` is already shell-quoted) as base64 exec chunks. */
async function readChunked(sandbox: Sandbox, q: string, size: number): Promise<Buffer> {
  const parts: Buffer[] = []
  for (let i = 0; i * READ_CHUNK_BYTES < size; i++) {
    const r = await withRetry(() => sandbox.exec(
      `dd if=${q} bs=${READ_CHUNK_BYTES} skip=${i} count=1 2>/dev/null | base64 | tr -d '\\n'`,
      60,
    ))
    if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `Failed to read ${q}`)
    parts.push(Buffer.from(r.stdout, 'base64'))
  }
  const data = Buffer.concat(parts)
  if (data.length !== size) throw new Error(`Short read of ${q}: got ${data.length} of ${size} bytes`)
  return data
}

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
    instances: {
      create: async (config: ConfigWithClient, options?: CreateInstanceOptions) => {
        const client = getClient(config)
        const timeoutMs = options?.timeout ?? DEFAULT_TIMEOUT_MS
        if (options?.snapshotId) {
          if (options?.vcpus || options?.memMiB || options?.diskMiB) {
            throw new Error('Isorun snapshot restores cannot override vcpus/memMiB/diskMiB — restores inherit the snapshot\'s resources')
          }
          const restored = await client.restore(options.snapshotId)
          // `restore` takes no options, so apply the requested expiry via setTimeout
          // (the post-hoc equivalent of CreateOptions.timeoutSec).
          await restored.setTimeout(Math.max(1, Math.ceil(timeoutMs / 1000)))
          sandboxTimeouts.set(restored, timeoutMs)
          return { instance: restored, instanceId: restored.id }
        }
        const runtime = (options?.runtime as Runtime | undefined) ?? 'node'
        const sandbox = await client.create({
          image: options?.image || defaultImage(runtime),
          vcpus: options?.vcpus,
          memMiB: options?.memMiB,
          diskMiB: options?.diskMiB,
          timeoutSec: Math.max(1, Math.ceil(timeoutMs / 1000)),
        })
        sandboxTimeouts.set(sandbox, timeoutMs)
        return { instance: sandbox, instanceId: sandbox.id }
      },

      getById: async (config: ConfigWithClient, sandboxId: string) => {
        const sandbox = await getClient(config).get(sandboxId)
        if (!sandbox) return null
        return { instance: sandbox, instanceId: sandboxId }
      },

      list: async (config: ConfigWithClient) => {
        const sandboxes = await getClient(config).list()
        return sandboxes.map(sandbox => ({ instance: sandbox, instanceId: sandbox.id }))
      },

      destroy: async (config: ConfigWithClient, sandboxId: string) => {
        const sandbox = await getClient(config).get(sandboxId)
        if (sandbox) await sandbox.destroy()
      },

      runCommand: async (sandbox: Sandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now()
        const lines: string[] = []
        // Exported (not `K=v cmd`) so env applies to every part of a compound command.
        for (const [k, v] of Object.entries(options?.env ?? {})) {
          // Env var names are POSIX identifiers; reject anything else so a
          // malicious key (e.g. `x; rm -rf /`, `$(...)`) can't break out of
          // the assignment and inject a command. Values are escaped below.
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
            throw new Error(`Invalid environment variable name: ${JSON.stringify(k)}`)
          }
          lines.push(`export ${k}="${escapeShellArg(String(v))}"`)
        }
        if (options?.cwd) lines.push(`cd "${escapeShellArg(options.cwd)}" || exit $?`)
        lines.push(command)
        let fullCommand = lines.join('\n')
        if (options?.background) {
          fullCommand = `nohup sh -c "${escapeShellArg(fullCommand)}" >/dev/null 2>&1 &`
        }

        // Isorun's exec request is capped at ~120s and a transport hiccup can
        // drop output, so the command runs detached with output in guest files;
        // short execs then wait for its exit code and read the files back with
        // byte-count verification.
        const base = `/tmp/.isorun-exec-${randomUUID().replace(/-/g, '').slice(0, 12)}`
        // The closing paren sits on its own line: a command ending in a
        // comment or heredoc would otherwise swallow `) > ...` into itself.
        const script =
          `( ${fullCommand}\n) > ${base}.out 2> ${base}.err < /dev/null;` +
          ` C=$?;` +
          ` printf '%s %s %s' "$C" "$(wc -c < ${base}.out)" "$(wc -c < ${base}.err)" > ${base}.tmp;` +
          ` mv ${base}.tmp ${base}.code`
        const launch =
          `S=$(command -v bash || echo sh); ` +
          `if command -v setsid >/dev/null 2>&1; then setsid nohup "$S" -c ${singleQuote(script)} >/dev/null 2>&1 < /dev/null & ` +
          `else nohup "$S" -c ${singleQuote(script)} >/dev/null 2>&1 < /dev/null & fi; ` +
          `echo $! > ${base}.pid; `

        const timeoutMs = options?.timeout ?? DEFAULT_TIMEOUT_MS
        const deadline = startTime + timeoutMs
        // Blocks in the guest until the command exits (or `sec` elapses), then
        // prints `code outLen errLen` on stderr and the captured output.
        const waitFor = (sec: number) =>
          `E=$(( $(date +%s) + ${sec} )); ` +
          `while [ ! -f ${base}.code ] && [ "$(date +%s)" -lt "$E" ]; do sleep 0.05; done; ` +
          `if [ -f ${base}.code ]; then set -- $(cat ${base}.code); echo "$*" >&2; ` +
          `if [ "$3" -le ${READ_CHUNK_BYTES} ]; then cat ${base}.err >&2; fi; ` +
          `if [ "$2" -le ${READ_CHUNK_BYTES} ]; then cat ${base}.out; fi; ` +
          `else echo ${PENDING} >&2; fi`
        const windowSec = () => Math.max(1, Math.min(EXEC_WINDOW_SEC, Math.ceil((deadline - Date.now()) / 1000)))

        let launched = false
        let r: { stdout: string; stderr: string; exitCode: number } | undefined
        for (let attempt = 0; !launched; attempt++) {
          try {
            r = await sandbox.exec(launch + waitFor(windowSec()), EXEC_WINDOW_SEC + 30)
            launched = true
          } catch (err) {
            // Only relaunch when the command provably never started.
            const started = await withRetry(() => sandbox.exec(`test -f ${base}.pid`, 30)).then((x) => x.exitCode === 0)
            if (started) launched = true
            else if (attempt >= 2 || !isTransient(err)) throw err
            else await sleep(1000 * (attempt + 1))
          }
        }

        try {
          while (!r || r.stderr.startsWith(PENDING) || !r.stderr.includes('\n')) {
            if (Date.now() >= deadline) {
              await withRetry(() => sandbox.exec(`P=$(cat ${base}.pid 2>/dev/null) && { kill -9 -- -"$P" 2>/dev/null || kill -9 "$P"; }`, 30)).catch(() => undefined)
              return {
                stdout: '',
                stderr: `Command timed out after ${timeoutMs}ms`,
                exitCode: 124,
                durationMs: Date.now() - startTime,
              }
            }
            r = await withRetry(() => sandbox.exec(waitFor(windowSec()), EXEC_WINDOW_SEC + 30))
          }

          const nl = r.stderr.indexOf('\n')
          const [code, outLen, errLen] = r.stderr.slice(0, nl).trim().split(/\s+/).map((n) => Number.parseInt(n, 10))
          let stdout = r.stdout
          let stderr = r.stderr.slice(nl + 1)
          const reread = async (path: string, expected: number, first: string): Promise<string> => {
            if (expected > READ_CHUNK_BYTES) return (await readChunked(sandbox, path, expected)).toString('utf8')
            if (Number.isNaN(expected) || Buffer.byteLength(first) === expected) return first
            const second = (await withRetry(() => sandbox.exec(`cat ${path}`, 60))).stdout
            return Buffer.byteLength(second) >= Buffer.byteLength(first) ? second : first
          }
          stdout = await reread(`${base}.out`, outLen, stdout)
          stderr = await reread(`${base}.err`, errLen, stderr)
          return {
            stdout,
            stderr,
            exitCode: Number.isInteger(code) ? code : 1,
            durationMs: Date.now() - startTime,
          }
        } finally {
          void sandbox.exec(`rm -f ${base}.out ${base}.err ${base}.tmp ${base}.code ${base}.pid`, 60).catch(() => undefined)
        }
      },

      getInfo: async (sandbox: Sandbox): Promise<InstanceInfo> => {
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
          // Isorun's download endpoint truncates multi-MiB bodies and leaves the
          // sandbox console unusable afterwards, so read through exec in
          // base64 chunks small enough to transfer reliably.
          const q = `"${escapeShellArg(path)}"`
          const head = await withRetry(() => sandbox.exec(
            `S=$(wc -c < ${q}) || exit 1; echo "$S"; ` +
            `if [ "$S" -le ${READ_CHUNK_BYTES} ]; then base64 < ${q} | tr -d '\\n'; fi`,
            60,
          ))
          if (head.exitCode !== 0) throw new Error(head.stderr.trim() || `Failed to read file: ${path}`)
          const nl = head.stdout.indexOf('\n')
          const size = Number.parseInt(head.stdout.slice(0, nl), 10)
          if (size > READ_CHUNK_BYTES) return (await readChunked(sandbox, q, size)).toString('utf8')
          const data = Buffer.from(head.stdout.slice(nl + 1), 'base64')
          if (data.length !== size) throw new Error(`Short read of ${path}: got ${data.length} of ${size} bytes`)
          return data.toString('utf8')
        },

        writeFile: async (sandbox: Sandbox, path: string, content: string): Promise<void> => {
          const data = Buffer.from(content, 'utf8')
          if (data.length <= WRITE_CHUNK_BYTES) {
            await sandbox.writeFile(path, content)
            return
          }
          const dir = `/tmp/.isorun-up-${randomUUID().replace(/-/g, '').slice(0, 12)}`
          try {
            await withRetry(() => sandbox.exec(`mkdir -p ${dir}`, 30))
            for (let i = 0; i * WRITE_CHUNK_BYTES < data.length; i++) {
              const piece = data.subarray(i * WRITE_CHUNK_BYTES, (i + 1) * WRITE_CHUNK_BYTES)
              await withRetry(() => sandbox.writeFile(`${dir}/${String(i).padStart(6, '0')}`, piece))
            }
            const q = `"${escapeShellArg(path)}"`
            const r = await withRetry(() => sandbox.exec(`cat ${dir}/* > ${q} && wc -c < ${q}`, 110))
            if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `Failed to write file: ${path}`)
            const written = Number.parseInt(r.stdout.trim(), 10)
            if (written !== data.length) throw new Error(`Short write of ${path}: wrote ${written} of ${data.length} bytes`)
          } finally {
            void sandbox.exec(`rm -rf ${dir}`, 60).catch(() => undefined)
          }
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
