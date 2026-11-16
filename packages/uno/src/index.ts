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
  CreateSnapshotOptions,
  FileEntry,
  InstanceInfo,
  ListSnapshotsOptions,
  RunCommandOptions,
} from '@computesdk/provider'

import {
  MAX_WAIT_READY_S,
  UnoClient,
  UnoError,
  isReadyOrThrow,
  isStoppedCopy,
  isTransient,
  type UnoBox,
  type UnoClientOptions,
} from './client.js'

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

/** Raw bytes per read: 190 KiB is ~253 KiB of base64, under the API's 256 KiB stdout cap. */
const READ_CHUNK_BYTES = 190 * 1024

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
        if (options?.snapshotId) return createFromSnapshot(config, options.snapshotId, options)
        const client = getClient(config)
        // A per-request marker in the machine's comment lets us find exactly this
        // machine if the create response is lost, even when names repeat.
        const requestId = crypto.randomUUID()
        const marker = `computesdk ${requestId}`
        const name = safeName(options?.name) ?? `computesdk-${requestId.slice(0, 12)}`
        // created_at is server time: allow for clock skew when matching.
        const since = Date.now() - 60_000
        const readyTimeoutMs = config.readyTimeoutMs ?? 120_000
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
            // The server holds create until the machine is ready, so a new
            // sandbox usually takes this one request; polling is the fallback.
            { waitReadyS: Math.min(MAX_WAIT_READY_S, Math.floor(readyTimeoutMs / 1000)) },
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
          const ready = isReadyOrThrow(box)
            ? box
            : await client.waitReady(box.id, readyTimeoutMs, options?.signal, box.wait?.waited_ms ?? 0)
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
        // Snapshots are sleeping machines too (see `snapshot` below); they are not instances.
        const boxes = (await client.listBoxes()).filter(box => !isSnapshotBox(box))
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

      // Pause = the machine stops where it runs and keeps its memory on the
      // server; resume picks up in milliseconds with every process as it was.
      // After `pauseInMemoryS` (default 5 min) it goes to sleep on disk on its
      // own — memory and processes still survive, waking takes ~0.1 s. An API
      // without pause in memory sleeps it on disk right away. A command sent
      // to a paused or sleeping machine wakes it too.
      pause: async (sandbox: UnoSandbox): Promise<void> => {
        await sandbox.client.pauseBox(sandbox.id)
      },
      resume: async (sandbox: UnoSandbox): Promise<void> => {
        await sandbox.client.wakeBox(sandbox.id)
      },
      pauseCapabilities: { memory: true },

      filesystem: {
        readFile: async (sandbox: UnoSandbox, path: string, run: FsRunCommand): Promise<string> => {
          const what = `Cannot read ${path}`
          const native = await nativeOrNull(() => sandbox.client.readFileNative(sandbox.id, path), what)
          if (native) return native.toString('utf8')
          return (await readFileShell(run, sandbox, path, what)).toString('utf8')
        },

        writeFile: async (sandbox: UnoSandbox, path: string, content: string, run: FsRunCommand): Promise<void> => {
          const what = `Cannot write ${path}`
          const data = Buffer.from(content, 'utf8')
          if (await writeFileNative(run, sandbox, path, data, what)) return
          await writeFileShell(run, sandbox, path, data, what)
        },

        mkdir: async (sandbox: UnoSandbox, path: string, run: FsRunCommand): Promise<void> => {
          await runOrThrow(run, sandbox, `mkdir -p "${escapeShellArg(path)}"`, `Cannot create ${path}`)
        },

        readdir: async (sandbox: UnoSandbox, path: string, run: FsRunCommand): Promise<FileEntry[]> => {
          const what = `Cannot read directory ${path}`
          const find = `find "${escapeShellArg(path)}" -mindepth 1 -maxdepth 1 -printf '%y\\t%s\\t%T@\\t%f\\n'`
          // One command for a directory whose listing fits in one output (256 KiB).
          const r = await runOrThrow(run, sandbox, find, what)
          let listing = r.stdout
          if (r.stderr.includes(STDOUT_TRUNCATED)) {
            // A huge directory: the listing goes to a temp file and is read back in chunks.
            const list = `/tmp/.computesdk-ls-${crypto.randomUUID()}`
            try {
              const s = await runOrThrow(run, sandbox, `${find} > ${list} && stat -c %s ${list}`, what)
              listing = (await readInChunks(run, sandbox, list, parseSize(s.stdout, what), what)).toString('utf8')
            } finally {
              await run(sandbox, `rm -f ${list}`).catch(() => {})
            }
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

    // A snapshot is a stopped copy of the machine's disk, kept as an Uno
    // machine named `computesdk-snapshot-…`. Taking one flushes the guest's
    // page cache and copies the disk copy-on-write (the source is paused for
    // milliseconds and keeps running); the copy is not started and uses no CPU
    // or RAM. (An API that cannot copy without starting boots the copy once
    // and puts it to sleep.) Creating an instance from it copies that disk
    // again, so one snapshot serves any number of instances. Memory is not
    // kept: processes do not survive, and /tmp is emptied by the instance's
    // boot. The snapshot id is the machine id.
    snapshot: {
      capabilities: {
        scope: 'rootfs',
        memory: false,
        destroysSource: false,
        source: 'kept',
        excludes: ['/tmp'],
        fork: true,
        readiness: 'immediate',
      },

      create: async (config: ConfigWithClient, instanceId: string, options?: CreateSnapshotOptions) => {
        const client = getClient(config)
        const name = snapshotName(String(parseBoxId(instanceId, 'instance')), options?.name)
        await flushDisk(client, instanceId)
        const since = Date.now() - 60_000
        let snap: UnoBox
        try {
          // start: false — the API copies the disk only and answers with the copy already stopped.
          snap = await client.cloneBox(instanceId, { name, start: false })
        } catch (err) {
          // The copy may exist even though the response was lost: adopt it by its unique name.
          if (!isTransient(err)) throw err
          const found = await client.findBoxByName(name, since).catch(() => null)
          if (!found) throw err
          snap = found
        }
        try {
          await settleSnapshot(client, snap, config.readyTimeoutMs ?? 120_000)
        } catch (err) {
          await client.deleteBox(snap.id).catch(() => {})
          throw err
        }
        knownSnapshots(client).add(String(snap.id))
        return toSnapshot({ ...snap, name: snap.name ?? name })
      },

      list: async (config: ConfigWithClient, options?: ListSnapshotsOptions) => {
        const source = options?.instanceId ?? options?.sandboxId
        const snaps = (await getClient(config).listBoxes())
          .filter(isSnapshotBox)
          .filter(box => source === undefined || snapshotSource(box) === String(source))
          .map(toSnapshot)
        return options?.limit ? snaps.slice(0, options.limit) : snaps
      },

      delete: async (config: ConfigWithClient, snapshotId: string) => {
        const client = getClient(config)
        const id = parseBoxId(snapshotId, 'snapshot')
        const box = await client.getBox(id)
        if (!box) return
        // Never delete a working machine because its id was passed as a snapshot id.
        if (!isSnapshotBox(box)) throw new Error(`Uno machine ${snapshotId} is not a snapshot; delete it with instances.destroy`)
        await client.deleteBox(id)
        knownSnapshots(client).delete(String(id))
      },
    },
  },
})

