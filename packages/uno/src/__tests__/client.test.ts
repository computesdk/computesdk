import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UnoClient, UnoError } from '../client'
import { uno } from '../index'

type Call = { method: string; url: string; body?: any; auth?: string }

/** A scripted fetch: each handler gets the call and returns [status, body]. */
function mockFetch(handlers: Array<(c: Call) => [number, unknown] | Promise<[number, unknown]>>) {
  const calls: Call[] = []
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const call: Call = {
      method: init.method ?? 'GET',
      url,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      auth: (init.headers as Record<string, string>).Authorization,
    }
    calls.push(call)
    const h = handlers.shift()
    if (!h) throw new Error(`unexpected request ${call.method} ${url}`)
    const [status, body] = await h(call)
    return new Response(body === undefined ? '' : JSON.stringify(body), { status })
  })
  vi.stubGlobal('fetch', fn)
  return calls
}

const box = (over: Record<string, unknown> = {}) => ({
  id: 42,
  name: 'b',
  status: 'running',
  provision_state: 'ready',
  vcpu: 8,
  ram_mb: 16384,
  disk_gb: 20,
  created_at: '2026-10-16T00:00:00Z',
  ...over,
})

beforeEach(() => {
  vi.useRealTimers()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('UnoClient', () => {
  it('requires an API key', () => {
    const saved = process.env.UNO_API_KEY
    delete process.env.UNO_API_KEY
    expect(() => new UnoClient({})).toThrow(/Missing Uno API key/)
    if (saved) process.env.UNO_API_KEY = saved
  })

  it('rejects a non-https base URL', () => {
    expect(() => new UnoClient({ apiKey: 'k', baseUrl: 'http://example.com' })).toThrow(/https/)
  })

  it('sends the bearer token and maps API errors', async () => {
    const calls = mockFetch([() => [409, { error: 'SHAPE_TOO_LARGE', message: 'plan max is 4 vCPU' }]])
    const c = new UnoClient({ apiKey: 'k', baseUrl: 'https://api.test' })
    const err = await c.createBox({ template: 't', vcpu: 8, ram_mb: 16384, disk_gb: 20 }).catch(e => e)
    expect(err).toBeInstanceOf(UnoError)
    expect(err.code).toBe('SHAPE_TOO_LARGE')
    expect(err.message).toMatch(/409 SHAPE_TOO_LARGE \(plan max is 4 vCPU\)/)
    expect(calls[0].auth).toBe('Bearer k')
  })

  it('returns null for a missing box and treats delete of a gone box as success', async () => {
    mockFetch([() => [404, { error: 'NOT_FOUND' }], () => [404, { error: 'NOT_FOUND' }]])
    const c = new UnoClient({ apiKey: 'k', baseUrl: 'https://api.test' })
    expect(await c.getBox(1)).toBeNull()
    await expect(c.deleteBox(1)).resolves.toBeUndefined()
  })

  it('long-polls a run that outlives one HTTP response, keeping one idempotency key', async () => {
    const calls = mockFetch([
      () => [202, { run_id: 'r1', status: 'running', box_id: 42 }],
      () => [200, { id: 'r1', status: 'running' }],
      () => [200, { id: 'r1', status: 'finished', exit_code: 3, stdout: 'out', stderr: 'err' }],
    ])
    const c = new UnoClient({ apiKey: 'k', baseUrl: 'https://api.test' })
    const run = await c.run(42, { cmd: 'sleep 100', timeout_s: 600 })
    expect(run).toMatchObject({ status: 'finished', exit_code: 3, stdout: 'out', stderr: 'err' })
    expect(calls[0].body).toMatchObject({ cmd: 'sleep 100', timeout_s: 600, wait_s: 50 })
    expect(calls[0].body.idempotency_key).toMatch(/[0-9a-f-]{36}/)
    expect(calls[1].url).toBe('https://api.test/api/v1/boxes/42/runs/r1?wait_s=50')
  })

  it('retries POST /run on BOX_BUSY and on a retry-safe 503 with the same key', async () => {
    const calls = mockFetch([
      () => [409, { error: 'BOX_BUSY' }],
      () => [503, { error: 'EXEC_CHANNEL_UNAVAILABLE', retry_safe: true, command_started: false }],
      () => [200, { run_id: 'r2', status: 'finished', exit_code: 0, stdout: 'ok' }],
    ])
    const c = new UnoClient({ apiKey: 'k', baseUrl: 'https://api.test' })
    const run = await c.run(42, { cmd: 'true', timeout_s: 10 })
    expect(run.exit_code).toBe(0)
    expect(new Set(calls.map(x => x.body.idempotency_key)).size).toBe(1)
  }, 15_000)

  it('does not repeat a command that may have started', async () => {
    mockFetch([() => [503, { error: 'EXEC_CHANNEL_UNAVAILABLE', retry_safe: false, command_started: true }]])
    const c = new UnoClient({ apiKey: 'k', baseUrl: 'https://api.test' })
    await expect(c.run(42, { cmd: 'rm x', timeout_s: 10 })).rejects.toMatchObject({ code: 'EXEC_CHANNEL_UNAVAILABLE' })
  })

  it('surfaces a run that ended in error', async () => {
    mockFetch([() => [200, { run_id: 'r3', status: 'error', error_code: 'EXEC_TIMEOUT', command_started: true }]])
    const c = new UnoClient({ apiKey: 'k', baseUrl: 'https://api.test' })
    await expect(c.run(42, { cmd: 'sleep 9', timeout_s: 1 })).rejects.toThrow(/EXEC_TIMEOUT/)
  })
})

describe('connection reuse', () => {
  it('sends back-to-back requests over one connection', async () => {
    const ports: number[] = []
    const server = createServer((req, res) => {
      ports.push(req.socket.remotePort!)
      req.resume()
      req.on('end', () => {
        res.writeHead(req.method === 'POST' ? 201 : 200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(box()))
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const c = new UnoClient({ apiKey: 'k', baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })
      await c.createBox({ template: 't', vcpu: 1, ram_mb: 512, disk_gb: 4 })
      await c.getBox(42)
      await c.getBox(42)
      await c.deleteBox(42)
      expect(ports).toHaveLength(4)
      expect(new Set(ports).size).toBe(1)
    } finally {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
  })
})

/**
 * A box that turns ready `readyAt` ms after the first poll (fake clock); each
 * GET takes `rttMs`. Returns the times the GETs were sent, relative to the first.
 */
function bootingBox(readyAt: number, rttMs: number) {
  const polls: number[] = []
  let t0: number | undefined
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      t0 ??= Date.now()
      const at = Date.now() - t0
      polls.push(at)
      await new Promise(resolve => setTimeout(resolve, rttMs))
      const body = at >= readyAt ? box() : box({ status: 'starting', provision_state: 'started' })
      return new Response(JSON.stringify(body), { status: 200 })
    }),
  )
  return polls
}

describe('readiness polling', () => {
  const steps = (from: number, to: number, step: number) =>
    Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step)
  /** Each poll lands in its slot; the timer tick `request()` yields first may put poll i up to i ms later. */
  const expectPolls = (polls: number[], slots: number[]) => {
    expect(polls).toHaveLength(slots.length)
    polls.forEach((at, i) => {
      expect(at).toBeGreaterThanOrEqual(slots[i])
      expect(at).toBeLessThanOrEqual(slots[i] + i)
    })
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  })

  it('polls every 100 ms from the start of each request, so the round trip does not add to it', async () => {
    const polls = bootingBox(1_250, 30)
    const ready = new UnoClient({ apiKey: 'k', baseUrl: 'https://api.test' }).waitReady(42, 120_000)
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(ready).resolves.toMatchObject({ status: 'running', provision_state: 'ready' })
    expectPolls(polls, steps(0, 1_300, 100))
  })

  it('sends the next poll at once when a round trip is longer than the interval', async () => {
    const polls = bootingBox(500, 150)
    const ready = new UnoClient({ apiKey: 'k', baseUrl: 'https://api.test' }).waitReady(42, 120_000)
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(ready).resolves.toMatchObject({ status: 'running' })
    expectPolls(polls, [0, 150, 300, 450, 600])
  })

  it('slows to once a second after the first 10 s', async () => {
    const polls = bootingBox(11_500, 30)
    const ready = new UnoClient({ apiKey: 'k', baseUrl: 'https://api.test' }).waitReady(42, 120_000)
    await vi.advanceTimersByTimeAsync(13_000)
    await expect(ready).resolves.toMatchObject({ status: 'running' })
    expectPolls(polls, [...steps(0, 10_000, 100), 11_000, 12_000])
  })

  it('gives up with READY_TIMEOUT when the box is not ready in time', async () => {
    const polls = bootingBox(Infinity, 30)
    const ready = new UnoClient({ apiKey: 'k', baseUrl: 'https://api.test' }).waitReady(42, 1_000).catch(e => e)
    await vi.advanceTimersByTimeAsync(2_000)
    const err = await ready
    expect(err).toBeInstanceOf(UnoError)
    expect(err).toMatchObject({ code: 'READY_TIMEOUT', status: 504 })
    expectPolls(polls, steps(0, 1_000, 100))
  })
})

describe('uno provider', () => {
  it('creates with the requested shape and region, waits until ready, runs, destroys', async () => {
    const calls = mockFetch([
      () => [201, box({ status: 'provisioning', provision_state: 'pending' })],
      () => [200, box({ status: 'starting', provision_state: 'started' })],
      () => [200, box()],
      () => [200, { run_id: 'r', status: 'finished', exit_code: 0, stdout: 'v24.0.0\n', stderr: '' }],
      () => [200, { status: 'deleted' }],
    ])
    const compute = uno({ apiKey: 'k', baseUrl: 'https://api.test', region: 'us' })
    const sandbox = await compute.sandbox.create({ vcpus: 8, memoryMiB: 16384 } as any)
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.test/api/v1/boxes?wait_ready_s=30',
      body: { template: 'ubuntu-24.04', vcpu: 8, ram_mb: 16384, disk_gb: 10, region: 'us' },
    })
    const r = await sandbox.runCommand('node -v', { cwd: '/tmp', env: { A: '1' } } as any)
    expect(r).toMatchObject({ stdout: 'v24.0.0\n', exitCode: 0 })
    expect(calls[3].body).toMatchObject({ cmd: 'cd "/tmp" && node -v', env: { A: '1' }, timeout_s: 300 })
    await sandbox.destroy()
    expect(calls[4]).toMatchObject({ method: 'DELETE', url: 'https://api.test/api/v1/boxes/42?purge=now' })
  })

  it('deletes the machine when it fails to start', async () => {
    const calls = mockFetch([
      () => [201, box({ status: 'provisioning', provision_state: 'pending' })],
      () => [200, box({ status: 'error', provision_state: 'failed', provision_error: 'no capacity' })],
      () => [200, { status: 'deleted' }],
    ])
    const compute = uno({ apiKey: 'k', baseUrl: 'https://api.test' })
    await expect(compute.sandbox.create()).rejects.toThrow(/no capacity/)
    expect(calls[2].method).toBe('DELETE')
  })

  it('rounds memory up to the 256 MiB step and rejects bad env names', async () => {
    const calls = mockFetch([() => [201, box()]])
    const compute = uno({ apiKey: 'k', baseUrl: 'https://api.test' })
    const sandbox = await compute.sandbox.create({ memory: 1000, cpus: 1 } as any)
    expect(calls[0].body).toMatchObject({ ram_mb: 1024, vcpu: 1 })
    await expect(sandbox.runCommand('true', { env: { 'x; rm': '1' } } as any)).rejects.toThrow(/Invalid environment/)
  })
})

