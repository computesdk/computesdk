/**
 * ComputeSDK Cloud Run Gateway
 *
 * Runs inside a Cloud Run service deployed with --sandbox-launcher and exposes
 * a small authenticated REST API that proxies to /usr/local/gcp/bin/sandbox.
 *
 * Stateful sandboxes (`executionMode: 'stateful'`) are long-lived `sandbox run`
 * sessions on the instance that created them: exec and file routes run in them
 * via `sandbox exec`, destroy deletes them. Snapshots are `sandbox tar` exports
 * of the writable rootfs overlay, stored in GCS when CLOUD_RUN_SNAPSHOT_BUCKET is
 * set (otherwise on this instance's disk), and restored with `run --import-tar`.
 */

import { spawn } from 'node:child_process'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const GATEWAY_VERSION = 2
export const GATEWAY_FEATURES = ['stateful', 'exec-stream', 'snapshot', 'fork'] as const

const DEFAULT_SANDBOX_BINARY = '/usr/local/gcp/bin/sandbox'
// A full inherited env can exceed the kernel's argv+env limit (E2BIG); the CLI
// receives sandbox env via -e args, not the process env.
const SPAWN_ENV = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? '/root' }
/** Base64 chars per write command; keeps each `/bin/sh -c` argument under Linux's 128 KiB MAX_ARG_STRLEN. */
const WRITE_CHUNK_CHARS = 64_000
const DEFAULT_TIMEOUT_MS = 300_000
const DELETE_TIMEOUT_MS = 30_000
const DEFAULT_IDLE_TIMEOUT_MS = 3_600_000

// The CLI exits 1 for any non-zero command status, so commands report their
// real status in a stderr trailer that the gateway strips.
const EXIT_TRAILER = /\x1eCSDK_EXIT:(\d+)\x1e$/
const EXIT_TRAILER_MAX = 20
/** Grace before the gateway kills the CLI itself; the in-sandbox `timeout` should fire first. */
const TIMEOUT_GRACE_MS = 5_000

// With a deadline the command runs under `timeout`, so it dies in the sandbox
// instead of only losing its client.
function commandArgs(command: string, timeoutMs?: number): string[] {
  const run = timeoutMs
    ? `if command -v timeout >/dev/null 2>&1; then timeout -k 1 ${Math.max(1, Math.ceil(timeoutMs / 1000))} /bin/sh -c "$1"; else /bin/sh -c "$1"; fi`
    : '/bin/sh -c "$1"'
  return ['--', '/bin/sh', '-c', `${run}; c=$?; printf '\\036CSDK_EXIT:%d\\036' "$c" >&2; exit $c`, 'computesdk', command]
}

type Json = Record<string, any>
type Result = { stdout: string; stderr: string; exitCode: number }
type Chunk = (stream: 'stdout' | 'stderr', data: string) => void

const sandboxBinary = () => process.env.CLOUD_RUN_SANDBOX_BINARY ?? DEFAULT_SANDBOX_BINARY
const idleTimeoutMs = () => Number(process.env.CLOUD_RUN_SANDBOX_IDLE_TIMEOUT_MS ?? DEFAULT_IDLE_TIMEOUT_MS)

/** Stateful sandboxes this instance started, keyed by id. */
const sandboxes = new Map<string, { createdAt: number; lastUsed: number }>()

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function validateEnvName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new HttpError(400, `Invalid environment variable name: ${JSON.stringify(name)}`)
}

// Ids become CLI args and file/object names, so they follow the CLI's own
// sandbox-id grammar, which also rules out path traversal.
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/
function validateId(id: string, kind = 'sandboxId'): string {
  if (!ID_PATTERN.test(id)) throw new HttpError(400, `Invalid ${kind}: ${JSON.stringify(id)}`)
  return id
}

