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

  it('declares rootfs snapshots that keep the source', () => {
    expect(provider.snapshot?.capabilities).toEqual({
      scope: 'rootfs',
      memory: false,
      destroysSource: false,
      source: 'kept',
      excludes: ['/tmp'],
      fork: true,
      createOptions: { ephemeral: false },
    })
  })

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

  it('keeps relative benchmark directories and chunked file writes in a stateful sandbox', async () => {
    const sandbox = await provider.sandbox.create({ executionMode: 'stateful' })
    const path = 'bench/fs-cloud-run/.probe'
    const content = 'x'.repeat(40 * 1024)
    try {
      expect((await sandbox.runCommand('mkdir -p bench/fs-cloud-run')).exitCode).toBe(0)
      await sandbox.filesystem.writeFile(path, content)
      expect(await sandbox.filesystem.readFile(path)).toBe(content)
      expect((await sandbox.runCommand('test -f bench/fs-cloud-run/.probe')).exitCode).toBe(0)
    } finally {
      await sandbox.destroy()
    }
  })
})

/** Mimics gateways deployed before feature flags: no-op lifecycle, every call a fresh `sandbox do`. */
type StaleRequest = { path: string; cookie?: string; body: Record<string, any> }

function startStaleGateway(health: Record<string, unknown> = {}): Promise<{ server: Server; url: string; requests: StaleRequest[] }> {
  const requests: StaleRequest[] = []
  const run = promisify(execFile)
  const server = createServer(async (req: IncomingMessage, res) => {
    const url = req.url ?? '/'
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Set-Cookie': 'GAESA=instance-1; Path=/; HttpOnly' })
      res.end(JSON.stringify(body))
    }
    if (url === '/v1/health') return reply(200, { status: 'ok', provider: 'cloud-run', ...health })
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = raw ? JSON.parse(raw) : {}
    requests.push({ path: url, cookie: req.headers.cookie, body })
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

  it('takes allowEgress and executionMode per sandbox, defaulting to the provider config', async () => {
    stale.requests.length = 0
    const provider = cloudRun({ sandboxUrl: stale.url, sandboxSecret: 'x' })
    const custom = await provider.sandbox.create({ executionMode: 'stateful', allowEgress: true })
    await custom.runCommand('true')
    const fallback = await provider.sandbox.create()
    await fallback.runCommand('true')
    expect(stale.requests.map(r => [r.path, r.body.executionMode, r.body.allowEgress])).toEqual([
      ['/v1/sandbox/create', 'stateful', true],
      ['/v1/sandbox/exec', 'stateful', true],
      ['/v1/sandbox/do', 'ephemeral', undefined],
    ])
    await custom.destroy()

    stale.requests.length = 0
    const egress = cloudRun({ sandboxUrl: stale.url, sandboxSecret: 'x', allowEgress: true, executionMode: 'stateful' })
    const off = await egress.sandbox.create({ allowEgress: false, executionMode: 'ephemeral' })
    await off.runCommand('true')
    expect(stale.requests.map(r => [r.path, r.body.executionMode, r.body.allowEgress])).toEqual([
      ['/v1/sandbox/do', 'ephemeral', false],
    ])
  })

  it('fails snapshot calls with a redeploy hint instead of calling missing routes', async () => {
    const provider = cloudRun({ sandboxUrl: stale.url, sandboxSecret: 'x' })
    const before = stale.requests.length
    await expect(provider.snapshot!.create('any')).rejects.toThrow(/does not support snapshots; redeploy/)
    await expect(provider.sandbox.create({ snapshotId: 'snap-1' })).rejects.toThrow(/does not support snapshots/)
    expect(stale.requests.length).toBe(before)
  })
})

describe('cloudRun sizes', () => {
  let md: Awaited<ReturnType<typeof startStaleGateway>>
  let unsized: Awaited<ReturnType<typeof startStaleGateway>>
  beforeAll(async () => {
    md = await startStaleGateway({ features: ['stateful', 'sizes'], size: 'md' })
    unsized = await startStaleGateway()
  })
  afterAll(() => { md.server.close(); unsized.server.close() })

  it('offers sizes that have a gateway, and never 2xl', () => {
    const provider = cloudRun({ sandboxUrl: unsized.url, sandboxSecret: 'x', sizeGateways: { md: md.url } })
    expect(provider.sizes.list().filter(p => p.status === 'supported').map(p => p.requested.sizeClass)).toEqual(['md'])
    expect(provider.sizes.resolve('md')).toMatchObject({ status: 'supported', nativeOptions: { vcpus: 2, memoryMiB: 4096 } })
    expect(provider.sizes.resolve('sm')).toMatchObject({ status: 'unconfigured', reason: expect.stringContaining('CLOUD_RUN_SIZE=sm') })
    expect(provider.sizes.resolve('2xl').status).toBe('unsupported')
    expect(() => provider.sizes.resolve('md', { vcpus: 2 } as any)).toThrow(/sizeClass: cannot combine/)
  })

  it('reads sized gateways from CLOUD_RUN_SANDBOX_URL_<SIZE>', () => {
    process.env.CLOUD_RUN_SANDBOX_URL_XL = md.url
    try {
      expect(cloudRun({ sandboxUrl: unsized.url, sandboxSecret: 'x' }).sizes.resolve('xl').status).toBe('supported')
    } finally {
      delete process.env.CLOUD_RUN_SANDBOX_URL_XL
    }
  })

  it('runs a sized sandbox on the gateway deployed at that size', async () => {
    md.requests.length = 0
    unsized.requests.length = 0
    const provider = cloudRun({ sandboxUrl: unsized.url, sandboxSecret: 'x', executionMode: 'stateful', sizeGateways: { md: { sandboxUrl: md.url, sandboxSecret: 'md-secret' } } })
    const sandbox = await provider.sandbox.create({ sizeClass: 'md', allowEgress: true })
    expect((await sandbox.runCommand('echo sized')).stdout).toBe('sized\n')
    expect((await sandbox.getInfo()).metadata).toMatchObject({ size: 'md', vcpus: 2, memoryMiB: 4096 })
    await sandbox.destroy()
    expect(md.requests.map(r => [r.path, r.body.allowEgress])).toEqual([
      ['/v1/sandbox/create', true], ['/v1/sandbox/exec', true], ['/v1/sandbox/destroy', undefined],
    ])
    expect(unsized.requests).toEqual([])
  })

  it('fails instead of running another size', async () => {
    const provider = cloudRun({ sandboxUrl: unsized.url, sandboxSecret: 'x', sizeGateways: { lg: md.url, sm: unsized.url } })
    await expect(provider.sandbox.create({ sizeClass: 'xl' })).rejects.toThrow(/sizeClass: no Cloud Run gateway is configured at size xl/)
    await expect(provider.sandbox.create({ sizeClass: '2xl' })).rejects.toThrow(/sizeClass: .*top out at 8 vCPU/)
    await expect(provider.sandbox.create({ sizeClass: 'lg' })).rejects.toThrow(/sizeClass: .*deployed at md, not lg/)
    await expect(provider.sandbox.create({ sizeClass: 'sm' })).rejects.toThrow(/deployed at no standard size, not sm/)
    await expect(provider.sandbox.create({ vcpus: 3, memoryMiB: 4096 })).rejects.toThrow(/sizeClass: Cloud Run has no 3 vCPU/)
    expect(unsized.requests.filter(r => r.path === '/v1/sandbox/create')).toEqual([])
  })
})
