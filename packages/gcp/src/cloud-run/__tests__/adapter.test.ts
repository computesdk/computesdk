import { execFile } from 'node:child_process'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runProviderTestSuite } from '@computesdk/test-utils'
import { cloudRun } from '../index'
import { createGatewayServer } from '../gateway'
import { createFakeSandboxCli } from './helpers/fake-sandbox-cli'

// The gateway reads its binary from the env on each call, so this must be set
// before any test runs; the local gateway serves both the suite and unit tests.
const cli = createFakeSandboxCli()
process.env.CLOUD_RUN_SANDBOX_BINARY = cli.binary
process.env.CLOUD_RUN_SNAPSHOT_DIR = join(cli.state, 'snapshots')

const SECRET = 'adapter-secret'
const gateway = createGatewayServer(SECRET)
await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve))
const gatewayUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`

afterAll(() => {
  gateway.close()
  cli.cleanup()
})

runProviderTestSuite({
  name: 'cloud-run',
  provider: cloudRun({ sandboxUrl: gatewayUrl, sandboxSecret: SECRET, executionMode: 'stateful' }),
  supportsFilesystem: true,
  supportsGetUrl: false,
  supportsStreaming: true,
  supportsProcesses: true,
  supportsSnapshots: true,
  expectProcessRuntime: { streaming: 'native', processes: 'shell' },
  timeout: 30_000,
  lifecycleTimeout: 60_000,
})

describe('cloudRun adapter against the local gateway', () => {
  const provider = cloudRun({ sandboxUrl: gatewayUrl, sandboxSecret: SECRET })

  it('keeps state for stateful sandboxes and restores snapshots', async () => {
    const source = await provider.sandbox.create({ ephemeral: false })
    const restored: Array<{ destroy: () => Promise<void> }> = []
    try {
      await source.runCommand('echo persisted > state.txt')
      expect((await source.runCommand('cat state.txt')).stdout).toBe('persisted\n')

      const snapshot = await provider.snapshot!.create(source.sandboxId)
      expect(snapshot).toMatchObject({ provider: 'cloud-run', metadata: { store: 'local', sourceSandboxId: source.sandboxId } })
      expect((await provider.snapshot!.list()).map(s => s.id)).toContain(snapshot.id)

      const copy = await provider.sandbox.create({ snapshotId: snapshot.id })
      restored.push(copy)
      expect((await copy.runCommand('cat state.txt')).stdout).toBe('persisted\n')

      await provider.snapshot!.delete(snapshot.id)
      expect((await provider.snapshot!.list()).map(s => s.id)).not.toContain(snapshot.id)
    } finally {
      for (const sandbox of restored) await sandbox.destroy()
      await source.destroy()
    }
    expect(await provider.sandbox.getById(source.sandboxId)).toBeNull()
  })

  it('refuses to snapshot an ephemeral sandbox', async () => {
    const sandbox = await provider.sandbox.create()
    await expect(provider.snapshot!.create(sandbox.sandboxId)).rejects.toThrow(/stateful sandbox/)
    await sandbox.destroy()
  })
})

/** Mimics gateways deployed before feature flags: no-op lifecycle, every call a fresh `sandbox do`. */
function startStaleGateway(): Promise<{ server: Server; url: string; requests: { path: string; cookie?: string }[] }> {
  const requests: { path: string; cookie?: string }[] = []
  const run = promisify(execFile)
  const server = createServer(async (req: IncomingMessage, res) => {
    const url = req.url ?? '/'
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Set-Cookie': 'GAESA=instance-1; Path=/; HttpOnly' })
      res.end(JSON.stringify(body))
    }
    if (url === '/v1/health') return reply(200, { status: 'ok', provider: 'cloud-run' })
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = raw ? JSON.parse(raw) : {}
    requests.push({ path: url, cookie: req.headers.cookie })
    if (url === '/v1/sandbox/create') return reply(200, { sandboxId: body.sandboxId, status: 'running' })
    if (url === '/v1/sandbox/destroy') return reply(200, { success: true })
    if (url === '/v1/sandbox/exec' || url === '/v1/sandbox/do') {
      const result = await run('/bin/sh', ['-c', body.command]).then(
        ({ stdout, stderr }) => ({ stdout, stderr, exitCode: 0 }),
        (error: any) => ({ stdout: error.stdout ?? '', stderr: error.stderr ?? '', exitCode: 1 }),
      )
      return reply(200, result)
    }
    reply(404, { error: 'Not found' })
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests })
  }))
}

describe('cloudRun adapter against a gateway without feature flags', () => {
  let stale: Awaited<ReturnType<typeof startStaleGateway>>
  beforeAll(async () => { stale = await startStaleGateway() })
  afterAll(() => { stale.server.close() })

  it('runs commands, replays the affinity cookie, and buffers streamed output', async () => {
    const provider = cloudRun({ sandboxUrl: stale.url, sandboxSecret: 'x', executionMode: 'stateful' })
    const sandbox = await provider.sandbox.create()
    const chunks: string[] = []
    const result = await sandbox.runCommand('echo hi', { onStdout: data => chunks.push(data) })
    expect(result).toMatchObject({ stdout: 'hi\n', exitCode: 0 })
    expect(chunks).toEqual(['hi\n'])
    await sandbox.destroy()
    expect(stale.requests.map(r => r.path)).toEqual(['/v1/sandbox/create', '/v1/sandbox/exec', '/v1/sandbox/destroy'])
    expect(stale.requests.slice(1).every(r => r.cookie === 'GAESA=instance-1')).toBe(true)
  })

  it('fails snapshot calls with a redeploy hint instead of calling missing routes', async () => {
    const provider = cloudRun({ sandboxUrl: stale.url, sandboxSecret: 'x' })
    const before = stale.requests.length
    await expect(provider.snapshot!.create('any')).rejects.toThrow(/does not support snapshots; redeploy/)
    await expect(provider.sandbox.create({ snapshotId: 'snap-1' })).rejects.toThrow(/does not support snapshots/)
    expect(stale.requests.length).toBe(before)
  })
})