function shellEscape(arg: string): string {
  return arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`')
}

function formatMount(mount: Json): string {
  return `type=${mount.type ?? 'bind'},src=${String(mount.src)},dst=${String(mount.dst)}`
}

async function readBody(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function runSandbox(args: string[], timeout = DEFAULT_TIMEOUT_MS, onChunk?: Chunk): Promise<Result> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  return new Promise((resolve, reject) => {
    const child = spawn(sandboxBinary(), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: controller.signal,
      env: SPAWN_ENV,
    })
    let stdout = ''
    let stderr = ''
    // Hold back a tail of stderr so a streamed exit trailer is never emitted.
    let stderrSent = 0
    child.stdout.on('data', chunk => {
      const data = chunk.toString('utf8')
      stdout += data
      onChunk?.('stdout', data)
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8')
      const safe = stderr.length - EXIT_TRAILER_MAX
      if (onChunk && safe > stderrSent) {
        onChunk('stderr', stderr.slice(stderrSent, safe))
        stderrSent = safe
      }
    })
    let done = false
    const finish = (result: Result) => {
      if (done) return
      done = true
      clearTimeout(timer)
      const match = EXIT_TRAILER.exec(result.stderr)
      if (match) {
        result.stderr = result.stderr.slice(0, match.index)
        result.exitCode = Number(match[1])
      }
      if (onChunk && result.stderr.length > stderrSent) onChunk('stderr', result.stderr.slice(stderrSent))
      resolve(result)
    }
    child.on('error', error => {
      if ((error as NodeJS.ErrnoException).name === 'AbortError') {
        finish({ stdout, stderr: stderr || `Command timed out after ${timeout}ms`, exitCode: 124 })
        return
      }
      done = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', code => finish({ stdout, stderr, exitCode: code ?? 1 }))
  })
}

function pushEnv(args: string[], env: Json | undefined): void {
  for (const [key, value] of Object.entries(env ?? {})) {
    validateEnvName(key)
    args.push('-e', `${key}=${String(value)}`)
  }
}

function pushExecArgs(args: string[], body: Json): void {
  if (body.cwd) args.push('--workdir', String(body.cwd))
  pushEnv(args, body.env)
  args.push(...((body.execArgs ?? []) as string[]))
}

function pushRunArgs(args: string[], body: Json, forceWrite = false): void {
  if (body.allowEgress) args.push('--allow-egress')
  if (body.rootfs) args.push('--rootfs', String(body.rootfs))
  if (body.workdir ?? body.cwd) args.push('--workdir', String(body.workdir ?? body.cwd))
  if (body.template) args.push('--template', String(body.template))
  if (body.persistDir) args.push('--persist-dir', String(body.persistDir))
  if (body.overlayDir) args.push('--overlaydir', String(body.overlayDir))
  if (forceWrite || body.write) args.push('--write')
  for (const mount of body.mounts ?? []) args.push('--mount', formatMount(mount))
  pushEnv(args, body.env)
  args.push(...((body.runArgs ?? []) as string[]))
}

function doCommand(command: string, body: Json = {}, onChunk?: Chunk) {
  const args = ['do']
  pushRunArgs(args, body, true)
  args.push(...commandArgs(command, body.timeout))
  return runSandbox(args, commandTimeout(body.timeout), onChunk)
}

function commandTimeout(timeout?: number): number {
  return timeout ? timeout + TIMEOUT_GRACE_MS : DEFAULT_TIMEOUT_MS
}

function execCommand(sandboxId: string, command: string, body: Json = {}, onChunk?: Chunk) {
  touch(sandboxId)
  const args = ['exec']
  pushExecArgs(args, body)
  args.push(sandboxId, ...commandArgs(command, body.timeout))
  return runSandbox(args, commandTimeout(body.timeout), onChunk)
}

function fsCommand(sandboxId: string, command: string, body: Json = {}) {
  return body.executionMode === 'stateful'
    ? execCommand(sandboxId, command, body)
    : doCommand(command, body)
}

function touch(sandboxId: string): void {
  const entry = sandboxes.get(sandboxId)
  if (entry) entry.lastUsed = Date.now()
}

async function deleteSandbox(sandboxId: string): Promise<void> {
  sandboxes.delete(sandboxId)
  // `delete --force` exits 1 when the sandbox is already gone; that is success here.
  await runSandbox(['delete', '--force', sandboxId], DELETE_TIMEOUT_MS)
}

/** Deletes stateful sandboxes idle for longer than CLOUD_RUN_SANDBOX_IDLE_TIMEOUT_MS. */
export async function reapIdleSandboxes(now = Date.now()): Promise<string[]> {
  const limit = idleTimeoutMs()
  if (!(limit > 0)) return []
  const idle = [...sandboxes].filter(([, s]) => now - s.lastUsed > limit).map(([id]) => id)
  await Promise.all(idle.map(id => deleteSandbox(id).catch(() => {})))
  return idle
}

// ── Snapshot store ──────────────────────────────────────────────────────────

interface SnapshotRecord { snapshotId: string; uri: string; store: 'gcs' | 'local'; size?: number; createdAt?: string }

function snapshotStore() {
  const bucket = process.env.CLOUD_RUN_SNAPSHOT_BUCKET?.replace(/^gs:\/\//, '').replace(/\/$/, '')
  if (bucket) {
    if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucket)) throw new HttpError(500, 'Invalid CLOUD_RUN_SNAPSHOT_BUCKET')
    const prefix = (process.env.CLOUD_RUN_SNAPSHOT_PREFIX ?? 'computesdk-snapshots/').replace(/^\/+/, '')
    return { kind: 'gcs' as const, bucket, prefix }
  }
  return { kind: 'local' as const, dir: process.env.CLOUD_RUN_SNAPSHOT_DIR ?? '/tmp/computesdk-snapshots' }
}

function snapshotUri(snapshotId: string): string {
  const store = snapshotStore()
  return store.kind === 'gcs'
    ? `gs://${store.bucket}/${store.prefix}${snapshotId}.tar`
    : join(store.dir, `${snapshotId}.tar`)
}

