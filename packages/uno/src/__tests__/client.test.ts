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
      url: 'https://api.test/api/v1/boxes',
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
    const calls = mockFetch([() => [201, box()], () => [200, box()]])
    const compute = uno({ apiKey: 'k', baseUrl: 'https://api.test' })
    const sandbox = await compute.sandbox.create({ memory: 1000, cpus: 1 } as any)
    expect(calls[0].body).toMatchObject({ ram_mb: 1024, vcpu: 1 })
    await expect(sandbox.runCommand('true', { env: { 'x; rm': '1' } } as any)).rejects.toThrow(/Invalid environment/)
  })
})

describe('create when the response is lost', () => {
  it('adopts the machine the API created and does not leave it running unseen', async () => {
    const calls = mockFetch([
      () => [504, { error: 'GATEWAY_TIMEOUT' }],
      c => [200, { boxes: [box({ id: 7, name: 'other', created_at: new Date().toISOString() }), box({ id: 9, name: calls[0].body.name, created_at: new Date().toISOString(), status: 'provisioning', provision_state: 'pending' })] }],
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

  it('ignores an older machine with the same name', async () => {
    mockFetch([() => [504, {}], () => [200, { boxes: [box({ id: 3, name: 'job', created_at: '2020-01-01T00:00:00Z' })] }]])
    await expect(uno({ apiKey: 'k', baseUrl: 'https://api.test' }).sandbox.create({ name: 'job' } as any)).rejects.toThrow(/504/)
  })
})
