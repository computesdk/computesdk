/**
 * ComputeSDK Cloud Run Gateway
 *
 * Runs inside a Cloud Run service deployed with --sandbox-launcher and exposes
 * a small authenticated REST API that proxies to /usr/local/gcp/bin/sandbox.
 */

import { spawn } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'

const SANDBOX_BINARY = process.env.CLOUD_RUN_SANDBOX_BINARY ?? '/usr/local/gcp/bin/sandbox'
const SANDBOX_SECRET = process.env.SANDBOX_SECRET ?? process.env.CLOUD_RUN_SANDBOX_SECRET
const DEFAULT_TIMEOUT_MS = 300_000

type Json = Record<string, any>

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

function formatMount(mount: Json): string {
  return `type=${mount.type ?? 'bind'},src=${String(mount.src)},dst=${String(mount.dst)}`
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

function pushExecArgs(args: string[], body: Json): void {
  if (body.cwd) args.push('--workdir', String(body.cwd))
  for (const [key, value] of Object.entries(body.env ?? {})) {
    validateEnvName(key)
    args.push('-e', `${key}=${String(value)}`)
  }
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
  for (const [key, value] of Object.entries(body.env ?? {})) {
    validateEnvName(key)
    args.push('-e', `${key}=${String(value)}`)
  }
  args.push(...((body.runArgs ?? []) as string[]))
}

async function doCommand(command: string, body: Json = {}) {
  const args = ['do']
  pushRunArgs(args, body, true)
  args.push('--', '/bin/sh', '-c', command)
  return runSandbox(args, body.timeout)
}

async function execCommand(sandboxId: string, command: string, body: Json = {}) {
  const args = ['exec', sandboxId]
  pushExecArgs(args, body)
  args.push('--', '/bin/sh', '-c', command)
  return runSandbox(args, body.timeout)
}

async function handle(pathname: string, body: Json): Promise<unknown> {
  const sandboxId = validateSandboxId(body.sandboxId || `cloud-run-${randomUUID()}`)

  if (pathname === '/v1/sandbox/do') {
    if (!body.command) throw new Error('Missing required field: command')
    const result = await doCommand(String(body.command), body)
    return { sandboxId: `do-${randomUUID()}`, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
  }

  if (pathname === '/v1/sandbox/create') {
    const args = ['run', sandboxId, '--detach']
    pushRunArgs(args, body)
    const result = await runSandbox(args, body.timeout)
    if (result.exitCode !== 0) throw new Error(result.stderr || `Failed to create Cloud Run sandbox ${sandboxId}`)
    return { sandboxId, status: 'running' }
  }

  if (!body.sandboxId) throw new Error('Missing sandboxId')

  if (pathname === '/v1/sandbox/destroy') {
    const child = spawn(SANDBOX_BINARY, ['delete', sandboxId, '--force', '--stdin=false', '--stdout=false', '--stderr=false'], {
      stdio: 'ignore',
      detached: true,
    })
    child.unref()
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
    const result = await doCommand(`if [ -f "${path}" ]; then base64 "${path}" | tr -d '\\n'; else exit 1; fi`)
    if (result.exitCode !== 0) throw new Error(result.stderr || `File not found: ${body.path}`)
    return Buffer.from(result.stdout, 'base64').toString('utf8')
  }

  if (pathname === '/v1/sandbox/writeFile') {
    if (!body.path) throw new Error('Missing required field: path')
    if (body.content === undefined) throw new Error('Missing required field: content')
    const path = shellEscape(String(body.path))
    const b64 = Buffer.from(String(body.content), 'utf8').toString('base64')
    const result = await doCommand(`mkdir -p "$(dirname "${path}")" && printf '%s' '${b64}' | base64 -d > "${path}"`)
    if (result.exitCode !== 0) throw new Error(result.stderr || `Failed to write: ${body.path}`)
    return { success: true }
  }

  if (pathname === '/v1/sandbox/mkdir') {
    const path = shellEscape(String(body.path))
    const result = await doCommand(`mkdir -p "${path}"`)
    if (result.exitCode !== 0) throw new Error(result.stderr || `Failed to create directory: ${body.path}`)
    return { success: true }
  }

  if (pathname === '/v1/sandbox/readdir') {
    const path = shellEscape(String(body.path))
    const result = await doCommand(`ls -la "${path}"`)
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
    const result = await doCommand(`test -e "${path}"`)
    return result.exitCode === 0
  }

  if (pathname === '/v1/sandbox/remove') {
    const path = shellEscape(String(body.path))
    const result = await doCommand(`rm -rf "${path}"`)
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