let cachedToken: { value: string; expiresAt: number } | undefined
async function gcsToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value
  const res = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-account/token', {
    headers: { 'Metadata-Flavor': 'Google' },
  })
  if (!res.ok) throw new HttpError(502, `Failed to get a service account token: ${res.status}`)
  const data = await res.json() as { access_token: string; expires_in: number }
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 }
  return data.access_token
}

async function gcsRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`https://storage.googleapis.com/storage/v1${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${await gcsToken()}` },
  })
  if (!res.ok && res.status !== 404) throw new HttpError(502, `GCS request failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
  return res
}

async function listSnapshots(): Promise<SnapshotRecord[]> {
  const store = snapshotStore()
  if (store.kind === 'gcs') {
    const records: SnapshotRecord[] = []
    let pageToken: string | undefined
    do {
      const query = new URLSearchParams({ prefix: store.prefix, fields: 'items(name,size,timeCreated),nextPageToken' })
      if (pageToken) query.set('pageToken', pageToken)
      const res = await gcsRequest(`/b/${store.bucket}/o?${query}`)
      if (res.status === 404) throw new HttpError(502, `Snapshot bucket ${store.bucket} not found`)
      const data = await res.json() as { items?: { name: string; size: string; timeCreated: string }[]; nextPageToken?: string }
      for (const item of data.items ?? []) {
        const id = item.name.slice(store.prefix.length).replace(/\.tar$/, '')
        if (!ID_PATTERN.test(id) || !item.name.endsWith('.tar')) continue
        records.push({ snapshotId: id, uri: `gs://${store.bucket}/${item.name}`, store: 'gcs', size: Number(item.size), createdAt: item.timeCreated })
      }
      pageToken = data.nextPageToken
    } while (pageToken)
    return records
  }
  const names = await readdir(store.dir).catch(() => [] as string[])
  const records = await Promise.all(names.filter(n => n.endsWith('.tar') && ID_PATTERN.test(n.slice(0, -4))).map(async name => {
    const info = await stat(join(store.dir, name))
    return { snapshotId: name.slice(0, -4), uri: join(store.dir, name), store: 'local' as const, size: info.size, createdAt: info.mtime.toISOString() }
  }))
  return records
}

