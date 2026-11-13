import { afterEach, describe, expect, it, vi } from 'vitest'
import { UnoClient } from '../client'
import { uno } from '../index'

type Call = { method: string; url: string; body?: any; raw?: Uint8Array }
type Reply = [number, unknown] | [number, unknown, Record<string, string>]

/**
 * A scripted fetch: each handler gets the call and returns [status, body, headers?].
 * A Uint8Array body is sent as-is (file bytes); a string as text; anything else as JSON.
 */
function mockFetch(handlers: Array<(c: Call) => Reply | Promise<Reply>>) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const raw = init.body instanceof Uint8Array ? init.body : undefined
      const call: Call = { method: init.method ?? 'GET', url, raw, body: init.body && !raw ? JSON.parse(String(init.body)) : undefined }
      calls.push(call)
      const h = handlers.shift()
      if (!h) throw new Error(`unexpected request ${call.method} ${url}`)
      const [status, body, headers] = await h(call)
      const payload = body instanceof Uint8Array || typeof body === 'string' ? body : body === undefined ? '' : JSON.stringify(body)
      return new Response(payload as BodyInit, { status, headers })
    }),
  )
  return calls
}

const box = (over: Record<string, unknown> = {}) => ({
  id: 42,
  name: 'b',
  status: 'running',
  provision_state: 'ready',
  vcpu: 2,
  ram_mb: 2048,
  disk_gb: 10,
  created_at: '2026-11-13T00:00:00Z',
  ...over,
})
const ok = (stdout = '', exit_code = 0): Reply => [200, { status: 'finished', exit_code, stdout, stderr: '' }]
const api = 'https://api.test'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('pause and resume', () => {
  it('maps to sleep and wake and declares that memory survives', async () => {
    const calls = mockFetch([() => [201, box()], () => [200, { status: 'sleeping' }], () => [200, { status: 'running' }]])
    const compute = uno({ apiKey: 'k', baseUrl: api })
    expect(compute.instances.pause).toEqual({ memory: true })
    const sandbox = await compute.instances.create()
    await sandbox.pause!()
    await sandbox.resume!()
    expect(calls.slice(1).map(c => `${c.method} ${c.url}`)).toEqual([`POST ${api}/api/v1/boxes/42/sleep`, `POST ${api}/api/v1/boxes/42/wake`])
  })

  it('waits out BOX_BUSY instead of failing the pause', async () => {
    const calls = mockFetch([
      () => [201, box()],
      () => [409, { error: 'BOX_BUSY' }],
      () => [409, { error: 'BOX_BUSY' }],
      () => [200, { status: 'sleeping' }],
    ])
    const sandbox = await uno({ apiKey: 'k', baseUrl: api }).instances.create()
    await sandbox.pause!()
    expect(calls.filter(c => c.url.endsWith('/sleep'))).toHaveLength(3)
  })
})

