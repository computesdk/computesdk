import { describe, expect, it, vi } from 'vitest'
import { compute } from 'computesdk'
import { givemeanode } from '../index'

// The real HTTP client, operations, provider factory and core wrappers run.
// Only HTTP is faked; no credentials, native API calls or resource allocation.
// Public delete_sandbox contract: `deleted` counts successful deletions;
// HTTP 200 alone does not confirm them (official OpenAPI and llms.txt).
const id = 'sbx-012345abcdef'
const secret = 'native-private-detail-do-not-forward'
const apiKey = 'gmnt_unit_only'
const failure = 'givemeanode sandbox deletion was not confirmed.'
type Call = { method: string; path: string; body?: unknown }

function fixture(deleteResult: unknown = { deleted: 1 }, status = 200) {
  const calls: Call[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    const call = { method: init?.method ?? 'GET', path: url.pathname, ...(body ? { body } : {}) }
    calls.push(call)
    if (call.path === '/preview/sandboxes/deletes') {
      return new Response(JSON.stringify(deleteResult), { status })
    }
    if (call.path === '/preview/sandboxes/execs') {
      return new Response(JSON.stringify({
        results: [{ sandbox: id, stdout: '', stderr: 'missing pointer', exit_code: 1 }],
      }))
    }
    if (call.method === 'GET') {
      return new Response(JSON.stringify({ items: [{ id }] }))
    }
    return new Response(JSON.stringify({ sandbox: id }))
  })
  const provider = givemeanode({ apiKey, fetch, warm: 'off', fastToken: 'off' })
  return { provider, fetch, calls }
}

async function rejectsSafely(operation: Promise<unknown>, message = failure) {
  const error = await operation.catch(error => error)
  expect(error).toBeInstanceOf(Error)
  if (!(error instanceof Error)) throw new Error('Expected a deletion failure.')
  expect(error.message).toBe(message)
  expect(Object.keys(error)).toEqual([])
  for (const key of ['cause', 'body', 'config', 'response', 'request']) {
    expect(error).not.toHaveProperty(key)
  }
  expect(JSON.stringify(error)).not.toContain(secret)
  expect(error.message).not.toContain(id)
  expect(error.message).not.toContain(apiKey)
}

describe('givemeanode provider lifecycle HTTP contract', () => {
  it('preserves a positive created-ID roundtrip through the real factory and core wrappers', async () => {
    const { provider, calls } = fixture()
    const core = compute({ provider })
    const created = await core.instances.create()
    expect(created.instanceId).toBe(id)
    expect(created.sandboxId).toBe(id)
    const found = await core.instances.getById(id)
    expect(found?.instanceId).toBe(id)
    // The factory reattaches egress state after a positive lookup: that
    // filesystem read is an exec, not a side-effect-free metadata query.
    expect(calls.map(call => [call.method, call.path])).toEqual([
      ['POST', '/preview/sandboxes'],
      ['GET', '/preview/sandboxes'],
      ['POST', '/preview/sandboxes/execs'],
    ])
    await created.destroy()
    expect(calls[calls.length - 1]).toEqual({
      method: 'POST', path: '/preview/sandboxes/deletes', body: { sandboxes: [id] },
    })
  })

  it('retains the actual native handle through the provider SandboxInterface', async () => {
    const { provider } = fixture()
    const created = await provider.instances.create()
    expect(created.getInstance()).toMatchObject({ id })
    await created.destroy()
  })

  it.each([
    { deleted: 0 }, { deleted: false }, { deleted: true }, { deleted: '1' },
    { deleted: 2 }, { deleted: -1 }, {}, null, [], { error: secret },
  ])('rejects an unconfirmed native delete response %# without an absence lookup', async result => {
    const { provider, calls } = fixture(result)
    await rejectsSafely(provider.instances.destroy(id))
    expect(calls).toEqual([{
      method: 'POST', path: '/preview/sandboxes/deletes', body: { sandboxes: [id] },
    }])
  })

  it('does not let a sandbox handle or core manager swallow a refused deletion', async () => {
    const { provider } = fixture({ deleted: 0 })
    const core = compute({ provider })
    const sandbox = await core.instances.create()
    await rejectsSafely(sandbox.destroy())
    const error = await core.instances.destroy(id).catch(error => error)
    // Core deliberately adds the caller's ID and provider label. It must
    // retain the failure, but cannot resurrect private native error details.
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain(failure)
    expect(error.message).not.toContain(secret)
    expect(error).not.toHaveProperty('cause')
  })

  it.each([401, 403, 404, 429, 500, 503])('sanitizes HTTP %i, including ambiguous 404', async status => {
    const { provider, calls } = fixture({ error: { message: secret } }, status)
    await rejectsSafely(provider.instances.destroy(id))
    expect(calls).toHaveLength(1)
  })

  it('sanitizes native transport failures without forwarding causes', async () => {
    const { provider, fetch } = fixture()
    fetch.mockRejectedValueOnce(Object.assign(new Error(secret), { cause: { token: apiKey } }))
    await rejectsSafely(provider.instances.destroy(id))
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each(['', undefined, null, 7])(
    'rejects empty or nonstring IDs before any delete request %#', async unsafe => {
      const { provider, calls } = fixture()
      await rejectsSafely(provider.instances.destroy(unsafe as string), 'Invalid givemeanode sandbox ID.')
      expect(calls).toEqual([])
    },
  )

  it.each([
    'sbx-AQAB_example-opaque', 'arbitrary:opaque/id?query#fragment%2f',
    'signed.with.dots', '☃-opaque-节点', ' exact whitespace ', ' ',
  ])('passes opaque ID %# back as exact JSON data, never a URL or decoded alias', async opaque => {
    const { provider, calls } = fixture()
    await provider.instances.destroy(opaque)
    expect(calls).toEqual([{
      method: 'POST', path: '/preview/sandboxes/deletes', body: { sandboxes: [opaque] },
    }])
  })

  it('preserves credential validation and never attempts unauthenticated deletion', async () => {
    vi.stubEnv('GMN_TOKEN', '')
    try {
      const fetch = vi.fn()
      const provider = givemeanode({ fetch, warm: 'off' })
      await rejectsSafely(provider.instances.destroy(id))
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
