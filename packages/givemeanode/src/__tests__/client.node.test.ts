/**
 * The fast-token half of the provider, tested against a stub `fetch`.
 *
 * These run with `node --test` and no test framework, matching `web/`:
 * `client.ts` has no dependencies, so its tests should not acquire any.
 *
 * What is worth testing here is the credential migration, because every
 * way of getting it wrong is silent. Presenting a stale token costs a 401
 * and a retry; caching per instance costs the whole optimisation and
 * nothing looks broken; a shared cache keyed too loosely would send one
 * tenant's credential to another door.
 */

import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

import { GmnClient, GmnError, resetFastTokenCache } from '../client.ts'

const KEY = 'gmnt_test0000000000000000000000000000000'
const SIGNED = 'gmns_eyJhbGciOiJFZERTQSJ9.stub.stub'

interface Call {
  url: string
  method: string
  authorization: string
}

/**
 * A `fetch` that records what bearer it was handed and replies with
 * whatever headers the case wants.
 */
function stub(replies: Array<{ status?: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = []
  let next = 0
  const fetchImpl = (async (url: any, init: any) => {
    const reply = replies[Math.min(next, replies.length - 1)]
    next += 1
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      authorization: String(init?.headers?.authorization ?? ''),
    })
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json', ...(reply.headers ?? {}) },
    })
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

function vending(msFromNow: number): Record<string, string> {
  return {
    'gmn-fast-token': SIGNED,
    'gmn-fast-token-expires': new Date(Date.now() + msFromNow).toISOString(),
  }
}

describe('the signed credential the door hands back', () => {
  beforeEach(() => resetFastTokenCache())

  it('presents the minted credential until the door has vended one', async () => {
    const { calls, fetchImpl } = stub([{ body: { sandbox: 'sbx-1' } }])
    const client = new GmnClient({ apiKey: KEY, baseUrl: 'https://door.test', fetch: fetchImpl })
    assert.equal(client.hasFastToken(), false)
    await client.request('POST', '/preview/sandboxes', {})
    assert.equal(calls[0].authorization, `Bearer ${KEY}`)
  })

  it('carries the vended token onto the very next call, which is the exec leg', async () => {
    // THE CLAIM THIS PACKAGE EXISTS TO MAKE. A create-then-exec pays the
    // authentication read twice; the create's response carries the token,
    // so the exec that follows it pays nothing even on the first
    // iteration, with no extra round trip anywhere.
    const { calls, fetchImpl } = stub([
      { body: { sandbox: 'sbx-1' }, headers: vending(600_000) },
      { body: { results: [{ sandbox: 'sbx-1', exit_code: 0 }] } },
    ])
    const client = new GmnClient({ apiKey: KEY, baseUrl: 'https://door.test', fetch: fetchImpl })
    await client.request('POST', '/preview/sandboxes', {})
    await client.request('POST', '/preview/sandboxes/execs', {})
    assert.equal(calls[0].authorization, `Bearer ${KEY}`)
    assert.equal(calls[1].authorization, `Bearer ${SIGNED}`)
  })

  it('will not present a token whose life is inside the round trip', async () => {
    // A token with 1 s left expires while the request is in flight and
    // comes back 401. The margin exists so that costs nothing.
    const { calls, fetchImpl } = stub([
      { body: {}, headers: vending(1_000) },
      { body: {} },
    ])
    const client = new GmnClient({ apiKey: KEY, baseUrl: 'https://door.test', fetch: fetchImpl })
    await client.request('GET', '/preview/sandboxes')
    assert.equal(client.hasFastToken(), false)
    await client.request('GET', '/preview/sandboxes')
    assert.equal(calls[1].authorization, `Bearer ${KEY}`)
  })

  it('assumes a SHORT life when the door names no expiry, never a long one', async () => {
    // Asymmetric on purpose: guessing long hands out a dead token and
    // turns every later call into a 401, guessing short costs one re-mint.
    const { fetchImpl } = stub([{ body: {}, headers: { 'gmn-fast-token': SIGNED } }])
    const client = new GmnClient({ apiKey: KEY, baseUrl: 'https://door.test', fetch: fetchImpl })
    await client.request('GET', '/preview/sandboxes')
    assert.equal(client.hasFastToken(), true)
    assert.equal(client.hasFastToken(Date.now() + 19_000), false, 'must not outlive the fallback window')
  })

  it('ignores an unparseable expiry rather than treating it as epoch zero', async () => {
    const { fetchImpl } = stub([
      { body: {}, headers: { 'gmn-fast-token': SIGNED, 'gmn-fast-token-expires': 'not a date' } },
    ])
    const client = new GmnClient({ apiKey: KEY, baseUrl: 'https://door.test', fetch: fetchImpl })
    await client.request('GET', '/preview/sandboxes')
    assert.equal(client.hasFastToken(), true)
  })

  it('presents nothing signed when the caller turned it off', async () => {
    const { calls, fetchImpl } = stub([
      { body: {}, headers: vending(600_000) },
      { body: {} },
    ])
    const client = new GmnClient({
      apiKey: KEY,
      baseUrl: 'https://door.test',
      fastToken: 'off',
      fetch: fetchImpl,
    })
    await client.request('GET', '/preview/sandboxes')
    await client.request('GET', '/preview/sandboxes')
    assert.equal(calls[1].authorization, `Bearer ${KEY}`)
  })
})