describe('create waits on the server', () => {
  const ready = (waited_ms = 380) => box({ wait: { outcome: 'ready', ready: true, waited_ms } })

  it('takes one request when the server holds create until the machine is ready', async () => {
    const calls = mockFetch([
      () => [201, ready()],
      () => [200, { status: 'finished', exit_code: 0, stdout: 'ok', stderr: '' }],
    ])
    const sandbox = await uno({ apiKey: 'k', baseUrl: 'https://api.test' }).sandbox.create()
    expect(calls.map(c => `${c.method} ${c.url}`)).toEqual(['POST https://api.test/api/v1/boxes?wait_ready_s=30'])
    expect(calls[0].body.comment).toMatch(/^computesdk [0-9a-f-]{36}$/)
    expect((await sandbox.runCommand('true')).stdout).toBe('ok')
  })

  it('polls as before when the server answers create at once', async () => {
    // An older server ignores wait_ready_s; a wait the server cut short has no `ready`.
    for (const created of [box({ status: 'provisioning', provision_state: 'pending' }), box({ status: 'provisioning', provision_state: 'pending', wait: { outcome: 'timeout', ready: false, waited_ms: 0 } })]) {
      const calls = mockFetch([() => [201, created], () => [200, box()]])
      const sb = await uno({ apiKey: 'k', baseUrl: 'https://api.test' }).sandbox.create()
      expect(sb.sandboxId).toBe('42')
      expect(calls.map(c => c.method)).toEqual(['POST', 'GET'])
    }
  })

  it('deletes the machine when create says its start failed', async () => {
    const calls = mockFetch([
      () => [201, box({ status: 'error', provision_state: 'failed', provision_error: 'no capacity', wait: { outcome: 'failed', ready: false, waited_ms: 900 } })],
      () => [200, { status: 'deleted' }],
    ])
    const err = await uno({ apiKey: 'k', baseUrl: 'https://api.test' }).sandbox.create().catch(e => e)
    expect(err.message).toMatch(/no capacity/)
    expect(calls.map(c => `${c.method} ${c.url}`)).toEqual([
      'POST https://api.test/api/v1/boxes?wait_ready_s=30',
      'DELETE https://api.test/api/v1/boxes/42?purge=now',
    ])
  })

  it('asks for no longer than readyTimeoutMs and counts the server wait against it', async () => {
    const calls = mockFetch([
      () => [201, box({ status: 'provisioning', provision_state: 'pending', wait: { outcome: 'timeout', ready: false, waited_ms: 5_000 } })],
      () => [200, box({ status: 'starting', provision_state: 'started' })],
      () => [200, { status: 'deleted' }],
    ])
    const err = await uno({ apiKey: 'k', baseUrl: 'https://api.test', readyTimeoutMs: 5_000 }).sandbox.create().catch(e => e)
    expect(err).toMatchObject({ code: 'READY_TIMEOUT' })
    expect(err.message).toMatch(/after 5000 ms/)
    expect(calls.map(c => `${c.method} ${c.url}`)).toEqual([
      'POST https://api.test/api/v1/boxes?wait_ready_s=5',
      'GET https://api.test/api/v1/boxes/42',
      'DELETE https://api.test/api/v1/boxes/42?purge=now',
    ])
  })

  it('does not ask the server to wait under a second', async () => {
    const calls = mockFetch([() => [201, box()]])
    await uno({ apiKey: 'k', baseUrl: 'https://api.test', readyTimeoutMs: 500 }).sandbox.create()
    expect(calls[0].url).toBe('https://api.test/api/v1/boxes')
  })

  it('caps the wait at what the API holds a response for', async () => {
    const calls = mockFetch([() => [201, box()]])
    await new UnoClient({ apiKey: 'k', baseUrl: 'https://api.test' }).createBox({ template: 't', vcpu: 1, ram_mb: 512, disk_gb: 4 }, undefined, { waitReadyS: 600 })
    expect(calls[0].url).toBe('https://api.test/api/v1/boxes?wait_ready_s=30')
  })
})

