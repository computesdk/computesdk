/**
 * `@computesdk/uno` - the Uno provider for ComputeSDK.
 *
 * Uno machines are full Linux microVMs (Firecracker): systemd, apt, sudo, a
 * real disk. The US region runs on High-end servers: our fastest processors.
 *
 * This file is only the mapping between ComputeSDK's interface and the HTTP
 * calls in `./client`.
 *
 * @see https://uno.place/docs/api
 */

import { defineProvider, escapeShellArg } from '@computesdk/provider'
import type {
  CommandResult,
  CreateInstanceOptions,
  FileEntry,
  InstanceInfo,
  RunCommandOptions,
} from '@computesdk/provider'

import { UnoClient, isTransient, type UnoBox, type UnoClientOptions } from './client.js'

export { UnoClient, UnoError, DEFAULT_BASE_URL } from './client.js'
export type { UnoBox, UnoRun, UnoClientOptions, UnoCreateBoxRequest } from './client.js'

export interface UnoConfig extends UnoClientOptions {
  /**
   * Region for new machines: `'us'` (High-end) or `'nl'`. Falls back to
   * `UNO_REGION`; omitted means the account's default region.
   */
  region?: string
  /** OS template slug (see `GET /api/v1/box-templates`). Default `'ubuntu-24.04'`. */
  template?: string
  /** Default vCPUs when `create` does not say. Default 2. */
  vcpu?: number
  /** Default memory in MiB when `create` does not say. Default 2048. */
  ramMb?: number
  /** Default disk in GB when `create` does not say. Default 10. */
  diskGb?: number
  /** How long `create` waits for the machine to boot, in ms. Default 120 000. */
  readyTimeoutMs?: number
}

export interface UnoSandbox {
  id: string
  box: UnoBox
  client: UnoClient
  /** Environment from `create({ envs })`, applied to every command. */
  envs?: Record<string, string>
}

const DEFAULT_TEMPLATE = 'ubuntu-24.04'
const DEFAULT_COMMAND_TIMEOUT_MS = 300_000
/** The API accepts up to 64 KiB of command text. */
const MAX_COMMAND_BYTES = 64 * 1024

type ConfigWithClient = UnoConfig & { __client?: UnoClient }

function getClient(config: ConfigWithClient): UnoClient {
  if (!config.__client) config.__client = new UnoClient(config)
  return config.__client
}

/** Memory in MiB from whichever resource field the caller used, rounded up to the API's 256 MiB step. */
function pickRamMb(options: CreateInstanceOptions | undefined, fallback: number): number {
  const raw = options?.memoryMiB ?? options?.memMiB ?? options?.memoryMb ?? options?.memory ?? fallback
  return Math.max(512, Math.ceil(raw / 256) * 256)
}

function pickVcpu(options: CreateInstanceOptions | undefined, fallback: number): number {
  return Math.max(1, Math.ceil(options?.vcpus ?? options?.cpus ?? options?.cpu ?? fallback))
}

function pickDiskGb(options: CreateInstanceOptions | undefined, fallback: number): number {
  const mib = options?.diskMiB ?? options?.diskMb
  return Math.max(4, mib ? Math.ceil(mib / 1024) : fallback)
}

/** Machine names: letters, digits, space and `. _ -`, up to 63 characters. */
function safeName(name: string | undefined): string | undefined {
  if (!name) return undefined
  const cleaned = name.replace(/[^A-Za-z0-9 ._-]/g, '-').slice(0, 63)
  return cleaned || undefined
}

function toSandbox(client: UnoClient, box: UnoBox, envs?: Record<string, string>): UnoSandbox {
  return { id: String(box.id), box, client, envs }
}

function buildCommand(command: string, options?: RunCommandOptions): string {
  let full = command
  if (options?.cwd) full = `cd "${escapeShellArg(options.cwd)}" && ${full}`
  if (options?.background) full = `nohup bash -c "${escapeShellArg(full)}" >/dev/null 2>&1 &`
  return full
}

