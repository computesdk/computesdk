import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSandboxCli, type FakeSandboxCli } from './helpers/fake-sandbox-cli'

const SECRET = 'test-secret'
let cli: FakeSandboxCli
let server: Server
let baseUrl: string
let gateway: typeof import('../gateway')

async function call(path: string, body: Record<string, unknown> = {}, secret = SECRET) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-ComputeSDK-Cloud-Run-Secret': secret },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: await res.json() as any }
}

const stateful = (sandboxId: string, extra: Record<string, unknown> = {}) => ({ sandboxId, executionMode: 'stateful', ...extra })
const subcommands = () => cli.calls().map(args => args[0])

beforeAll(async () => {
  cli = createFakeSandboxCli()
  process.env.CLOUD_RUN_SANDBOX_BINARY = cli.binary
  process.env.CLOUD_RUN_SNAPSHOT_DIR = join(cli.state, 'snapshots')
  gateway = await import('../gateway')
  server = gateway.createGatewayServer(SECRET)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server?.close()
  cli?.cleanup()
  delete process.env.CLOUD_RUN_SANDBOX_BINARY
  delete process.env.CLOUD_RUN_SNAPSHOT_DIR
})

beforeEach(() => {
  delete process.env.CLOUD_RUN_SNAPSHOT_BUCKET
})