describe('create when the response is lost', () => {
  it('adopts the machine the API created and does not leave it running unseen', async () => {
    const calls = mockFetch([
      () => [504, { error: 'GATEWAY_TIMEOUT' }],
      () => [200, { boxes: [box({ id: 7, name: calls[0].body.name, comment: 'computesdk someone-else', created_at: new Date().toISOString() }), box({ id: 9, name: calls[0].body.name, comment: calls[0].body.comment, created_at: new Date().toISOString(), status: 'provisioning', provision_state: 'pending' })] }],
      () => [200, box({ id: 9 })],
    ])
    const sb = await uno({ apiKey: 'k', baseUrl: 'https://api.test' }).sandbox.create({ vcpus: 2 } as any)
    expect(sb.sandboxId).toBe('9')
    expect(calls[0].body.name).toMatch(/^computesdk-[0-9a-f-]{12}$/)
    expect(calls.map(c => c.method)).toEqual(['POST', 'GET', 'GET'])
  })

  it('rethrows when nothing was created and on a non-transient error', async () => {
    mockFetch([() => [503, { error: 'X' }], () => [200, { boxes: [] }]])
    await expect(uno({ apiKey: 'k', baseUrl: 'https://api.test' }).sandbox.create({} as any)).rejects.toThrow(/503/)
    const calls = mockFetch([() => [402, { error: 'PAYMENT_REQUIRED' }]])
    await expect(uno({ apiKey: 'k', baseUrl: 'https://api.test' }).sandbox.create({} as any)).rejects.toThrow(/402/)
    expect(calls).toHaveLength(1)
  })

  it('never adopts another request\'s machine with the same name', async () => {
    const calls = mockFetch([
      () => [504, {}],
      () => [200, { boxes: [box({ id: 3, name: 'job', comment: 'computesdk 0000', created_at: new Date().toISOString() })] }],
    ])
    await expect(uno({ apiKey: 'k', baseUrl: 'https://api.test' }).sandbox.create({ name: 'job' } as any)).rejects.toThrow(/504/)
    expect(calls[0].body).toMatchObject({ name: 'job' })
    expect(calls[0].body.comment).toMatch(/^computesdk [0-9a-f-]{36}$/)
    expect(calls.map(c => c.method)).toEqual(['POST', 'GET'])
  })

  it('deletes the machine when the caller aborts after the API accepted it', async () => {
    const ac = new AbortController()
    let comment = ''
    const calls = mockFetch([
      c => {
        comment = c.body.comment
        ac.abort()
        throw new DOMException('aborted', 'AbortError')
      },
      () => [200, { boxes: [box({ id: 11, comment, created_at: new Date().toISOString() })] }],
      () => [200, { status: 'deleted' }],
    ])
    await expect(uno({ apiKey: 'k', baseUrl: 'https://api.test' }).sandbox.create({ signal: ac.signal } as any)).rejects.toThrow(/abort/i)
    // ComputeSDK rejects on abort right away; the cleanup finishes in the background.
    await vi.waitFor(() => expect(calls).toHaveLength(3))
    expect(calls.map(c => `${c.method} ${c.url}`)).toEqual([
      'POST https://api.test/api/v1/boxes?wait_ready_s=30',
      'GET https://api.test/api/v1/boxes',
      'DELETE https://api.test/api/v1/boxes/11?purge=now',
    ])
  })
})