function validateEnv(env: Record<string, string>): Record<string, string> {
  for (const key of Object.keys(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid environment variable name: ${JSON.stringify(key)}`)
    }
  }
  return env
}

type FsRunCommand = (sandbox: UnoSandbox, command: string, options?: RunCommandOptions) => Promise<CommandResult>

async function runOrThrow(run: FsRunCommand, sandbox: UnoSandbox, command: string, what: string): Promise<CommandResult> {
  const r = await run(sandbox, command)
  if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `${what} (exit code ${r.exitCode})`)
  return r
}

/** Raw bytes per read: 128 KiB is ~171 KiB of base64, under the API's 256 KiB stdout cap. */
const READ_CHUNK_BYTES = 128 * 1024
/** Raw bytes per write: 36 KiB is 48 KiB of base64, leaving room for the path under the 64 KiB command limit. */
const WRITE_CHUNK_BYTES = 36 * 1024

/**
 * Read `size` bytes of a file (path already shell-escaped) in chunks that each
 * fit in one command's output; a short chunk means the file changed or the
 * read failed, so it throws instead of returning a partial file.
 */
async function readInChunks(run: FsRunCommand, sandbox: UnoSandbox, quotedPath: string, size: number, what: string): Promise<Buffer> {
  const parts: Buffer[] = []
  for (let off = 0; off < size; off += READ_CHUNK_BYTES) {
    const want = Math.min(READ_CHUNK_BYTES, size - off)
    const r = await runOrThrow(
      run,
      sandbox,
      `dd if="${quotedPath}" iflag=skip_bytes,count_bytes skip=${off} count=${want} status=none | base64 -w0`,
      what,
    )
    const chunk = Buffer.from(r.stdout.trim(), 'base64')
    if (chunk.length !== want) throw new Error(`${what}: got ${chunk.length} of ${want} bytes at offset ${off} (file changed while reading?)`)
    parts.push(chunk)
  }
  return Buffer.concat(parts)
}

function parseSize(stdout: string, what: string): number {
  const size = Number.parseInt(stdout.trim(), 10)
  if (!Number.isSafeInteger(size) || size < 0) throw new Error(`${what}: unexpected size ${JSON.stringify(stdout.trim())}`)
  return size
}

export const uno = defineProvider<UnoSandbox, ConfigWithClient>({
  name: 'uno',
  methods: {
    instances: {
      create: async (config: ConfigWithClient, options?: CreateInstanceOptions) => {
        if (options?.snapshotId) {
          throw new Error('Uno does not restore from snapshots through ComputeSDK yet; omit snapshotId.')
        }
        const client = getClient(config)
        // A per-request marker in the machine's comment lets us find exactly this
        // machine if the create response is lost, even when names repeat.
        const requestId = crypto.randomUUID()
        const marker = `computesdk ${requestId}`
        const name = safeName(options?.name) ?? `computesdk-${requestId.slice(0, 12)}`
        // created_at is server time: allow for clock skew when matching.
        const since = Date.now() - 60_000
        let box: UnoBox
        try {
          box = await client.createBox(
            {
              template: options?.templateId ?? options?.image ?? config.template ?? DEFAULT_TEMPLATE,
              vcpu: pickVcpu(options, config.vcpu ?? 2),
              ram_mb: pickRamMb(options, config.ramMb ?? 2048),
              disk_gb: pickDiskGb(options, config.diskGb ?? 10),
              name,
              region: config.region ?? process.env.UNO_REGION ?? undefined,
              comment: marker,
            },
            options?.signal,
          )
        } catch (err) {
          // The API may have accepted the machine before the connection died
          // or the caller aborted. Never leave it running unseen on the
          // caller's bill: adopt it, or delete it if the caller gave up.
          const aborted = options?.signal?.aborted === true
          if (!aborted && !isTransient(err)) throw err
          // After an abort the machine may appear a moment later: look a few times.
          const found = await client.findBoxByMarker(marker, since, aborted ? 3 : 1).catch(() => null)
          if (!found) throw err
          if (aborted) {
            await client.deleteBox(found.id).catch(() => {})
            throw err
          }
          box = found
        }
        try {
          const ready = await client.waitReady(box.id, config.readyTimeoutMs ?? 120_000, options?.signal)
          return { instance: toSandbox(client, ready, options?.envs), instanceId: String(ready.id) }
        } catch (err) {
          // Never leave a half-started machine behind on the caller's bill.
          await client.deleteBox(box.id).catch(() => {})
          throw err
        }
      },

      getById: async (config: ConfigWithClient, instanceId: string) => {
        const client = getClient(config)
        const box = await client.getBox(instanceId)
        return box ? { instance: toSandbox(client, box), instanceId: String(box.id) } : null
      },

      list: async (config: ConfigWithClient) => {
        const client = getClient(config)
        const boxes = await client.listBoxes()
        return boxes.map(box => ({ instance: toSandbox(client, box), instanceId: String(box.id) }))
      },

      destroy: async (config: ConfigWithClient, instanceId: string) => {
        await getClient(config).deleteBox(instanceId)
      },

      runCommand: async (sandbox: UnoSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const started = Date.now()
        const cmd = buildCommand(command, options)
        if (Buffer.byteLength(cmd, 'utf8') > MAX_COMMAND_BYTES) {
          throw new Error(`Uno accepts commands up to 64 KiB; write larger inputs with filesystem.writeFile first.`)
        }
        const env = validateEnv({ ...(sandbox.envs ?? {}), ...(options?.env ?? {}) })
        const timeoutMs = options?.timeout ?? DEFAULT_COMMAND_TIMEOUT_MS
        const run = await sandbox.client.run(sandbox.id, {
          cmd,
          env: Object.keys(env).length ? env : undefined,
          timeout_s: Math.min(3600, Math.max(1, Math.ceil(timeoutMs / 1000))),
        })
        const stdout = run.stdout ?? ''
        let stderr = run.stderr ?? ''
        // The API keeps up to 256 KiB of stdout and 64 KiB of stderr; say so instead of passing a prefix off as the whole output.
        if (run.stdout_truncated) stderr += `${stderr && !stderr.endsWith('\n') ? '\n' : ''}[uno] stdout truncated at 256 KiB\n`
        if (run.stderr_truncated) stderr += `${stderr && !stderr.endsWith('\n') ? '\n' : ''}[uno] stderr truncated at 64 KiB\n`
        options?.onStdout?.(stdout)
        options?.onStderr?.(stderr)
        return {
          stdout,
          stderr,
          exitCode: run.exit_code ?? -1,
          durationMs: Date.now() - started,
        }
      },

      getInfo: async (sandbox: UnoSandbox): Promise<InstanceInfo> => {
        const current = await sandbox.client.getBox(sandbox.id)
        // null = the machine is gone (deleted elsewhere): report it stopped, not the stale cached state.
        const box = current ?? sandbox.box
        return {
          id: sandbox.id,
          provider: 'uno',
          status: !current ? 'stopped' : box.status === 'running' ? 'running' : box.status === 'error' ? 'error' : 'stopped',
          createdAt: new Date(box.created_at),
          timeout: (box.max_lifetime_s ?? 0) * 1000,
          metadata: {
            name: box.name,
            vcpu: box.vcpu,
            ramMb: box.ram_mb,
            diskGb: box.disk_gb,
            region: box.network_region,
            hostname: box.hostname,
            ...(current ? {} : { deleted: true }),
          },
        }
      },

      getUrl: async (sandbox: UnoSandbox, options: { port: number; protocol?: string }) => {
        const box = await sandbox.client.getBox(sandbox.id)
        if (!box) throw new Error(`Uno machine ${sandbox.id} not found (it was deleted)`)
        if (options.port === 80 && typeof box.url === 'string') return box.url
        throw new Error(
          `Uno publishes a machine's web port 80 at https://<name>.uno4.dev; port ${options.port} is not exposed. ` +
            'Serve on port 80 or open ports when creating the machine via the Uno API.',
        )
      },

      getInstance: (sandbox: UnoSandbox) => sandbox,

      filesystem: {
        readFile: async (sandbox: UnoSandbox, path: string, run: FsRunCommand): Promise<string> => {
          const what = `Cannot read ${path}`
          const q = escapeShellArg(path)
          const size = parseSize((await runOrThrow(run, sandbox, `test -f "${q}" && stat -c %s "${q}"`, what)).stdout, what)
          return (await readInChunks(run, sandbox, q, size, what)).toString('utf8')
        },

        writeFile: async (sandbox: UnoSandbox, path: string, content: string, run: FsRunCommand): Promise<void> => {
          // base64 survives any content (quotes, NUL-free binary-ish text, a line that looks like a heredoc end).
          // Chunks go to a temp file next to the target, renamed into place only when all of them landed.
          const what = `Cannot write ${path}`
          const data = Buffer.from(content, 'utf8')
          const q = escapeShellArg(path)
          const tmp = escapeShellArg(`${path}.computesdk-${crypto.randomUUID().slice(0, 8)}.tmp`)
          await runOrThrow(run, sandbox, `mkdir -p "$(dirname "${q}")" && : > "${tmp}"`, what)
          try {
            for (let off = 0; off < data.length; off += WRITE_CHUNK_BYTES) {
              const b64 = data.subarray(off, off + WRITE_CHUNK_BYTES).toString('base64')
              await runOrThrow(run, sandbox, `printf %s '${b64}' | base64 -d >> "${tmp}"`, what)
            }
            await runOrThrow(run, sandbox, `mv -f "${tmp}" "${q}"`, what)
          } catch (err) {
            await run(sandbox, `rm -f "${tmp}"`).catch(() => {})
            throw err
          }
        },

        mkdir: async (sandbox: UnoSandbox, path: string, run: FsRunCommand): Promise<void> => {
          await runOrThrow(run, sandbox, `mkdir -p "${escapeShellArg(path)}"`, `Cannot create ${path}`)
        },

        readdir: async (sandbox: UnoSandbox, path: string, run: FsRunCommand): Promise<FileEntry[]> => {
          // The listing goes to a temp file and is read back in chunks, so a huge
          // directory is never cut off at the 256 KiB output cap.
          const what = `Cannot read directory ${path}`
          const list = `/tmp/.computesdk-ls-${crypto.randomUUID()}`
          let listing: string
          try {
            const r = await runOrThrow(
              run,
              sandbox,
              `find "${escapeShellArg(path)}" -mindepth 1 -maxdepth 1 -printf '%y\\t%s\\t%T@\\t%f\\n' > ${list} && stat -c %s ${list}`,
              what,
            )
            listing = (await readInChunks(run, sandbox, list, parseSize(r.stdout, what), what)).toString('utf8')
          } finally {
            await run(sandbox, `rm -f ${list}`).catch(() => {})
          }
          return listing
            .split('\n')
            .filter(Boolean)
            .map(line => {
              const [kind, size, mtime, ...rest] = line.split('\t')
              return {
                name: rest.join('\t'),
                type: kind === 'd' ? 'directory' : 'file',
                size: Number.parseInt(size, 10) || 0,
                modified: new Date(Number.parseFloat(mtime) * 1000),
              } as FileEntry
            })
        },

        exists: async (sandbox: UnoSandbox, path: string, run: FsRunCommand): Promise<boolean> => {
          const r = await run(sandbox, `test -e "${escapeShellArg(path)}"`)
          return r.exitCode === 0
        },

        remove: async (sandbox: UnoSandbox, path: string, run: FsRunCommand): Promise<void> => {
          await runOrThrow(run, sandbox, `rm -rf "${escapeShellArg(path)}"`, `Cannot remove ${path}`)
        },
      },
    },
  },
})

export default uno