async function deleteSnapshot(snapshotId: string): Promise<void> {
  const store = snapshotStore()
  if (store.kind === 'gcs') {
    await gcsRequest(`/b/${store.bucket}/o/${encodeURIComponent(`${store.prefix}${snapshotId}.tar`)}`, { method: 'DELETE' })
    return
  }
  await rm(join(store.dir, `${snapshotId}.tar`), { force: true })
}

// ── Routes ──────────────────────────────────────────────────────────────────

function cliError(result: Result, fallback: string): HttpError {
  const message = result.stderr.trim() || fallback
  return new HttpError(/not running|does not exist|not found/i.test(message) ? 404 : 500, message)
}

async function startSandbox(sandboxId: string, body: Json, importTar?: string): Promise<Json> {
  const args = ['run']
  // Stateful sessions get a writable rootfs unless explicitly disabled: it is
  // what makes writes outside /tmp stick and what tar/fork export.
  pushRunArgs(args, { ...body, write: body.write ?? true })
  if (importTar) args.push('--import-tar', importTar)
  args.push('--detach', sandboxId)
  const result = await runSandbox(args, body.timeout)
  if (result.exitCode !== 0) throw new HttpError(500, result.stderr.trim() || `Failed to create Cloud Run sandbox ${sandboxId}`)
  sandboxes.set(sandboxId, { createdAt: Date.now(), lastUsed: Date.now() })
  return { sandboxId, status: 'running', ...(body.snapshotId ? { snapshotId: body.snapshotId } : {}) }
}