/** Name prefix of the sleeping machines that hold snapshots. */
const SNAPSHOT_PREFIX = 'computesdk-snapshot-'

function isSnapshotBox(box: UnoBox): boolean {
  return typeof box.name === 'string' && box.name.startsWith(SNAPSHOT_PREFIX)
}

/**
 * `computesdk-snapshot-<source id>-<12 hex>[-<caller's name>]`, within the
 * 63-character name limit. The source id is in the name because the API does
 * not return a box's clone source.
 */
function snapshotName(sourceId: string, name: string | undefined): string {
  const base = `${SNAPSHOT_PREFIX}${sourceId}-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
  const extra = safeName(name)
  return extra ? `${base}-${extra}`.slice(0, 63) : base
}

function snapshotSource(box: UnoBox): string | undefined {
  if (box.clone_of != null) return String(box.clone_of)
  return box.name.slice(SNAPSHOT_PREFIX.length).match(/^(\d+)-[0-9a-f]{12}(?:-|$)/)?.[1]
}

function toSnapshot(box: UnoBox) {
  return {
    id: String(box.id),
    provider: 'uno',
    createdAt: new Date(box.created_at),
    metadata: {
      name: box.name,
      sourceInstanceId: snapshotSource(box),
      vcpu: box.vcpu,
      ramMb: box.ram_mb,
      diskGb: box.disk_gb,
    },
  }
}

function parseBoxId(id: string, what: string): number {
  if (!/^\d+$/.test(String(id).trim())) throw new Error(`Invalid Uno ${what} id ${JSON.stringify(id)}: expected a machine id`)
  return Number(id)
}

/** Snapshot ids this client made, so restoring one needs no look-up first. */
const snapshotsByClient = new WeakMap<UnoClient, Set<string>>()
function knownSnapshots(client: UnoClient): Set<string> {
  let set = snapshotsByClient.get(client)
  if (!set) snapshotsByClient.set(client, (set = new Set()))
  return set
}

/**
 * Bring a just-made snapshot machine to rest. A copy made without starting is
 * already stopped. An API without `start: false` boots the copy: wait for it
 * and put it to sleep, as before. A copy adopted after a lost response may
 * still be in the making: wait until it is either.
 */
async function settleSnapshot(client: UnoClient, snap: UnoBox, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (let box: UnoBox | null = snap; ; ) {
    if (!box) throw new UnoError(`Uno snapshot machine ${snap.id} disappeared while it was being made`, 404, 'NOT_FOUND')
    if (isStoppedCopy(box)) return
    if (isReadyOrThrow(box) || box.status === 'starting') {
      if (box.status !== 'running') await client.waitReady(box.id, Math.max(1, deadline - Date.now()))
      await client.sleepBox(box.id)
      return
    }
    if (Date.now() > deadline) throw new UnoError(`Uno snapshot ${snap.id} not ready after ${timeoutMs} ms (status ${box.status})`, 504, 'READY_TIMEOUT', box)
    await new Promise(resolve => setTimeout(resolve, 100))
    box = await client.getBox(snap.id)
  }
}

/**
 * Make everything the guest wrote reach its disk before the disk is copied:
 * a pause stops the vCPUs but leaves dirty pages in guest memory.
 */
async function flushDisk(client: UnoClient, id: string | number): Promise<void> {
  const r = await client.run(id, { cmd: 'sync', timeout_s: 120 })
  if (r.exit_code !== 0) throw new Error(`Cannot snapshot Uno machine ${id}: sync exited ${r.exit_code}${r.stderr ? `: ${r.stderr.trim()}` : ''}`)
}

/**
 * `instances.create({ snapshotId })`: a new machine from a snapshot's disk.
 * A snapshot id may also be a live machine's id (a fork of its current disk).
 * The new machine has the snapshot's shape (vCPU, memory, disk).
 */
async function createFromSnapshot(config: ConfigWithClient, snapshotId: string, options: CreateInstanceOptions) {
  const client = getClient(config)
  const source = parseBoxId(snapshotId, 'snapshot')
  if (!knownSnapshots(client).has(String(source))) {
    const src = await client.getBox(source)
    if (!src) throw new Error(`Uno snapshot ${snapshotId} not found`)
    // A live machine's disk is copied as it is now: flush first, as snapshot.create does.
    // A sleeping one has its last writes in saved memory, so it is woken for the flush and put back.
    if (!isSnapshotBox(src) && (src.status === 'running' || src.status === 'sleeping')) {
      await flushDisk(client, source)
      if (src.status === 'sleeping') await client.sleepBox(source)
    }
  }
  const name = safeName(options.name) ?? `computesdk-${crypto.randomUUID().slice(0, 12)}`
  const since = Date.now() - 60_000
  const readyTimeoutMs = config.readyTimeoutMs ?? 120_000
  let box: UnoBox
  try {
    box = await client.cloneBox(source, { name, signal: options.signal })
  } catch (err) {
    // Same rule as create: a copy the API made before the connection died is adopted, or deleted if the caller gave up.
    const aborted = options.signal?.aborted === true
    if (!aborted && !isTransient(err)) throw err
    const found = await client.findBoxByName(name, since).catch(() => null)
    if (!found) throw err
    if (aborted) {
      await client.deleteBox(found.id).catch(() => {})
      throw err
    }
    box = found
  }
  try {
    const ready = isReadyOrThrow(box) ? box : await client.waitReady(box.id, readyTimeoutMs, options.signal)
    return { instance: toSandbox(client, ready, options.envs), instanceId: String(ready.id) }
  } catch (err) {
    await client.deleteBox(box.id).catch(() => {})
    throw err
  }
}

/** What `runCommand` appends to stderr when the API cut stdout at its cap. */
const STDOUT_TRUNCATED = '[uno] stdout truncated'
/** Files up to this size are read in one command: 190 KiB is ~253 KiB of base64, under the 256 KiB stdout cap. */
const SINGLE_READ_MAX_BYTES = 190 * 1024
/** Native writes larger than this go as parts: the API's edge takes request bodies up to 100 MB. */
const NATIVE_PART_BYTES = 64 * 1024 * 1024

/** Runs a native file call; `null` means "no native file API, use commands". Maps the API's file errors to plain messages. */
async function nativeOrNull<T>(fn: () => Promise<T | null>, what: string): Promise<T | null> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof UnoError && err.code === 'FILE_NOT_FOUND') throw new Error(`${what}: no such file`)
    if (err instanceof UnoError && err.code === 'IS_A_DIRECTORY') throw new Error(`${what}: is a directory`)
    throw err
  }
}

/** Read a file through commands: one for a small file, chunks for a large one. */
async function readFileShell(run: FsRunCommand, sandbox: UnoSandbox, path: string, what: string): Promise<Buffer> {
  const q = escapeShellArg(path)
  const r = await runOrThrow(
    run,
    sandbox,
    `f="${q}"; [ -f "$f" ] || { echo "no such file" >&2; exit 1; }; s=$(stat -c %s "$f") || exit 1; echo "$s"; ` +
      `if [ "$s" -le ${SINGLE_READ_MAX_BYTES} ]; then base64 -w0 "$f"; fi`,
    what,
  )
  const nl = r.stdout.indexOf('\n')
  const size = parseSize(nl < 0 ? r.stdout : r.stdout.slice(0, nl), what)
  if (size <= SINGLE_READ_MAX_BYTES) {
    const data = Buffer.from(r.stdout.slice(nl + 1).trim(), 'base64')
    if (data.length === size) return data
    // The file changed between stat and read: fall through to a chunked read of what is there now.
  }
  const now = parseSize((await runOrThrow(run, sandbox, `stat -c %s "${q}"`, what)).stdout, what)
  return readInChunks(run, sandbox, q, now, what)
}

/**
 * Write through the native file API: one request, or parts appended to a temp
 * file and renamed into place for files over the edge's body limit. `false`
 * means the API has no file endpoint and nothing was written.
 */
async function writeFileNative(run: FsRunCommand, sandbox: UnoSandbox, path: string, data: Buffer, what: string): Promise<boolean> {
  const { client, id } = sandbox
  if (data.length <= NATIVE_PART_BYTES) return (await nativeOrNull(async () => ((await client.writeFileNative(id, path, data)) ? true : null), what)) ?? false
  const tmp = `${path}.computesdk-${crypto.randomUUID().slice(0, 8)}.part`
  const first = await nativeOrNull(async () => ((await client.writeFileNative(id, tmp, data.subarray(0, NATIVE_PART_BYTES))) ? true : null), what)
  if (!first) return false
  try {
    for (let off = NATIVE_PART_BYTES; off < data.length; off += NATIVE_PART_BYTES) {
      await client.writeFileNative(id, tmp, data.subarray(off, off + NATIVE_PART_BYTES), { append: true })
    }
    await runOrThrow(run, sandbox, `mv -f "${escapeShellArg(tmp)}" "${escapeShellArg(path)}"`, what)
  } catch (err) {
    await run(sandbox, `rm -f "${escapeShellArg(tmp)}"`).catch(() => {})
    throw err
  }
  return true
}

/**
 * Write through commands. base64 survives any content (quotes, a line that
 * looks like a heredoc end). The data goes to a temp file next to the target
 * and is renamed into place by the last command, so a small file is one
 * command and a failed write never leaves a partial target.
 */
async function writeFileShell(run: FsRunCommand, sandbox: UnoSandbox, path: string, data: Buffer, what: string): Promise<void> {
  const q = escapeShellArg(path)
  const tmp = escapeShellArg(`${path}.computesdk-${crypto.randomUUID().slice(0, 8)}.tmp`)
  // Raw bytes per command: what fits in the 64 KiB command limit next to the paths, as whole base64 groups.
  const room = MAX_COMMAND_BYTES - 512 - 3 * Buffer.byteLength(q) - 3 * Buffer.byteLength(tmp)
  const chunk = Math.max(3, Math.floor((room * 3) / 4 / 3) * 3)
  const parts = Math.max(1, Math.ceil(data.length / chunk))
  try {
    for (let i = 0; i < parts; i++) {
      const b64 = data.subarray(i * chunk, (i + 1) * chunk).toString('base64')
      let cmd = i === 0 ? `mkdir -p "$(dirname "${q}")" && printf %s '${b64}' | base64 -d > "${tmp}"` : `printf %s '${b64}' | base64 -d >> "${tmp}"`
      if (i === parts - 1) cmd += ` && mv -f "${tmp}" "${q}"`
      await runOrThrow(run, sandbox, cmd, what)
    }
  } catch (err) {
    await run(sandbox, `rm -f "${tmp}"`).catch(() => {})
    throw err
  }
}

export default uno