describe('Cloud Run gateway', () => {
  it('advertises its features on the unauthenticated health route', async () => {
    const res = await fetch(`${baseUrl}/v1/health`)
    expect(await res.json()).toEqual({
      status: 'ok', provider: 'cloud-run', version: 2,
      features: ['stateful', 'exec-stream', 'snapshot', 'fork'], snapshotStore: 'local',
    })
  })

  it('rejects bad secrets and unsafe ids', async () => {
    expect((await call('/v1/sandbox/exec', { sandboxId: 'a', command: 'true' }, 'wrong')).status).toBe(401)
    expect((await call('/v1/sandbox/exec', { sandboxId: '../etc', command: 'true' })).status).toBe(400)
    expect((await call('/v1/sandbox/create', { sandboxId: 'ok', snapshotId: '../x' })).status).toBe(400)
    expect((await call('/v1/sandbox/exec', { sandboxId: 'a', command: 'true', env: { 'A;B': '1' } })).status).toBe(400)
  })

  it('keeps a stateful sandbox between exec and file calls until destroy', async () => {
    const created = await call('/v1/sandbox/create', stateful('keep-1', { env: { FOO: 'bar' } }))
    expect(created).toEqual({ status: 200, data: { sandboxId: 'keep-1', status: 'running' } })
    expect(cli.calls().at(-1)).toEqual(['run', '--write', '-e', 'FOO=bar', '--detach', 'keep-1'])

    expect((await call('/v1/sandbox/exec', stateful('keep-1', { command: 'echo state > m; echo $FOO' }))).data)
      .toEqual({ stdout: 'bar\n', stderr: '', exitCode: 0 })
    expect((await call('/v1/sandbox/exec', stateful('keep-1', { command: 'cat m' }))).data.stdout).toBe('state\n')

    await call('/v1/sandbox/writeFile', stateful('keep-1', { path: 'dir/f.txt', content: 'hello' }))
    expect((await call('/v1/sandbox/readFile', stateful('keep-1', { path: 'dir/f.txt' }))).data).toBe('hello')
    expect((await call('/v1/sandbox/exists', stateful('keep-1', { path: 'dir/f.txt' }))).data).toBe(true)
    expect((await call('/v1/sandbox/readdir', stateful('keep-1', { path: 'dir' }))).data).toEqual([{ name: 'f.txt', type: 'file', size: 5 }])
    await call('/v1/sandbox/remove', stateful('keep-1', { path: 'dir' }))
    expect((await call('/v1/sandbox/exists', stateful('keep-1', { path: 'dir' }))).data).toBe(false)
    expect(subcommands()).not.toContain('do')

    expect((await call('/v1/sandbox/info', { sandboxId: 'keep-1' })).data.status).toBe('running')
    expect((await call('/v1/sandbox/destroy', { sandboxId: 'keep-1' })).data).toEqual({ success: true })
    expect(cli.calls().at(-1)).toEqual(['delete', '--force', 'keep-1'])
    expect((await call('/v1/sandbox/info', { sandboxId: 'keep-1' })).status).toBe(404)
    const after = await call('/v1/sandbox/exec', stateful('keep-1', { command: 'true' }))
    expect(after.data.exitCode).toBe(1)
    expect(after.data.stderr).toContain('not running')
    // Destroying again is idempotent.
    expect((await call('/v1/sandbox/destroy', { sandboxId: 'keep-1' })).status).toBe(200)
  })

  it('isolates sandboxes from each other', async () => {
    await call('/v1/sandbox/create', stateful('iso-a'))
    await call('/v1/sandbox/create', stateful('iso-b'))
    await call('/v1/sandbox/exec', stateful('iso-a', { command: 'echo a > only-a' }))
    expect((await call('/v1/sandbox/exec', stateful('iso-b', { command: 'test -e only-a' }))).data.exitCode).toBe(1)
  })

  it('reports the command exit status rather than the CLI status', async () => {
    await call('/v1/sandbox/create', stateful('exit-1'))
    const res = await call('/v1/sandbox/exec', stateful('exit-1', { command: 'echo out; echo err >&2; exit 3' }))
    expect(res.data).toEqual({ stdout: 'out\n', stderr: 'err\n', exitCode: 3 })
    const ephemeral = await call('/v1/sandbox/do', { command: 'printf x >&2; exit 42' })
    expect(ephemeral.data).toMatchObject({ stderr: 'x', exitCode: 42 })
  })

  it('kills a command at its deadline inside the sandbox', async () => {
    await call('/v1/sandbox/create', stateful('deadline-1'))
    const started = Date.now()
    const res = await call('/v1/sandbox/exec', stateful('deadline-1', { command: 'sleep 3; touch late', timeout: 1000 }))
    expect(res.data.exitCode).toBe(124)
    expect(Date.now() - started).toBeLessThan(2900)
    await new Promise(resolve => setTimeout(resolve, 2500))
    expect((await call('/v1/sandbox/exec', stateful('deadline-1', { command: 'test -e late' }))).data.exitCode).toBe(1)
  }, 15_000)

  it('runs ephemeral file routes in a fresh `sandbox do`', async () => {
    await call('/v1/sandbox/writeFile', { sandboxId: 'eph-1', path: 'x', content: 'y' })
    expect(cli.calls().at(-1)?.slice(0, 2)).toEqual(['do', '--write'])
    expect((await call('/v1/sandbox/exists', { sandboxId: 'eph-1', path: 'x' })).data).toBe(false)
  })

  it('streams exec output as NDJSON while the command runs', async () => {
    await call('/v1/sandbox/create', stateful('stream-1'))
    const res = await fetch(`${baseUrl}/v1/sandbox/exec/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-ComputeSDK-Cloud-Run-Secret': SECRET },
      body: JSON.stringify(stateful('stream-1', { command: 'echo t1; sleep 1; echo e1 >&2; echo t2; exit 5' })),
    })
    expect(res.headers.get('content-type')).toBe('application/x-ndjson')
    const decoder = new TextDecoder()
    const started = Date.now()
    let firstAt = 0
    let text = ''
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      if (!firstAt) firstAt = Date.now() - started
      text += decoder.decode(chunk, { stream: true })
    }
    const events = text.trim().split('\n').map(line => JSON.parse(line))
    expect(firstAt).toBeLessThan(800)
    expect(events[0]).toEqual({ type: 'stdout', data: 't1\n' })
    expect(events.filter(e => e.type === 'stdout').map(e => e.data).join('')).toBe('t1\nt2\n')
    expect(events.filter(e => e.type === 'stderr').map(e => e.data).join('')).toBe('e1\n')
    expect(events.at(-1)).toEqual({ type: 'exit', exitCode: 5 })
  })

  it('snapshots to the local store and restores into a new sandbox', async () => {
    await call('/v1/sandbox/create', stateful('snap-src'))
    await call('/v1/sandbox/exec', stateful('snap-src', { command: 'mkdir -p work && echo snap > work/m' }))
    const snap = await call('/v1/sandbox/snapshot', { sandboxId: 'snap-src' })
    expect(snap.data).toMatchObject({ store: 'local', sourceSandboxId: 'snap-src' })
    const { snapshotId, uri } = snap.data
    expect(cli.calls().at(-1)).toEqual(['tar', `--file=${uri}`, 'snap-src'])
    expect(existsSync(uri)).toBe(true)

    // The source keeps running.
    expect((await call('/v1/sandbox/exec', stateful('snap-src', { command: 'cat work/m' }))).data.stdout).toBe('snap\n')

    await call('/v1/sandbox/create', stateful('snap-dst', { snapshotId }))
    expect(cli.calls().at(-1)).toEqual(['run', '--write', '--import-tar', uri, '--detach', 'snap-dst'])
    expect((await call('/v1/sandbox/exec', stateful('snap-dst', { command: 'cat work/m' }))).data.stdout).toBe('snap\n')

    const list = await call('/v1/snapshot/list')
    expect(list.data.map((s: any) => s.snapshotId)).toContain(snapshotId)
    await call('/v1/snapshot/delete', { snapshotId })
    expect(existsSync(uri)).toBe(false)
    expect((await call('/v1/sandbox/create', stateful('snap-gone', { snapshotId }))).status).toBe(500)
  })

  it('reports a missing source sandbox as 404 when snapshotting', async () => {
    const res = await call('/v1/sandbox/snapshot', { sandboxId: 'never-created' })
    expect(res.status).toBe(404)
  })

  it('snapshots to GCS when CLOUD_RUN_SNAPSHOT_BUCKET is set', async () => {
    process.env.CLOUD_RUN_SNAPSHOT_BUCKET = 'snap-bucket'
    const gcsRoot = join(cli.state, 'gcs', 'snap-bucket')
    const realFetch = globalThis.fetch
    const seen: string[] = []
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.hostname === 'metadata.google.internal') {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }))
      }
      if (url.hostname === 'storage.googleapis.com') {
        seen.push(`${init?.method ?? 'GET'} ${url.pathname} ${(init?.headers as any)?.Authorization}`)
        const objectMatch = /\/o\/(.+)$/.exec(url.pathname)
        if (init?.method === 'DELETE' && objectMatch) {
          rmSync(join(gcsRoot, decodeURIComponent(objectMatch[1])), { force: true })
          return new Response(null, { status: 204 })
        }
        const prefix = url.searchParams.get('prefix') ?? ''
        mkdirSync(join(gcsRoot, prefix), { recursive: true })
        const items = readdirSync(join(gcsRoot, prefix)).map(name => ({
          name: `${prefix}${name}`, size: String(statSync(join(gcsRoot, prefix, name)).size), timeCreated: '2026-01-01T00:00:00Z',
        }))
        return new Response(JSON.stringify({ items }))
      }
      return realFetch(input, init)
    })
    try {
      expect((await (await fetch(`${baseUrl}/v1/health`)).json()).snapshotStore).toBe('gcs')
      await call('/v1/sandbox/create', stateful('gcs-src'))
      await call('/v1/sandbox/exec', stateful('gcs-src', { command: 'echo g > g' }))
      const snap = await call('/v1/sandbox/snapshot', { sandboxId: 'gcs-src', snapshotId: 'named-snap' })
      expect(snap.data).toMatchObject({ snapshotId: 'named-snap', uri: 'gs://snap-bucket/computesdk-snapshots/named-snap.tar', store: 'gcs' })

      await call('/v1/sandbox/create', stateful('gcs-dst', { snapshotId: 'named-snap' }))
      expect(cli.calls().at(-1)).toContain('gs://snap-bucket/computesdk-snapshots/named-snap.tar')
      expect((await call('/v1/sandbox/exec', stateful('gcs-dst', { command: 'cat g' }))).data.stdout).toBe('g\n')

      const list = await call('/v1/snapshot/list')
      expect(list.data).toEqual([expect.objectContaining({ snapshotId: 'named-snap', store: 'gcs', size: expect.any(Number) })])
      await call('/v1/snapshot/delete', { snapshotId: 'named-snap' })
      expect((await call('/v1/snapshot/list')).data).toEqual([])
      expect(seen[0]).toBe('GET /storage/v1/b/snap-bucket/o Bearer tok')
      expect(seen).toContain('DELETE /storage/v1/b/snap-bucket/o/computesdk-snapshots%2Fnamed-snap.tar Bearer tok')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('forks a running sandbox without stopping the source', async () => {
    await call('/v1/sandbox/create', stateful('fork-src'))
    await call('/v1/sandbox/exec', stateful('fork-src', { command: 'echo f > f' }))
    const fork = await call('/v1/sandbox/fork', { sandboxId: 'fork-src', targetSandboxId: 'fork-dst' })
    expect(fork.data).toEqual({ sandboxId: 'fork-dst', sourceSandboxId: 'fork-src', status: 'running' })
    expect(cli.calls().at(-1)).toEqual(['fork', '--detach', 'fork-src', 'fork-dst'])
    expect((await call('/v1/sandbox/exec', stateful('fork-dst', { command: 'cat f' }))).data.stdout).toBe('f\n')
    expect((await call('/v1/sandbox/exec', stateful('fork-src', { command: 'cat f' }))).data.stdout).toBe('f\n')
  })

  it('reaps idle stateful sandboxes', async () => {
    await call('/v1/sandbox/create', stateful('idle-1'))
    process.env.CLOUD_RUN_SANDBOX_IDLE_TIMEOUT_MS = '1000'
    try {
      const reaped = await gateway.reapIdleSandboxes(Date.now() + 60_000)
      expect(reaped).toContain('idle-1')
      expect(existsSync(join(cli.state, 'sb', 'idle-1'))).toBe(false)
    } finally {
      delete process.env.CLOUD_RUN_SANDBOX_IDLE_TIMEOUT_MS
    }
  })
})