describe('safety and status', () => {
  it('does not follow a redirect with the API key', async () => {
    const fn = vi.fn(async () => new Response('', { status: 302, headers: { Location: 'https://evil.test/' } }))
    vi.stubGlobal('fetch', fn)
    await expect(new UnoClient({ apiKey: 'k', baseUrl: 'https://api.test' }).listBoxes()).rejects.toThrow(/redirect/)
    expect(fn).toHaveBeenCalledTimes(1)
    expect((fn.mock.calls[0] as any)[1].redirect).toBe('manual')
  })

  it('reports a machine deleted elsewhere as stopped and gives no URL for it', async () => {
    mockFetch([() => [201, box({ url: 'https://b.uno4.dev' })], () => [404, { error: 'NOT_FOUND' }], () => [404, { error: 'NOT_FOUND' }]])
    const sandbox = await uno({ apiKey: 'k', baseUrl: 'https://api.test' }).sandbox.create()
    expect((await sandbox.getInfo()).status).toBe('stopped')
    await expect(sandbox.getUrl({ port: 80 })).rejects.toThrow(/not found/)
  })

  it('says when command output was cut at the API cap', async () => {
    mockFetch([() => [201, box()], () => [200, { status: 'finished', exit_code: 0, stdout: 'x', stderr: '', stdout_truncated: true }]])
    const sandbox = await uno({ apiKey: 'k', baseUrl: 'https://api.test' }).sandbox.create()
    expect((await sandbox.runCommand('yes | head -c 1000000')).stderr).toMatch(/stdout truncated/)
  })
})

