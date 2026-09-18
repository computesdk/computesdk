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
import { execFile } from 'node:child_process'
import http2 from 'node:http2'
import net from 'node:net'
import { after, before, beforeEach, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

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

  it('warm() opens the session before the first request, sends nothing, and swallows failure', async () => {
    const before = d.sessions()
    // Default fastToken (prime) and default warm (connect): the handshake
    // is paid, the credential is not presented until an operation asks.
    const client = new GmnClient({ apiKey: KEY, baseUrl, transport: 'http2' })
    await client.warm()
    assert.equal(d.sessions() - before, 1, 'the session is open with nothing requested yet')
    assert.equal(d.seen.length, 0, 'construction sent no request, so no credential')
    // A door that is not there: warm resolves, quietly.
    const dark = new GmnClient({ apiKey: KEY, baseUrl: 'http://127.0.0.1:9', transport: 'http2' })
    await dark.warm()
  })

  it("warm: 'prime' pays the prime on the session, warm: 'off' opens nothing", async () => {
    d.vending(true)
    const before = d.sessions()
    const primed = new GmnClient({ apiKey: KEY, baseUrl, transport: 'http2', warm: 'prime' })
    await primed.warm()
    assert.equal(d.seen.length, 1)
    assert.equal(d.seen[0].method, 'GET')
    assert.equal(primed.hasFastToken(), true, 'the burst that follows presents the credential')
    assert.equal(d.sessions() - before, 1)
    const cold = new GmnClient({ apiKey: KEY, baseUrl, transport: 'http2', warm: 'off' })
    await cold.warm()
    assert.equal(d.sessions() - before, 1, 'warm off: no session until a request')
  })

  it('close() lets the session go and the next request opens another', async () => {
    const before = d.sessions()
    const client = new GmnClient({ apiKey: KEY, baseUrl, transport: 'http2', fastToken: 'off' })
    await client.request('GET', '/preview/sandboxes')
    assert.equal(d.sessions() - before, 1)
    client.close()
    await client.request('GET', '/preview/sandboxes')
    assert.equal(d.sessions() - before, 2, 'a fresh session after close')
    // Closing while the session is still being opened closes it when it lands.
    const eager = new GmnClient({ apiKey: KEY, baseUrl, transport: 'http2', fastToken: 'off' })
    const opening = eager.warm()
    eager.close()
    await opening
    await eager.request('GET', '/preview/sandboxes')
    assert.equal(d.sessions() - before, 4, 'the closed-while-opening session and the one the request opened')
  })

  it('an idle session does not keep a process alive', async () => {
    // A script constructs the provider's client, makes one request and
    // returns from main. Over fetch that process exits; over a session
    // whose socket stayed referenced it would hang until the door closed
    // the connection, so the test is the exit itself, under a deadline.
    const clientPath = fileURLToPath(new URL('../client.ts', import.meta.url))
    const script = `
      import { GmnClient } from ${JSON.stringify(clientPath)}
      const client = new GmnClient({ apiKey: ${JSON.stringify(KEY)}, baseUrl: ${JSON.stringify(baseUrl)}, transport: 'http2', fastToken: 'off' })
      await client.warm()
      const reply = await client.request('GET', '/preview/sandboxes')
      console.log('done ' + reply.sandbox)
    `
    const flags = process.execArgv.filter(flag => flag.includes('strip-types'))
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(resolve => {
      execFile(
        process.execPath,
        [...flags, '--input-type=module', '-e', script],
        { timeout: 8_000 },
        (err, stdout, stderr) => resolve({ code: err ? (err as any).code ?? null : 0, stdout, stderr }),
      )
    })
    assert.equal(result.code, 0, `the process did not exit on its own: ${result.stderr}`)
    assert.match(result.stdout, /^done sbx-/m)
  })
})

describe('a connection that stalls', () => {
  /**
   * Accepts TCP and then says nothing. Under an `https:` base URL the
   * client's TLS handshake waits on a ServerHello that never comes, which
   * is a connection that never completes, not a request that stalls: the
   * session's `connect` never fires. (Plaintext h2c would not do: there
   * `connect` is the TCP connect, which this server does complete.)
   */
  const sockets = new Set<net.Socket>()
  const black = net.createServer(socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  let baseUrl = ''
  before(async () => {
    await new Promise<void>(resolve => black.listen(0, '127.0.0.1', resolve))
    const address = black.address()
    assert.ok(address && typeof address === 'object')
    baseUrl = `https://127.0.0.1:${address.port}`
  })
  after(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>(resolve => black.close(() => resolve()))
  })
  beforeEach(() => resetFastTokenCache())

  it('does not carry a request past its own deadline', async () => {
    const client = new GmnClient({ apiKey: KEY, baseUrl, transport: 'http2', fastToken: 'off', timeout: 100 })
    const started = Date.now()
    await assert.rejects(client.request('GET', '/preview/sandboxes'), (err: Error) => err.name === 'AbortError')
    assert.ok(Date.now() - started < 5_000, 'the request timeout applied while the session was still opening')
  })

  it('is given up on after connectTimeout, and fetch answers from then on', async () => {
    const calls: string[] = []
    const fetchImpl = (async (url: any) => {
      calls.push(String(url))
      return new Response(JSON.stringify({ sandbox: 'sbx-fetch' }), { status: 200 })
    }) as unknown as typeof fetch
    const client = new GmnClient({
      apiKey: KEY,
      baseUrl,
      transport: 'http2',
      fastToken: 'off',
      fetch: fetchImpl,
      connectTimeout: 50,
    })
    const reply = await client.request<{ sandbox: string }>('GET', '/preview/sandboxes')
    assert.equal(reply.sandbox, 'sbx-fetch')
    await client.request('GET', '/preview/sandboxes')
    assert.equal(calls.length, 2, 'no second connection attempt')
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