export async function handle(pathname: string, body: Json, onChunk?: Chunk): Promise<unknown> {
  const sandboxId = validateId(body.sandboxId || `cloud-run-${randomUUID()}`)

  if (pathname === '/v1/sandbox/do') {
    if (!body.command) throw new HttpError(400, 'Missing required field: command')
    const result = await doCommand(String(body.command), body)
    return { sandboxId: `do-${randomUUID()}`, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
  }

  if (pathname === '/v1/sandbox/create') {
    const importTar = body.snapshotId ? snapshotUri(validateId(String(body.snapshotId), 'snapshotId')) : undefined
    return startSandbox(sandboxId, body, importTar)
  }

  if (pathname === '/v1/snapshot/list') return listSnapshots()

  if (pathname === '/v1/snapshot/delete') {
    if (!body.snapshotId) throw new HttpError(400, 'Missing required field: snapshotId')
    await deleteSnapshot(validateId(String(body.snapshotId), 'snapshotId'))
    return { success: true }
  }

  if (!body.sandboxId) throw new HttpError(400, 'Missing sandboxId')

  if (pathname === '/v1/sandbox/destroy') {
    await deleteSandbox(sandboxId)
    return { success: true }
  }

  if (pathname === '/v1/sandbox/info') {
    const known = sandboxes.get(sandboxId)
    if (!known) {
      const probe = await execCommand(sandboxId, 'true', { timeout: DELETE_TIMEOUT_MS })
      if (probe.exitCode !== 0) throw new HttpError(404, `Sandbox ${sandboxId} is not running on this gateway instance`)
      sandboxes.set(sandboxId, { createdAt: Date.now(), lastUsed: Date.now() })
    }
    return { sandboxId, status: 'running', createdAt: new Date(sandboxes.get(sandboxId)!.createdAt).toISOString() }
  }

  if (pathname === '/v1/sandbox/exec' || pathname === '/v1/sandbox/exec/stream') {
    if (!body.command) throw new HttpError(400, 'Missing required field: command')
    return body.executionMode === 'ephemeral'
      ? doCommand(String(body.command), body, onChunk)
      : execCommand(sandboxId, String(body.command), body, onChunk)
  }

  if (pathname === '/v1/sandbox/snapshot') {
    const snapshotId = validateId(String(body.snapshotId ?? `snap-${randomUUID()}`), 'snapshotId')
    const uri = snapshotUri(snapshotId)
    const store = snapshotStore()
    if (store.kind === 'local') await mkdir(store.dir, { recursive: true })
    touch(sandboxId)
    const result = await runSandbox(['tar', `--file=${uri}`, sandboxId], body.timeout)
    if (result.exitCode !== 0) throw cliError(result, `Failed to snapshot sandbox ${sandboxId}`)
    return { snapshotId, uri, store: store.kind, sourceSandboxId: sandboxId, createdAt: new Date().toISOString() }
  }

  if (pathname === '/v1/sandbox/fork') {
    const targetId = validateId(String(body.targetSandboxId ?? `cloud-run-${randomUUID()}`), 'targetSandboxId')
    touch(sandboxId)
    const result = await runSandbox(['fork', '--detach', sandboxId, targetId], body.timeout)
    if (result.exitCode !== 0) throw cliError(result, `Failed to fork sandbox ${sandboxId}`)
    sandboxes.set(targetId, { createdAt: Date.now(), lastUsed: Date.now() })
    return { sandboxId: targetId, sourceSandboxId: sandboxId, status: 'running' }
  }

  if (pathname === '/v1/sandbox/readFile') {
    if (!body.path) throw new HttpError(400, 'Missing required field: path')
    const path = shellEscape(String(body.path))
    const result = await fsCommand(sandboxId, `if [ -f "${path}" ]; then base64 "${path}" | tr -d '\\n'; else exit 1; fi`, body)
    if (result.exitCode !== 0) throw new Error(result.stderr || `File not found: ${body.path}`)
    return Buffer.from(result.stdout, 'base64').toString('utf8')
  }

  if (pathname === '/v1/sandbox/writeFile') {
    if (!body.path) throw new HttpError(400, 'Missing required field: path')
    if (body.content === undefined) throw new HttpError(400, 'Missing required field: content')
    const path = shellEscape(String(body.path))
    const b64 = Buffer.from(String(body.content), 'utf8').toString('base64')
    // The b64 payload rides inside the `/bin/sh -c` argument, which the kernel
    // caps at MAX_ARG_STRLEN (128 KiB) — write it to a staging file in
    // bounded chunks, then move it into place. Cleans up on failure.
    const staging = `${path}.computesdk-tmp.${randomUUID().slice(0, 8)}`
    let result = await fsCommand(sandboxId, `mkdir -p "$(dirname "${path}")" && : > "${staging}"`, body)
    if (result.exitCode !== 0) {
      // The directory may forbid new files while the destination itself is
      // still writable; a payload that fits one command can write directly.
      if (b64.length > WRITE_CHUNK_CHARS) throw new Error(result.stderr || `Failed to write: ${body.path}`)
      result = await fsCommand(sandboxId, `printf '%s' '${b64}' | base64 -d > "${path}"`, body)
      if (result.exitCode !== 0) throw new Error(result.stderr || `Failed to write: ${body.path}`)
      return { success: true }
    }
    try {
      for (let i = 0; i < b64.length; i += WRITE_CHUNK_CHARS) {
        result = await fsCommand(sandboxId, `printf '%s' '${b64.slice(i, i + WRITE_CHUNK_CHARS)}' | base64 -d >> "${staging}"`, body)
        if (result.exitCode !== 0) throw new Error(result.stderr || `Failed to write: ${body.path}`)
      }
      // Same-directory mv is a rename: atomic, no second copy of the data,
      // and no partial destination if the disk fills.
      result = await fsCommand(sandboxId, `mv "${staging}" "${path}"`, body)
      if (result.exitCode !== 0) throw new Error(result.stderr || `Failed to write: ${body.path}`)
    } catch (error) {
      await fsCommand(sandboxId, `rm -f "${staging}"`, body).catch(() => {})
      throw error
    }
    return { success: true }
  }

  if (pathname === '/v1/sandbox/mkdir') {
    const path = shellEscape(String(body.path))
    const result = await fsCommand(sandboxId, `mkdir -p "${path}"`, body)
    if (result.exitCode !== 0) throw new Error(result.stderr || `Failed to create directory: ${body.path}`)
    return { success: true }
  }

  if (pathname === '/v1/sandbox/readdir') {
    const path = shellEscape(String(body.path))
    const result = await fsCommand(sandboxId, `ls -la "${path}"`, body)
    if (result.exitCode !== 0) throw new Error(result.stderr || `Cannot read directory: ${body.path}`)
    return result.stdout.split('\n').flatMap(line => {
      if (!line.trim() || line.startsWith('total ')) return []
      const parts = line.trim().split(/\s+/)
      if (parts.length < 9) return []
      const name = parts.slice(8).join(' ')
      if (name === '.' || name === '..') return []
      return [{ name, type: parts[0].startsWith('d') ? 'directory' : 'file', size: Number.parseInt(parts[4], 10) || 0 }]
    })
  }

  if (pathname === '/v1/sandbox/exists') {
    const path = shellEscape(String(body.path))
    const result = await fsCommand(sandboxId, `test -e "${path}"`, body)
    return result.exitCode === 0
  }

  if (pathname === '/v1/sandbox/remove') {
    const path = shellEscape(String(body.path))
    const result = await fsCommand(sandboxId, `rm -rf "${path}"`, body)
    if (result.exitCode !== 0) throw new Error(result.stderr || `Failed to remove: ${body.path}`)
    return { success: true }
  }

  throw new HttpError(404, 'Not found')
}

/** Streams NDJSON lines: `{type:'stdout'|'stderr',data}` while running, then `{type:'exit',exitCode}` or `{type:'error',error}`. */
async function handleStream(pathname: string, body: Json, res: ServerResponse): Promise<void> {
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' })
  res.flushHeaders()
  const line = (event: Json) => res.write(`${JSON.stringify(event)}\n`)
  try {
    const result = await handle(pathname, body, (type, data) => line({ type, data })) as Result
    line({ type: 'exit', exitCode: result.exitCode })
  } catch (error) {
    line({ type: 'error', error: error instanceof Error ? error.message : String(error) })
  }
  res.end()
}

export function createGatewayServer(secret: string): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    if (url.pathname === '/v1/health') {
      return send(res, 200, { status: 'ok', provider: 'cloud-run', version: GATEWAY_VERSION, features: GATEWAY_FEATURES, snapshotStore: snapshotStore().kind })
    }
    const provided = req.headers['x-computesdk-cloud-run-secret'] ?? req.headers.authorization?.replace(/^Bearer\s+/i, '')
    if (provided !== secret) return send(res, 401, { error: 'Unauthorized' })
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' })

    try {
      const body = await readBody(req)
      if (url.pathname === '/v1/sandbox/exec/stream') {
        validateId(body.sandboxId || 'x')
        return await handleStream(url.pathname, body, res)
      }
      send(res, 200, await handle(url.pathname, body))
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      if (!res.headersSent) send(res, status, { error: error instanceof Error ? error.message : String(error) })
      else res.end()
    }
  })
}

function isMain(): boolean {
  try {
    return !!process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
  } catch {
    return false
  }
}

if (isMain()) {
  const secret = process.env.SANDBOX_SECRET ?? process.env.CLOUD_RUN_SANDBOX_SECRET
  if (!secret) {
    console.error('Missing SANDBOX_SECRET or CLOUD_RUN_SANDBOX_SECRET')
    process.exit(1)
  }
  const server = createGatewayServer(secret)
  const reaper = setInterval(() => { void reapIdleSandboxes() }, 60_000)
  reaper.unref()
  process.on('SIGTERM', () => {
    clearInterval(reaper)
    server.close()
    void Promise.all([...sandboxes.keys()].map(id => deleteSandbox(id).catch(() => {}))).finally(() => process.exit(0))
  })
  server.listen(Number(process.env.PORT ?? 8080), () => {
    console.log(`ComputeSDK Cloud Run gateway listening on ${process.env.PORT ?? 8080}`)
  })
}