/** A machine that answers the filesystem's shell commands from an in-memory file. */
function fsMachine(file: Buffer) {
  const written: Buffer[] = []
  const cmds: string[] = []
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    if ((init.method ?? 'GET') !== 'POST' || !url.endsWith('/run')) {
      return new Response(JSON.stringify(box()), { status: url.endsWith('/boxes') ? 201 : 200 })
    }
    const cmd: string = JSON.parse(String(init.body)).cmd
    cmds.push(cmd)
    let stdout = ''
    let m: RegExpMatchArray | null
    if (/stat -c %s/.test(cmd)) stdout = `${file.length}\n`
    else if ((m = cmd.match(/skip=(\d+) count=(\d+)/))) stdout = file.subarray(+m[1], +m[1] + +m[2]).toString('base64')
    else if ((m = cmd.match(/printf %s '([^']*)' \| base64 -d >>/))) written.push(Buffer.from(m[1], 'base64'))
    return new Response(JSON.stringify({ status: 'finished', exit_code: 0, stdout, stderr: '' }), { status: 200 })
  })
  vi.stubGlobal('fetch', fn)
  return { written, cmds }
}

describe('filesystem with large files', () => {
  it('reads a file bigger than the 256 KiB output cap in chunks', async () => {
    const file = Buffer.from('é'.repeat(200_000)) // 400 000 bytes, multi-byte characters across chunk edges
    const m = fsMachine(file)
    const sandbox = await uno({ apiKey: 'k', baseUrl: 'https://api.test' }).sandbox.create()
    expect(await sandbox.filesystem.readFile('/data/big.txt')).toBe(file.toString('utf8'))
    expect(m.cmds.filter(c => c.startsWith('dd ')).length).toBe(Math.ceil(file.length / (128 * 1024)))
  })

  it('writes a file bigger than the 64 KiB command limit in chunks, then renames it into place', async () => {
    const content = 'line of text\n'.repeat(20_000) // ~260 KB
    const m = fsMachine(Buffer.alloc(0))
    const sandbox = await uno({ apiKey: 'k', baseUrl: 'https://api.test' }).sandbox.create()
    await sandbox.filesystem.writeFile('/data/big.txt', content)
    expect(Buffer.concat(m.written).toString('utf8')).toBe(content)
    expect(m.cmds.every(c => Buffer.byteLength(c) < 64 * 1024)).toBe(true)
    expect(m.cmds.at(-1)).toMatch(/^mv -f ".*\.tmp" "\/data\/big\.txt"$/)
  })
})
