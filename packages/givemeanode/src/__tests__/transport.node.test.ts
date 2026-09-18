/**
 * The wire: one HTTP/2 session for a burst, `fetch` everywhere the session
 * cannot be, tested against a real `node:http2` server on loopback.
 *
 * Plaintext h2c (`transport: 'http2'` on an `http://127.0.0.1` base URL)
 * so no certificate is needed; the production path differs only in ALPN.
 * What matters here is the property the package now makes: N concurrent
 * requests open ONE connection, and everything the credential migration
 * relies on (headers absorbed, bearer presented, timeouts honoured) holds
 * on that wire exactly as it does over `fetch`.
 */
import assert from 'node:assert/strict'
import http2 from 'node:http2'
import { after, before, beforeEach, describe, it } from 'node:test'

import { GmnClient, resetFastTokenCache } from '../client.ts'

const KEY = 'gmnt_test0000000000000000000000000000000'
const SIGNED = 'gmns_eyJhbGciOiJFZERTQSJ9.stub.stub'

interface Seen {
  method: string
  path: string
  authorization: string
}

/** A loopback h2c door: records what it saw, answers what it is told. */
function door() {
  const seen: Seen[] = []
  let sessions = 0
  let delayMs = 0
  let vend = false
  const server = http2.createServer()
  server.on('session', () => {
    sessions += 1
  })
  server.on('stream', (stream, headers) => {
    seen.push({
      method: String(headers[':method']),
      path: String(headers[':path']),
      authorization: String(headers.authorization ?? ''),
    })
    const reply = () => {
      // A client that timed out has already reset the stream.
      if (stream.destroyed || stream.closed) return
      const extra: Record<string, string> = vend
        ? {
            'gmn-fast-token': SIGNED,
            'gmn-fast-token-expires': new Date(Date.now() + 600_000).toISOString(),
          }
        : {}
      stream.respond({ ':status': 200, 'content-type': 'application/json', ...extra })
      stream.end(JSON.stringify({ sandbox: `sbx-${seen.length}` }))
    }
    if (delayMs > 0) setTimeout(reply, delayMs)
    else reply()
  })
  return {
    seen,
    server,
    sessions: () => sessions,
    delay(ms: number) {
      delayMs = ms
    },
    vending(on: boolean) {
      vend = on
    },
    async listen(): Promise<string> {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      assert.ok(address && typeof address === 'object')
      return `http://127.0.0.1:${address.port}`
    },
    close(): Promise<void> {
      return new Promise(resolve => server.close(() => resolve()))
    },
  }
}

