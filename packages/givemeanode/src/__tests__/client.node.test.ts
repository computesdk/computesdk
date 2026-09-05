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

  it('reads the message out of the structured body the door actually sends', async () => {
    // The door answers `{"error": {"code", "message"}}`, not a bare
    // string. Stringifying that object yields `[object Object]` and loses
    // the one part written to be read - which is how a 422 naming
    // `sandbox_vcpus` reached a benchmark runner as no reason at all.
    const { fetchImpl } = stub([
      {
        status: 422,
        body: {
          error: {
            code: 'refused',
            message: 'size sandbox-lg needs 8 vCPU; this org\'s sandbox_vcpus ceiling is 4',
          },
        },
      },
    ])
    const client = new GmnClient({ apiKey: KEY, baseUrl: 'https://door.test', fetch: fetchImpl })
    await assert.rejects(
      () => client.request('POST', '/preview/sandboxes', { size: 'sandbox-lg' }),
      (err: unknown) => {
        assert.ok(err instanceof GmnError)
        assert.equal(err.status, 422)
        assert.match(err.message, /sandbox_vcpus ceiling is 4/)
        assert.match(err.message, /refused/)
        assert.doesNotMatch(err.message, /\[object Object\]/)
        return true
      },
    )
  })

  it('falls back to the code when the body carries no message', async () => {
    const { fetchImpl } = stub([{ status: 403, body: { error: { code: 'forbidden' } } }])
    const client = new GmnClient({ apiKey: KEY, baseUrl: 'https://door.test', fetch: fetchImpl })
    await assert.rejects(
      () => client.request('GET', '/preview/sandboxes'),
      (err: unknown) => {
        assert.ok(err instanceof GmnError)
        assert.match(err.message, /forbidden/)
        assert.doesNotMatch(err.message, /\[object Object\]/)
        return true
      },
    )
  })

  it('shows an unrecognised error body as JSON rather than as [object Object]', async () => {
    const { fetchImpl } = stub([{ status: 500, body: { error: { unexpected: 'shape' } } }])
    const client = new GmnClient({ apiKey: KEY, baseUrl: 'https://door.test', fetch: fetchImpl })
    await assert.rejects(
      () => client.request('GET', '/preview/sandboxes'),
      (err: unknown) => {
        assert.ok(err instanceof GmnError)
        assert.match(err.message, /unexpected/)
        assert.doesNotMatch(err.message, /\[object Object\]/)
        return true
      },
    )
  })

  it('keeps the whole body on the error for a caller that wants to branch on it', async () => {
    const { fetchImpl } = stub([{ status: 422, body: { error: { code: 'refused', message: 'no' } } }])
    const client = new GmnClient({ apiKey: KEY, baseUrl: 'https://door.test', fetch: fetchImpl })
    await assert.rejects(
      () => client.request('POST', '/preview/sandboxes', {}),
      (err: unknown) => {
        assert.ok(err instanceof GmnError)
        assert.deepEqual(err.body, { error: { code: 'refused', message: 'no' } })
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

describe('a signed credential that is refused before its cached expiry', () => {
  beforeEach(() => {
    resetFastTokenCache()
  })

  it('drops it and retries with the service token rather than failing every request', async () => {
    // First request pays the ordinary cost and absorbs a credential good
    // for an hour. The door then refuses it anyway - revoked, or its clock
    // disagrees with ours - and without the fallback every later request
    // fails until the entry ages out on its own.
    const { calls, fetchImpl } = stub([
      { body: { ok: true }, headers: vending(3_600_000) },
      { status: 401, body: { error: 'signed credential rejected' } },
      { body: { ok: true }, headers: vending(3_600_000) },
    ])
    const client = new GmnClient({ apiKey: KEY, fetch: fetchImpl })

    await client.request('GET', '/preview/sandboxes')
    assert.equal(client.hasFastToken(), true)

    const result = await client.request<{ ok: boolean }>('POST', '/preview/sandboxes', { image: 'sbx-base' })
    assert.deepEqual(result, { ok: true })

    assert.equal(calls.length, 3)
    assert.equal(calls[1].authorization, `Bearer ${SIGNED}`, 'the refused attempt presented the signed credential')
    assert.equal(calls[2].authorization, `Bearer ${KEY}`, 'the retry fell back to the service token')
    assert.equal(calls[2].method, 'POST', 'and it retried the original call, not a probe')
  })

  it('does not retry a 401 that the service token itself earned', async () => {
    // Nothing to fall back TO, so a second attempt would only double the
    // latency of every genuinely bad token.
    const { calls, fetchImpl } = stub([{ status: 401, body: { error: 'bad token' } }])
    const client = new GmnClient({ apiKey: KEY, fetch: fetchImpl })
    await assert.rejects(() => client.request('GET', '/preview/sandboxes'), GmnError)
    assert.equal(calls.length, 1)
  })
})

describe('the request deadline', () => {
  beforeEach(() => {
    resetFastTokenCache()
  })

  it('covers the body, not just the headers', async () => {
    // Headers arrive promptly and the body then never completes. Clearing
    // the timer when the fetch resolves leaves this hanging forever, which
    // is the one failure mode a sandbox API must not have: no caller above
    // can recover from it.
    const fetchImpl = (async (_url: any, init: any) => {
      const signal: AbortSignal = init.signal
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"partial":'))
          signal.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true })
        },
      })
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch

    const client = new GmnClient({ apiKey: KEY, fetch: fetchImpl, timeout: 120 })
    await assert.rejects(() => client.request('GET', '/preview/sandboxes'))
  })
})

describe('the endpoint a bearer token is allowed to travel to', () => {
  it('refuses plaintext, because every request carries a credential', () => {
    assert.throws(
      () => new GmnClient({ apiKey: KEY, baseUrl: 'http://api.example.com' }),
      /must use https/,
    )
  })

  it('allows loopback, which is how a local API is developed against', () => {
    const client = new GmnClient({ apiKey: KEY, baseUrl: 'http://localhost:8080' })
    assert.equal(client.baseUrl, 'http://localhost:8080')
  })

  it('allows https', () => {
    const client = new GmnClient({ apiKey: KEY, baseUrl: 'https://api.example.com' })
    assert.equal(client.baseUrl, 'https://api.example.com')
  })
})