describe('snapshots', () => {
  it('flushes the disk, copies it into a sleeping snapshot machine and returns its id', async () => {
    const calls = mockFetch([
      () => ok(),
      c => [201, { boxes: [box({ id: 77, name: c.body.name, status: 'provisioning', provision_state: 'pending', clone_of: 42 })] }],
      () => [200, box({ id: 77, name: 'computesdk-snapshot-x', clone_of: 42 })],
      () => [200, { status: 'sleeping' }],
    ])
    const compute = uno({ apiKey: 'k', baseUrl: api })
    expect(compute.snapshot!.capabilities).toMatchObject({ scope: 'rootfs', memory: false, destroysSource: false, fork: true })
    const snap = await compute.snapshot!.create('42', { name: 'before tests' })
    expect(calls[0]).toMatchObject({ method: 'POST', url: `${api}/api/v1/boxes/42/run`, body: { cmd: 'sync' } })
    expect(calls[1]).toMatchObject({ method: 'POST', url: `${api}/api/v1/boxes/42/clone`, body: { count: 1 } })
    expect(calls[1].body.name).toMatch(/^computesdk-snapshot-[0-9a-f]{12}-before tests$/)
    expect(calls[2]).toMatchObject({ method: 'GET', url: `${api}/api/v1/boxes/77` })
    expect(calls[3]).toMatchObject({ method: 'POST', url: `${api}/api/v1/boxes/77/sleep` })
    expect(snap).toMatchObject({ id: '77', provider: 'uno', metadata: { sourceInstanceId: '42' } })
  })

  it('deletes the half-made snapshot machine when its start fails', async () => {
    const calls = mockFetch([
      () => ok(),
      () => [201, { boxes: [box({ id: 77, name: 'computesdk-snapshot-x', status: 'provisioning', provision_state: 'pending' })] }],
      () => [200, box({ id: 77, status: 'error', provision_state: 'failed', provision_error: 'disk' })],
      () => [200, { status: 'deleted' }],
    ])
    await expect(uno({ apiKey: 'k', baseUrl: api }).snapshot!.create('42')).rejects.toThrow(/failed to start/)
    expect(calls[3]).toMatchObject({ method: 'DELETE', url: `${api}/api/v1/boxes/77?purge=now` })
  })

  it('creates an instance from a snapshot it made without looking it up first', async () => {
    const calls = mockFetch([
      () => ok(),
      () => [201, { boxes: [box({ id: 77, name: 'computesdk-snapshot-x' })] }],
      () => [200, { status: 'sleeping' }],
      c => [201, { boxes: [box({ id: 78, name: c.body.name, status: 'provisioning', provision_state: 'pending' })] }],
      () => [200, box({ id: 78 })],
      () => ok('hi\n'),
    ])
    const compute = uno({ apiKey: 'k', baseUrl: api })
    const snap = await compute.snapshot!.create('42')
    const restored = await compute.instances.create({ snapshotId: snap.id, envs: { A: '1' } })
    expect(restored.instanceId).toBe('78')
    expect(calls[3]).toMatchObject({ method: 'POST', url: `${api}/api/v1/boxes/77/clone`, body: { count: 1 } })
    await restored.runCommand('echo hi')
    expect(calls[5]).toMatchObject({ url: `${api}/api/v1/boxes/78/run`, body: { env: { A: '1' } } })
  })

  it('forks a live machine by id: flushes it first', async () => {
    const calls = mockFetch([
      () => [200, box({ id: 42 })],
      () => ok(),
      () => [201, { boxes: [box({ id: 79 })] }],
    ])
    const fork = await uno({ apiKey: 'k', baseUrl: api }).instances.create({ snapshotId: '42' })
    expect(fork.instanceId).toBe('79')
    expect(calls.map(c => `${c.method} ${c.url.replace(api, '')}`)).toEqual([
      'GET /api/v1/boxes/42',
      'POST /api/v1/boxes/42/run',
      'POST /api/v1/boxes/42/clone',
    ])
  })

  it('lists snapshots apart from instances and refuses to delete a working machine as a snapshot', async () => {
    const boxes = [box({ id: 1, name: 'worker' }), box({ id: 2, name: 'computesdk-snapshot-abc', status: 'sleeping', clone_of: 1 })]
    mockFetch([
      () => [200, { boxes }],
      () => [200, { boxes }],
      () => [200, { boxes }],
      () => [200, box({ id: 1, name: 'worker' })],
      () => [200, box({ id: 2, name: 'computesdk-snapshot-abc' })],
      () => [200, { status: 'deleted' }],
    ])
    const compute = uno({ apiKey: 'k', baseUrl: api })
    expect((await compute.instances.list()).map(i => i.instanceId)).toEqual(['1'])
    expect((await compute.snapshot!.list()).map(s => s.id)).toEqual(['2'])
    expect(await compute.snapshot!.list({ instanceId: '9' })).toEqual([])
    await expect(compute.snapshot!.delete('1')).rejects.toThrow(/not a snapshot/)
    await expect(compute.snapshot!.delete('2')).resolves.toBeUndefined()
  })
})