describe('one HTTP/2 session for a burst', () => {
  const d = door()
  let baseUrl = ''
  before(async () => {
    baseUrl = await d.listen()
  })
  after(() => d.close())
  beforeEach(() => {
    resetFastTokenCache()
    d.seen.length = 0
    d.delay(0)
    d.vending(false)
  })

  it('carries 100 concurrent requests over ONE connection', async () => {
    // THE CLAIM THIS CHANGE MAKES. Over fetch, 100 in-flight requests are
    // 100 TLS connections and 100 handshakes on one thread; here they are
    // 100 streams on one session, and the door sees one session open.
    const before = d.sessions()
    const client = new GmnClient({ apiKey: KEY, baseUrl, transport: 'http2', fastToken: 'off' })
    const replies = await Promise.all(
      Array.from({ length: 100 }, () => client.request<{ sandbox: string }>('POST', '/preview/sandboxes', {})),
    )
    assert.equal(replies.length, 100)
    assert.ok(replies.every(r => r.sandbox.startsWith('sbx-')))
    assert.equal(d.seen.length, 100)
    assert.equal(d.sessions() - before, 1, 'one session, not one per request')
    assert.ok(d.seen.every(s => s.authorization === `Bearer ${KEY}`))
  })

  it('absorbs the signed credential from HTTP/2 response headers and presents it next', async () => {
    d.vending(true)
    const client = new GmnClient({ apiKey: KEY, baseUrl, transport: 'http2', fastToken: 'absorb' })
    await client.request('POST', '/preview/sandboxes', {})
    assert.equal(client.hasFastToken(), true)
    await client.request('POST', '/preview/sandboxes/execs', {})
    assert.equal(d.seen[0].authorization, `Bearer ${KEY}`)
    assert.equal(d.seen[1].authorization, `Bearer ${SIGNED}`)
  })

  it('honours the timeout on a stream and leaves the session usable', async () => {
    const client = new GmnClient({ apiKey: KEY, baseUrl, transport: 'http2', fastToken: 'off', timeout: 50 })
    d.delay(500)
    await assert.rejects(client.request('GET', '/preview/sandboxes'), (err: Error) => err.name === 'AbortError')
    d.delay(0)
    const ok = await client.request<{ sandbox: string }>('GET', '/preview/sandboxes')
    assert.ok(ok.sandbox, 'the next request rides the same client')
  })

  it('honours a caller abort signal', async () => {
    const client = new GmnClient({ apiKey: KEY, baseUrl, transport: 'http2', fastToken: 'off' })
    d.delay(500)
    const controller = new AbortController()
    const pending = client.request('GET', '/preview/sandboxes', undefined, controller.signal)
    controller.abort()
    await assert.rejects(pending, (err: Error) => err.name === 'AbortError')
  })

  it('warm() opens the session before the first request, and swallows failure', async () => {
    const before = d.sessions()
    const client = new GmnClient({ apiKey: KEY, baseUrl, transport: 'http2', fastToken: 'off' })
    await client.warm()
    assert.equal(d.sessions() - before, 1, 'the session is open with nothing requested yet')
    assert.equal(d.seen.length, 0, 'fastToken off: warm makes no request')
    // A door that is not there: warm resolves, quietly.
    const dark = new GmnClient({ apiKey: KEY, baseUrl: 'http://127.0.0.1:9', transport: 'http2' })
    await dark.warm()
  })

  it('warm() with fastToken prime pays the prime on the session', async () => {
    d.vending(true)
    const client = new GmnClient({ apiKey: KEY, baseUrl, transport: 'http2' })
    await client.warm()
    assert.equal(d.seen.length, 1)
    assert.equal(d.seen[0].method, 'GET')
    assert.equal(client.hasFastToken(), true, 'the burst that follows presents the credential')
  })
})

describe('where the session cannot be, fetch is', () => {
  beforeEach(() => resetFastTokenCache())

  function stubFetch() {
    const calls: string[] = []
    const fetchImpl = (async (url: any) => {
      calls.push(String(url))
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch
    return { calls, fetchImpl }
  }

  it('an injected fetch selects the fetch wire', async () => {
    const { calls, fetchImpl } = stubFetch()
    const client = new GmnClient({ apiKey: KEY, baseUrl: 'https://door.test', fetch: fetchImpl })
    assert.equal(client.transport, 'fetch')
    await client.request('GET', '/preview/sandboxes')
    assert.equal(calls.length, 1)
  })

  it('auto stays on fetch for a plaintext loopback base URL', async () => {
    const { calls, fetchImpl } = stubFetch()
    const client = new GmnClient({
      apiKey: KEY,
      baseUrl: 'http://127.0.0.1:9',
      fetch: fetchImpl,
      transport: 'auto',
    })
    await client.request('GET', '/preview/sandboxes')
    assert.equal(calls.length, 1, 'no h2c attempt against a dev server that may not speak it')
  })

  it('a session that cannot be opened falls back to fetch, for good', async () => {
    const { calls, fetchImpl } = stubFetch()
    // Port 9 (discard) on loopback: nothing listens, the connect fails.
    const client = new GmnClient({
      apiKey: KEY,
      baseUrl: 'http://127.0.0.1:9',
      fetch: fetchImpl,
      transport: 'http2',
    })
    await client.request('GET', '/preview/sandboxes')
    await client.request('GET', '/preview/sandboxes')
    assert.equal(calls.length, 2, 'both requests were answered over fetch')
  })
})
