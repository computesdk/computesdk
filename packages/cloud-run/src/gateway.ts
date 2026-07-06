/**
 * ComputeSDK Cloud Run Gateway
 *
 * Runs inside a Cloud Run service deployed with --sandbox-launcher and exposes
 * a small authenticated REST API that proxies to /usr/local/gcp/bin/sandbox.
 */

import { spawn } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const SANDBOX_BINARY = process.env.CLOUD_RUN_SANDBOX_BINARY ?? '/usr/local/gcp/bin/sandbox'
const SANDBOX_SECRET = process.env.SANDBOX_SECRET ?? process.env.CLOUD_RUN_SANDBOX_SECRET
const STATE_BUCKET = process.env.CLOUD_RUN_SANDBOX_STATE_BUCKET
const LOCAL_STATE_ROOT = process.env.CLOUD_RUN_SANDBOX_STATE_ROOT ?? join(tmpdir(), 'computesdk-cloud-run-state')
const DEFAULT_TIMEOUT_MS = 300_000

type Json = Record<string, any>
type TokenState = { accessToken: string; expiresAt: number }

let tokenState: TokenState | undefined

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function validateEnvName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Invalid environment variable name: ${JSON.stringify(name)}`)
}

// Sandbox IDs are used as filesystem path components (persist dir) and as CLI args,
// so restrict them to a strict allow-list to prevent path traversal (e.g. `../../etc`).
function validateSandboxId(sandboxId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(sandboxId)) throw Object.assign(new Error(`Invalid sandboxId: ${JSON.stringify(sandboxId)}`), { status: 400 })
  return sandboxId
}

function shellEscape(arg: string): string {
  return arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`')
}

async function readBody(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function runSandbox(args: string[], timeout = DEFAULT_TIMEOUT_MS): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  return new Promise((resolve, reject) => {
    const child = spawn(SANDBOX_BINARY, args, { stdio: ['ignore', 'pipe', 'pipe'], signal: controller.signal })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8') })
    child.on('error', error => {
      clearTimeout(timer)
      if ((error as NodeJS.ErrnoException).name === 'AbortError') {
        resolve({ stdout, stderr: stderr || `Command timed out after ${timeout}ms`, exitCode: 124 })
        return
      }
      reject(error)
    })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode: code ?? 1 })
    })
  })
}

function stateObjectName(sandboxId: string): string {
  return `sandboxes/${sandboxId}.tar`
}

function statePath(sandboxId: string): string {
  return join(LOCAL_STATE_ROOT, `${sandboxId}.tar`)
}

async function getAccessToken(): Promise<string> {
  if (tokenState && tokenState.expiresAt > Date.now() + 60_000) return tokenState.accessToken
  const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'Metadata-Flavor': 'Google' },
  })
  if (!response.ok) throw new Error(`Failed to get metadata access token: ${response.status}`)
  const data = await response.json() as { access_token: string; expires_in: number }
  tokenState = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return tokenState.accessToken
}

async function gcsRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const accessToken = await getAccessToken()
  return fetch(`https://storage.googleapis.com${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${accessToken}`,
    },
  })
}

async function prepareState(sandboxId: string): Promise<string> {
  await mkdir(LOCAL_STATE_ROOT, { recursive: true })
  const path = statePath(sandboxId)
  if (!STATE_BUCKET) return path

  const objectName = encodeURIComponent(stateObjectName(sandboxId))
  const response = await gcsRequest(`/storage/v1/b/${STATE_BUCKET}/o/${objectName}?alt=media`)
  if (response.status === 404) return path
  if (!response.ok) throw new Error(`Failed to download Cloud Run sandbox state: ${response.status}`)
  await writeFile(path, Buffer.from(await response.arrayBuffer()))
  return path
}