describe('native file API', () => {
  const bytes = (s: string) => new TextEncoder().encode(s)

  it('reads and writes a file in one request each', async () => {
    const calls = mockFetch([
      () => [201, box()],
      () => [200, { path: 'a/b.txt', size: 5 }],
      () => [200, bytes('héllo'), { 'content-type': 'application/octet-stream', 'x-uno-file-size': '6' }],
    ])
    const sandbox = await uno({ apiKey: 'k', baseUrl: api }).instances.create()
    await sandbox.filesystem.writeFile('a/b.txt', 'hello')
    expect(calls[1]).toMatchObject({ method: 'PUT', url: `${api}/api/v1/boxes/42/files?path=a%2Fb.txt` })
    expect(Buffer.from(calls[1].raw!).toString()).toBe('hello')
    expect(await sandbox.filesystem.readFile('a/b.txt')).toBe('héllo')
    expect(calls).toHaveLength(3)
  })

  it('says "no such file" for a missing file', async () => {
    mockFetch([() => [201, box()], () => [404, { error: 'FILE_NOT_FOUND' }]])
    const sandbox = await uno({ apiKey: 'k', baseUrl: api }).instances.create()
    await expect(sandbox.filesystem.readFile('/nope')).rejects.toThrow(/Cannot read \/nope: no such file/)
  })

  it('falls back to commands on a server without the endpoints, and stops asking it', async () => {
    const calls = mockFetch([
      () => [201, box()],
      () => [404, '404 page not found\n'],
      () => ok('5\naGVsbG8='),
      () => ok('2\naGk='),
      () => ok(),
    ])
    const sandbox = await uno({ apiKey: 'k', baseUrl: api }).instances.create()
    expect(await sandbox.filesystem.readFile('/x')).toBe('hello')
    expect(await sandbox.filesystem.readFile('/y')).toBe('hi')
    await sandbox.filesystem.writeFile('/z', 'ok')
    // One probe of /files, then each operation is a single command.
    expect(calls.map(c => c.url.replace(api, '').split('?')[0])).toEqual([
      '/api/v1/boxes',
      '/api/v1/boxes/42/files',
      '/api/v1/boxes/42/run',
      '/api/v1/boxes/42/run',
      '/api/v1/boxes/42/run',
    ])
    expect(calls[4].body.cmd).toMatch(/^mkdir -p .* base64 -d > ".*\.tmp" && mv -f ".*\.tmp" "\/z"$/)
  })

  it('never takes the web app answering an unknown path for file bytes', async () => {
    mockFetch([
      () => [201, box()],
      () => [200, '<!doctype html><title>Uno</title>', { 'content-type': 'text/html' }],
      () => ok('2\naGk='),
    ])
    const sandbox = await uno({ apiKey: 'k', baseUrl: api }).instances.create()
    expect(await sandbox.filesystem.readFile('/y')).toBe('hi')
  })

  it('sends a file over the edge body limit as parts and renames it into place', async () => {
    const calls = mockFetch([
      () => [201, box()],
      c => [200, { size: c.raw!.length }],
      c => [200, { size: c.raw!.length }],
      () => ok(),
    ])
    const sandbox = await uno({ apiKey: 'k', baseUrl: api }).instances.create()
    const content = 'x'.repeat(64 * 1024 * 1024 + 10)
    await sandbox.filesystem.writeFile('/data/big.bin', content)
    expect(calls[1].url).toMatch(/files\?path=%2Fdata%2Fbig\.bin\.computesdk-[0-9a-f]{8}\.part$/)
    expect(calls[2].url).toMatch(/\.part&append=1$/)
    expect(calls[1].raw!.length + calls[2].raw!.length).toBe(content.length)
    expect(calls[3].body.cmd).toMatch(/^mv -f ".*\.part" "\/data\/big\.bin"$/)
  })
})

describe('commands on one machine', () => {
  it('queues concurrent commands instead of bouncing them off BOX_BUSY', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => (release = r))
    const calls = mockFetch([() => [201, box()], async () => (await gate, ok('a')), () => ok('b')])
    const sandbox = await uno({ apiKey: 'k', baseUrl: api }).instances.create()
    const a = sandbox.runCommand('sleep 1; echo a')
    const b = sandbox.runCommand('echo b')
    await new Promise(r => setTimeout(r, 20))
    // The second command has not been sent while the first is running.
    expect(calls).toHaveLength(2)
    release()
    expect((await a).stdout).toBe('a')
    expect((await b).stdout).toBe('b')
    expect(calls).toHaveLength(3)
  })

  it('keeps commands on different machines parallel', async () => {
    const c = new UnoClient({ apiKey: 'k', baseUrl: api })
    let inFlight = 0
    let peak = 0
    mockFetch([1, 2].map(() => async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(r => setTimeout(r, 20))
      inFlight--
      return ok()
    }))
    await Promise.all([c.run(1, { cmd: 'true', timeout_s: 5 }), c.run(2, { cmd: 'true', timeout_s: 5 })])
    expect(peak).toBe(2)
  })

  it('lists a directory in one command', async () => {
    const calls = mockFetch([() => [201, box()], () => ok('f\t5\t1700000000.5\ta.txt\nd\t4096\t1700000000\tsub\n')])
    const sandbox = await uno({ apiKey: 'k', baseUrl: api }).instances.create()
    const entries = await sandbox.filesystem.readdir('/data')
    expect(entries.map(e => [e.name, e.type, e.size])).toEqual([
      ['a.txt', 'file', 5],
      ['sub', 'directory', 4096],
    ])
    expect(calls).toHaveLength(2)
  })
})