describe('the cache key, which is what makes a per-task runner benefit', () => {
  beforeEach(() => resetFastTokenCache())

  it('shares a token between clients built from the same credential', async () => {
    // A benchmark runner and most job loops build a fresh provider per
    // task. A per-instance cache would re-pay the database read on every
    // one of them and the migration would never take effect.
    const first = stub([{ body: {}, headers: vending(600_000) }])
    await new GmnClient({ apiKey: KEY, baseUrl: 'https://door.test', fetch: first.fetchImpl }).request(
      'GET',
      '/preview/sandboxes',
    )
    const second = stub([{ body: {} }])
    await new GmnClient({ apiKey: KEY, baseUrl: 'https://door.test', fetch: second.fetchImpl }).request(
      'GET',
      '/preview/sandboxes',
    )
    assert.equal(second.calls[0].authorization, `Bearer ${SIGNED}`)
  })

  it('does not send one door a token minted by another', async () => {
    const first = stub([{ body: {}, headers: vending(600_000) }])
    await new GmnClient({ apiKey: KEY, baseUrl: 'https://door.test', fetch: first.fetchImpl }).request(
      'GET',
      '/preview/sandboxes',
    )
    const other = stub([{ body: {} }])
    await new GmnClient({ apiKey: KEY, baseUrl: 'https://other.test', fetch: other.fetchImpl }).request(
      'GET',
      '/preview/sandboxes',
    )
    assert.equal(other.calls[0].authorization, `Bearer ${KEY}`)
  })

  it('does not share a token between two credentials on one door', async () => {
    const first = stub([{ body: {}, headers: vending(600_000) }])
    await new GmnClient({ apiKey: KEY, baseUrl: 'https://door.test', fetch: first.fetchImpl }).request(
      'GET',
      '/preview/sandboxes',
    )
    const other = stub([{ body: {} }])
    await new GmnClient({ apiKey: 'gmnt_someone_else', baseUrl: 'https://door.test', fetch: other.fetchImpl }).request(
      'GET',
      '/preview/sandboxes',
    )
    assert.equal(other.calls[0].authorization, 'Bearer gmnt_someone_else')
  })
})

describe('priming, for the burst that starts N sandboxes at once', () => {
  beforeEach(() => resetFastTokenCache())

  it('costs ONE request no matter how many callers ask at once', async () => {
    // Without the single flight, a 100-wide burst primes 100 times and
    // measures the database it is trying to remove.
    const { calls, fetchImpl } = stub([{ body: {}, headers: vending(600_000) }])
    const client = new GmnClient({
      apiKey: KEY,
      baseUrl: 'https://door.test',
      fastToken: 'prime',
      fetch: fetchImpl,
    })
    await Promise.all(Array.from({ length: 100 }, () => client.prime()))
    assert.equal(calls.length, 1)
    assert.equal(client.hasFastToken(), true)
  })

  it('adds no round trip at all in the default mode', async () => {
    const { calls, fetchImpl } = stub([{ body: {} }])
    const client = new GmnClient({ apiKey: KEY, baseUrl: 'https://door.test', fetch: fetchImpl })
    await client.prime()
    assert.equal(calls.length, 0)
  })

  it('does not re-prime once a usable token is held', async () => {
    const { calls, fetchImpl } = stub([{ body: {}, headers: vending(600_000) }])
    const client = new GmnClient({
      apiKey: KEY,
      baseUrl: 'https://door.test',
      fastToken: 'prime',
      fetch: fetchImpl,
    })
    await client.prime()
    await client.prime()
    assert.equal(calls.length, 1)
  })

  it('lets the real request proceed when the prime itself fails', async () => {
    // A prime is an optimisation. A caller whose prime failed should still
    // make its request and find out why properly, rather than inheriting
    // an error from a call it never asked for.
    const { fetchImpl } = stub([{ status: 500, body: { error: 'door is unwell' } }])
    const client = new GmnClient({
      apiKey: KEY,
      baseUrl: 'https://door.test',
      fastToken: 'prime',
      fetch: fetchImpl,
    })
    await client.prime()
    assert.equal(client.hasFastToken(), false)
  })
})

describe('refusals', () => {
  beforeEach(() => resetFastTokenCache())

  it('carries the door status and its own explanation', async () => {
    const { fetchImpl } = stub([{ status: 429, body: { error: 'slow down' } }])
    const client = new GmnClient({ apiKey: KEY, baseUrl: 'https://door.test', fetch: fetchImpl })
    await assert.rejects(
      () => client.request('POST', '/preview/sandboxes', {}),
      (err: unknown) => {
        assert.ok(err instanceof GmnError)
        assert.equal(err.status, 429)
        assert.match(err.message, /slow down/)
        return true
      },
    )
  })

  it('names the environment variable when no credential was given', () => {
    const saved = process.env.GMN_TOKEN
    delete process.env.GMN_TOKEN
    try {
      assert.throws(() => new GmnClient({}), /GMN_TOKEN/)
    } finally {
      if (saved !== undefined) process.env.GMN_TOKEN = saved
    }
  })
})