async function persistState(sandboxId: string, path: string): Promise<void> {
  if (!STATE_BUCKET || !existsSync(path)) return
  const objectName = encodeURIComponent(stateObjectName(sandboxId))
  const content = await readFile(path)
  const response = await gcsRequest(`/upload/storage/v1/b/${STATE_BUCKET}/o?uploadType=media&name=${objectName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-tar' },
    body: content,
  })
  if (!response.ok) throw new Error(`Failed to upload Cloud Run sandbox state: ${response.status}`)
}

async function removeState(sandboxId: string): Promise<void> {
  await rm(statePath(sandboxId), { force: true })
  if (!STATE_BUCKET) return
  const objectName = encodeURIComponent(stateObjectName(sandboxId))
  const response = await gcsRequest(`/storage/v1/b/${STATE_BUCKET}/o/${objectName}`, { method: 'DELETE' })
  if (!response.ok && response.status !== 404) throw new Error(`Failed to delete Cloud Run sandbox state: ${response.status}`)
}

function pushExecArgs(args: string[], body: Json): void {
  if (body.cwd) args.push('--workdir', String(body.cwd))
  for (const [key, value] of Object.entries(body.env ?? {})) {
    validateEnvName(key)
    args.push('-e', `${key}=${String(value)}`)
  }
}

async function execCommand(sandboxId: string, command: string, body: Json = {}) {
  const stateTar = await prepareState(sandboxId)
  const args = ['do', '--sandbox-name', sandboxId, '--sync-tar', stateTar, '--write']
  pushExecArgs(args, body)
  args.push('--', '/bin/sh', '-c', command)
  const result = await runSandbox(args, body.timeout)
  await persistState(sandboxId, stateTar)
  return result
}

async function handle(pathname: string, body: Json): Promise<unknown> {
  const sandboxId = validateSandboxId(body.sandboxId || `cloud-run-${randomUUID()}`)

  if (pathname === '/v1/sandbox/create') {
    await prepareState(sandboxId)
    return { sandboxId, status: 'running', mode: 'sync-tar' }
  }

  if (!body.sandboxId) throw new Error('Missing sandboxId')

  if (pathname === '/v1/sandbox/destroy') {
    await removeState(sandboxId)
    return { success: true }
  }

  if (pathname === '/v1/sandbox/info') return { sandboxId, status: 'running' }

  if (pathname === '/v1/sandbox/exec') {
    if (!body.command) throw new Error('Missing required field: command')
    return execCommand(sandboxId, String(body.command), body)
  }

  if (pathname === '/v1/sandbox/readFile') {
    if (!body.path) throw new Error('Missing required field: path')
    const path = shellEscape(String(body.path))
    const result = await execCommand(sandboxId, `if [ -f "${path}" ]; then base64 "${path}" | tr -d '\\n'; else exit 1; fi`)
    if (result.exitCode !== 0) throw new Error(result.stderr || `File not found: ${body.path}`)
    return Buffer.from(result.stdout, 'base64').toString('utf8')
  }

  if (pathname === '/v1/sandbox/writeFile') {
    if (!body.path) throw new Error('Missing required field: path')
    if (body.content === undefined) throw new Error('Missing required field: content')
    const path = shellEscape(String(body.path))
    const b64 = Buffer.from(String(body.content), 'utf8').toString('base64')
    const result = await execCommand(sandboxId, `mkdir -p "$(dirname "${path}")" && printf '%s' '${b64}' | base64 -d > "${path}"`)
    if (result.exitCode !== 0) throw new Error(result.stderr || `Failed to write: ${body.path}`)
    return { success: true }
  }

  if (pathname === '/v1/sandbox/mkdir') {
    const path = shellEscape(String(body.path))
    const result = await execCommand(sandboxId, `mkdir -p "${path}"`)
    if (result.exitCode !== 0) throw new Error(result.stderr || `Failed to create directory: ${body.path}`)
    return { success: true }
  }

  if (pathname === '/v1/sandbox/readdir') {
    const path = shellEscape(String(body.path))
    const result = await execCommand(sandboxId, `ls -la "${path}"`)
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
    const result = await execCommand(sandboxId, `test -e "${path}"`)
    return result.exitCode === 0
  }

  if (pathname === '/v1/sandbox/remove') {
    const path = shellEscape(String(body.path))
    const result = await execCommand(sandboxId, `rm -rf "${path}"`)
    if (result.exitCode !== 0) throw new Error(result.stderr || `Failed to remove: ${body.path}`)
    return { success: true }
  }

  throw Object.assign(new Error('Not found'), { status: 404 })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  if (url.pathname === '/v1/health') return send(res, 200, { status: 'ok', provider: 'cloud-run' })
  const secret = req.headers['x-computesdk-cloud-run-secret'] ?? req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (secret !== SANDBOX_SECRET) return send(res, 401, { error: 'Unauthorized' })
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' })

  try {
    const body = await readBody(req)
    send(res, 200, await handle(url.pathname, body))
  } catch (error) {
    const status = typeof (error as any).status === 'number' ? (error as any).status : 500
    send(res, status, { error: error instanceof Error ? error.message : String(error) })
  }
})

if (!SANDBOX_SECRET) {
  console.error('Missing SANDBOX_SECRET or CLOUD_RUN_SANDBOX_SECRET')
  process.exit(1)
}

server.listen(Number(process.env.PORT ?? 8080), () => {
  console.log(`ComputeSDK Cloud Run gateway listening on ${process.env.PORT ?? 8080}`)
})
