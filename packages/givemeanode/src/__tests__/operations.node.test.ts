/**
 * The provider's behaviour, against a stub `fetch`.
 *
 * `operations.ts` is where every request this package makes is built and
 * every response is read, and none of it needs `@computesdk/provider`, so
 * it is all exercised here. What `index.ts` adds on top is the mapping
 * onto ComputeSDK's interface and nothing else.
 */

import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

import { GmnClient, resetFastTokenCache } from '../client.ts'
import * as ops from '../operations.ts'

const REF = 'ghcr.io/acme/task@sha256:' + 'a'.repeat(64)

const KEY = 'gmnt_test0000000000000000000000000000000'

interface Recorded {
  method: string
  path: string
  body: any
}

function door(handler: (method: string, path: string, body: any) => { status?: number; body?: unknown }) {
  const sent: Recorded[] = []
  const fetchImpl = (async (url: any, init: any) => {
    const path = new URL(String(url)).pathname
    const body = init?.body ? JSON.parse(init.body) : undefined
    sent.push({ method: init?.method ?? 'GET', path, body })
    const reply = handler(init?.method ?? 'GET', path, body)
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  const client = new GmnClient({ apiKey: KEY, baseUrl: 'https://door.test', fetch: fetchImpl })
  return { sent, client }
}

describe('create', () => {
  beforeEach(() => resetFastTokenCache())

  it('asks for the default image when the caller names none', async () => {
    const { sent, client } = door(() => ({ body: { sandbox: 'sbx-1', pooled: true } }))
    const handle = await ops.createSandbox(client, undefined, undefined, {})
    assert.equal(handle.id, 'sbx-1')
    assert.equal(sent[0].path, '/preview/sandboxes')
    assert.equal(sent[0].body.image, 'sbx-base')
    assert.equal(handle.metadata.pooled, true)
  })

  it('omits ram_gib and egress entirely rather than sending nulls', async () => {
    // The door defaults both, and the base-cache keys on the size: a
    // create that sends an explicit default where the bake sent none
    // would miss the cache every time.
    const { sent, client } = door(() => ({ body: { sandbox: 'sbx-1' } }))
    await ops.createSandbox(client, undefined, undefined, {})
    assert.ok(!('ram_gib' in sent[0].body), 'ram_gib must be absent')
    assert.ok(!('egress' in sent[0].body), 'egress must be absent')
  })

  it('rounds a MiB request up to whole GiB', async () => {
    const { sent, client } = door(() => ({ body: { sandbox: 'sbx-1' } }))
    await ops.createSandbox(client, undefined, undefined, { memoryMiB: 3000 })
    assert.equal(sent[0].body.ram_gib, 3)
  })

  it('lets the provider config override the per-call size', async () => {
    const { sent, client } = door(() => ({ body: { sandbox: 'sbx-1' } }))
    await ops.createSandbox(client, 8, 'none', { memoryMiB: 3000 })
    assert.equal(sent[0].body.ram_gib, 8)
    assert.equal(sent[0].body.egress, 'none')
  })

  it('FORKS when asked to start from a snapshot, rather than creating', async () => {
    // A fork skips both the boot and the bake, and it is a different route
    // with a different response shape. Sending a snapshot id as `image`
    // would be a slow create of the wrong thing.
    const { sent, client } = door(() => ({ body: { sandboxes: ['sbx-9'], all_ready_ms: 32 } }))
    const handle = await ops.createSandbox(client, undefined, undefined, { snapshotId: 'env-abc' })
    assert.equal(sent[0].path, '/preview/sandboxes/forks')
    assert.deepEqual(sent[0].body, { from: 'env-abc', count: 1 })
    assert.equal(handle.id, 'sbx-9')
    assert.equal(handle.metadata.forkedFrom, 'env-abc')
  })

  it('treats a templateId that is not a snapshot as an image name', async () => {
    const { sent, client } = door(() => ({ body: { sandbox: 'sbx-1' } }))
    await ops.createSandbox(client, undefined, undefined, { templateId: 'sbx-min' })
    assert.equal(sent[0].path, '/preview/sandboxes')
    assert.equal(sent[0].body.image, 'sbx-min')
  })

  it('says so rather than returning undefined when a fork yields nothing', async () => {
    const { client } = door(() => ({ body: { sandboxes: [] } }))
    await assert.rejects(
      () => ops.createSandbox(client, undefined, undefined, { snapshotId: 'env-abc' }),
      /fork of env-abc returned no sandbox/,
    )
  })
})

describe('sandbox ids come back in two forms', () => {
  // Captured from production: a sandbox served from the ready pool. The
  // plain id is inside it, and the workspace listing reports only that.
  const SIGNED = 'sbx-AQGIdogpCnNieC0wMGIyMTEQc2J4LWFjZThkN2IwMDM3YdzoKiL7ZfZt0X4msA'
  const PLAIN = 'sbx-ace8d7b0037a'

  it('recovers the plain id from a real signed one', () => {
    assert.equal(ops.plainSandboxId(SIGNED), PLAIN)
  })

  it('leaves a plain id alone rather than decoding 12 hex as base64', () => {
    assert.equal(ops.plainSandboxId(PLAIN), null)
  })

  it('returns null for anything it cannot read, never a guess', () => {
    for (const bad of ['', 'sbx-', 'not-a-sandbox', 'sbx-!!!!', 'sbx-' + 'A'.repeat(8), 'env-abc']) {
      assert.equal(ops.plainSandboxId(bad), null, bad)
    }
  })

  it('matches the two forms against each other', () => {
    assert.equal(ops.sameSandbox(SIGNED, PLAIN), true)
    assert.equal(ops.sameSandbox(PLAIN, SIGNED), true)
    assert.equal(ops.sameSandbox(SIGNED, SIGNED), true)
    assert.equal(ops.sameSandbox(PLAIN, 'sbx-000000000000'), false)
  })

  it('FINDS a pool-served sandbox in the listing', async () => {
    // The listing reports the plain id, the caller holds the signed one.
    // String equality answers null here, and `getInfo` then calls a live
    // sandbox stopped.
    const { client } = door(() => ({ body: { items: [{ id: PLAIN }] } }))
    const found = await ops.getSandbox(client, SIGNED)
    assert.ok(found, 'must find it')
    assert.equal(found.id, SIGNED, 'and answer with the id the caller asked about')
  })

  it('reports a pool-served sandbox as RUNNING, not stopped', async () => {
    const { client } = door(() => ({ body: { items: [{ id: PLAIN }] } }))
    const info = await ops.sandboxInfo({
      id: SIGNED,
      client,
      createdAt: new Date(),
      metadata: {},
    })
    assert.equal(info.status, 'running')
  })
})

describe('container images', () => {
  beforeEach(() => {
    resetFastTokenCache()
    ops.resetPreparedImageCache()
  })

  it('classifies a digest-pinned reference as an image, a name as a name', () => {
    assert.equal(ops.isImageReference(REF), true)
    assert.equal(ops.isImageReference('sbx-base'), false)
    assert.equal(ops.isImageReference('ghcr.io/acme/task:latest'), false)
  })

  it('PREPARES the image and then starts from it, rather than sending it as a name', async () => {
    // `create` only accepts a curated name, so sending a reference there
    // would come back "unknown image". The image has to be prepared first
    // and the result started from.
    const { sent, client } = door((method, path) =>
      path === '/preview/sandboxes/envs'
        ? { body: { snapshot: 'env-prepared', bake_ms: 42_000 } }
        : { body: { sandboxes: ['sbx-1'], all_ready_ms: 30 } },
    )
    const handle = await ops.createSandbox(client, undefined, undefined, { image: REF })
    assert.deepEqual(sent.map(c => c.path), ['/preview/sandboxes/envs', '/preview/sandboxes/forks'])
    assert.equal(sent[0].body.from_image, REF)
    assert.equal(sent[1].body.from, 'env-prepared')
    assert.equal(handle.id, 'sbx-1')
    assert.equal(handle.metadata.fromImage, REF)
  })

  it('gives a side-effect template an EXPIRY, so it does not accumulate', async () => {
    // The caller asked for a sandbox, not for something to keep paying
    // stored bytes for.
    const { sent, client } = door((_m, path) =>
      path === '/preview/sandboxes/envs'
        ? { body: { snapshot: 'env-prepared' } }
        : { body: { sandboxes: ['sbx-1'] } },
    )
    await ops.createSandbox(client, undefined, undefined, { image: REF })
    assert.equal(sent[0].body.expires_after, ops.CREATE_IMAGE_EXPIRY)
  })

  it('prepares an image ONCE for N concurrent creates', async () => {
    // Without the single flight, Promise.all over 20 creates from a fresh
    // reference starts twenty conversions of the same bytes and bills for
    // all of them.
    let prepares = 0
    const { client } = door((_m, path) => {
      if (path === '/preview/sandboxes/envs') {
        prepares += 1
        return { body: { snapshot: 'env-prepared' } }
      }
      return { body: { sandboxes: ['sbx-n'] } }
    })
    await Promise.all(
      Array.from({ length: 20 }, () => ops.createSandbox(client, undefined, undefined, { image: REF })),
    )
    assert.equal(prepares, 1)
  })

  it('does not re-prepare once it holds one', async () => {
    let prepares = 0
    const { client } = door((_m, path) => {
      if (path === '/preview/sandboxes/envs') {
        prepares += 1
        return { body: { snapshot: 'env-prepared' } }
      }
      return { body: { sandboxes: ['sbx-n'] } }
    })
    await ops.createSandbox(client, undefined, undefined, { image: REF })
    await ops.createSandbox(client, undefined, undefined, { image: REF })
    assert.equal(prepares, 1)
  })

  it('treats a different SHAPE as a different prepared image', async () => {
    // Every sandbox started from a prepared image inherits its memory and
    // egress and cannot change them, so one prepared at 2 GiB cannot serve
    // a caller who asked for 8.
    let prepares = 0
    const { client } = door((_m, path) => {
      if (path === '/preview/sandboxes/envs') {
        prepares += 1
        return { body: { snapshot: `env-${prepares}` } }
      }
      return { body: { sandboxes: ['sbx-n'] } }
    })
    await ops.createSandbox(client, 2, undefined, { image: REF })
    await ops.createSandbox(client, 8, undefined, { image: REF })
    assert.equal(prepares, 2)
  })

  it('allows a longer wait for preparing than for an ordinary call', async () => {
    // A large image genuinely takes minutes. Aborting at the ordinary
    // timeout would throw away work already paid for.
    assert.ok(ops.PREPARE_IMAGE_TIMEOUT_MS > 300_000)
  })

  it('refuses a registry reference pinned by TAG, with the advice that helps', async () => {
    // Falling through to the curated-name path would answer "unknown
    // image, available: sbx-base; sbx-min; sbx-task" - true and useless.
    const { client } = door(() => ({ body: {} }))
    await assert.rejects(
      () => ops.createSandbox(client, undefined, undefined, { image: 'ghcr.io/acme/task:latest' }),
      /pinned by digest/,
    )
  })

  it('leaves a bare name:tag to the curated-name refusal', async () => {
    // `python:3.12` is genuinely ambiguous, and the catalog listing is the
    // better answer for it than a lecture about digests.
    const { sent, client } = door(() => ({ body: { sandbox: 'sbx-1' } }))
    await ops.createSandbox(client, undefined, undefined, { image: 'python:3.12' })
    assert.equal(sent[0].path, '/preview/sandboxes')
    assert.equal(sent[0].body.image, 'python:3.12')
  })

  it('says so when preparing yields no id', async () => {
    const { client } = door(() => ({ body: {} }))
    await assert.rejects(
      () => ops.prepareImage(client, REF, undefined, undefined),
      /prepared .* but returned no id/,
    )
  })

  it('does not cache a FAILED preparation', async () => {
    // A conversion that failed for a transient reason must be retryable;
    // caching the failure would make one bad minute permanent.
    let attempts = 0
    const { client } = door(() => {
      attempts += 1
      return attempts === 1
        ? { status: 503, body: { error: 'no host can convert right now' } }
        : { body: { snapshot: 'env-ok' } }
    })
    await assert.rejects(() => ops.prepareImage(client, REF, undefined, undefined))
    assert.equal(await ops.prepareImage(client, REF, undefined, undefined), 'env-ok')
    assert.equal(attempts, 2)
  })
})

describe('exec', () => {
  beforeEach(() => resetFastTokenCache())

  const handle = (client: GmnClient): ops.SandboxHandle => ({
    id: 'sbx-1',
    client,
    createdAt: new Date(),
    metadata: {},
  })

  it('sends the array shape and reads the first result', async () => {
    const { sent, client } = door(() => ({
      body: { results: [{ sandbox: 'sbx-1', exit_code: 0, stdout: 'v24.19.0\n', stderr: '', duration_ms: 7 }] },
    }))
    const r = await ops.runCommand(handle(client), 'node -v')
    assert.equal(sent[0].path, '/preview/sandboxes/execs')
    assert.equal(sent[0].body.execs[0].cmd, 'node -v')
    assert.equal(r.exitCode, 0)
    assert.equal(r.stdout, 'v24.19.0\n')
    assert.equal(r.durationMs, 7)
  })

  it('does NOT read a missing exit code as success', async () => {
    // The door reports a failed host RPC as `{sandbox, error}` with no
    // exit_code. Defaulting that to 0 turns a diagnosed failure into a
    // silent pass, which has already cost one benchmark run.
    const { client } = door(() => ({ body: { results: [{ sandbox: 'sbx-1', error: 'host went away' }] } }))
    await assert.rejects(() => ops.runCommand(handle(client), 'node -v'), /host went away/)
  })

  it('reports a non-zero exit as a result, not as a throw', async () => {
    // A command that ran and failed is data. Only a command that could not
    // be run is an exception.
    const { client } = door(() => ({
      body: { results: [{ sandbox: 'sbx-1', exit_code: 127, stderr: 'not found' }] },
    }))
    const r = await ops.runCommand(handle(client), 'nope')
    assert.equal(r.exitCode, 127)
    assert.equal(r.stderr, 'not found')
  })

  it('carries cwd and env into the one command string', async () => {
    const { sent, client } = door(() => ({ body: { results: [{ sandbox: 'sbx-1', exit_code: 0 }] } }))
    await ops.runCommand(handle(client), 'npm test', { cwd: '/srv/app', env: { CI: '1' } })
    assert.equal(sent[0].body.execs[0].cmd, 'cd "/srv/app" && export CI="1" && npm test')
  })

  it('retries ONCE when the door says the host did not answer', async () => {
    // The exec channel is a websocket lane the host reaps when idle, so
    // the first exec after a quiet stretch can find it gone. The door's
    // own message says to retry, and a retry re-dials. Their provider
    // suite caught this as an intermittent failure.
    let calls = 0
    const { client } = door(() => {
      calls += 1
      return calls === 1
        ? { body: { results: [{ sandbox: 'sbx-1', error: "the sandbox's host did not answer the exec call; retry" }] } }
        : { body: { results: [{ sandbox: 'sbx-1', exit_code: 0, stdout: 'ok' }] } }
    })
    const r = await ops.runCommand(handle(client), 'node -v')
    assert.equal(calls, 2)
    assert.equal(r.stdout, 'ok')
  })

  it('does NOT retry an error a retry cannot change', async () => {
    let calls = 0
    const { client } = door(() => {
      calls += 1
      return { body: { results: [{ sandbox: 'sbx-1', error: 'unknown sandbox in this workspace' }] } }
    })
    await assert.rejects(() => ops.runCommand(handle(client), 'node -v'), /unknown sandbox/)
    assert.equal(calls, 1)
  })

  it('gives up rather than looping when the reconnect keeps failing', async () => {
    let calls = 0
    const { client } = door(() => {
      calls += 1
      return { body: { results: [{ sandbox: 'sbx-1', error: 'the host did not answer the exec call' }] } }
    })
    await assert.rejects(() => ops.runCommand(handle(client), 'node -v'), /did not answer/)
    assert.equal(calls, 1 + ops.DEFAULT_EXEC_RETRIES)
  })

  it('can be told not to retry at all', async () => {
    let calls = 0
    const { client } = door(() => {
      calls += 1
      return { body: { results: [{ sandbox: 'sbx-1', error: 'the host did not answer the exec call' }] } }
    })
    await assert.rejects(() => ops.runCommand(handle(client), 'x', undefined, 0), /did not answer/)
    assert.equal(calls, 1)
  })

  it('passes the caller timeout as the door deadline', async () => {
    const { sent, client } = door(() => ({ body: { results: [{ sandbox: 'sbx-1', exit_code: 0 }] } }))
    await ops.runCommand(handle(client), 'sleep 1', { timeout: 5_000 })
    assert.equal(sent[0].body.execs[0].deadline_ms, 5_000)
  })
})

describe('composing a command', () => {
  it('refuses an environment name that is not an identifier', () => {
    // A name is not in a quotable position, so escaping cannot make it
    // safe. `x; rm -rf /` has to be refused, not quoted.
    assert.throws(
      () => ops.composeCommand('ls', { env: { 'x; rm -rf /': '1' } }),
      /Invalid environment variable name/,
    )
  })

  it('escapes a value that would otherwise expand', () => {
    const cmd = ops.composeCommand('run', { env: { TOKEN: '$(whoami)`id`' } })
    assert.equal(cmd, 'export TOKEN="\\$(whoami)\\`id\\`" && run')
    // Every `$` and backtick must be preceded by a backslash. Checking for
    // the absence of `$(whoami)` would NOT catch a regression: the escaped
    // form `\$(whoami)` contains it as a substring.
    for (const m of cmd.matchAll(/[$`]/g)) {
      assert.equal(cmd[m.index! - 1], '\\', `unescaped ${m[0]} at ${m.index}`)
    }
  })

  it('escapes all four shell metacharacters', () => {
    assert.equal(ops.escapeShellArg('a\\b"c$d`e'), 'a\\\\b\\"c\\$d\\`e')
  })

  it('leaves a plain command exactly alone', () => {
    assert.equal(ops.composeCommand('node -v'), 'node -v')
  })

  it('EXPORTS env, so it survives past the first && in the command', () => {
    // `A=1 pwd && echo "$A"` prints an empty line: the assignment form is
    // scoped to one simple command. Any caller passing `env` to a
    // pipeline would silently get empty values. Found by the live smoke,
    // because both forms build a plausible-looking string.
    const cmd = ops.composeCommand('pwd && echo "$GREETING"', { env: { GREETING: 'hi' } })
    assert.equal(cmd, 'export GREETING="hi" && pwd && echo "$GREETING"')
  })

  it('wraps the WHOLE composed command when backgrounding it', () => {
    const cmd = ops.composeCommand('a && b', { cwd: '/srv', background: true })
    assert.match(cmd, /^nohup sh -c "cd \\"\/srv\\" && a && b" >\/dev\/null 2>&1 &$/)
  })
})

describe('filesystem', () => {
  it('round trips content EXACTLY, trailing newline or not', () => {
    // A heredoc can only produce a file ending in a newline, so writing
    // "hello" and reading it back returned "hello\\n". Their provider
    // suite asserts the exact round trip and caught it.
    for (const content of ['hello', 'hello\n', '', 'a\nb', 'GMN_EOF_1f8b0a']) {
      const cmd = ops.writeFileCommand('/f', content)
      const encoded = /printf %s '([A-Za-z0-9+/=]*)'/.exec(cmd)
      assert.ok(encoded, `no base64 payload in: ${cmd}`)
      assert.equal(Buffer.from(encoded[1], 'base64').toString('utf8'), content)
    }
  })

  it('needs no escaping of the content, whatever is in it', () => {
    // The base64 alphabet is shell-inert, so a quote, a backtick, a `$`
    // or a newline in the content cannot reach the shell at all.
    const cmd = ops.writeFileCommand('/f', `'"$(rm -rf /)\`id\`\n`)
    const payload = /printf %s '([A-Za-z0-9+/=]*)'/.exec(cmd)
    assert.ok(payload)
    assert.ok(!cmd.includes('rm -rf'), 'content must not appear literally')
  })

  it('encodes multi-byte characters as their UTF-8 bytes', () => {
    const content = 'na\u00efve \u2013 \u65e5\u672c\u8a9e'
    const payload = /printf %s '([A-Za-z0-9+/=]*)'/.exec(ops.writeFileCommand('/f', content))!
    assert.equal(Buffer.from(payload[1], 'base64').toString('utf8'), content)
  })

  it('makes the parent directory, because cat cannot', () => {
    assert.match(ops.writeFileCommand('/a/b/c.txt', 'x'), /mkdir -p "\$\(dirname "\/a\/b\/c.txt"\)"/)
  })

  it('reads ls -la into entries, skipping the total line and the dots', () => {
    const out = [
      'total 12',
      'drwxr-xr-x 2 root root 4096 Aug 30 19:00 .',
      'drwxr-xr-x 3 root root 4096 Aug 30 18:00 ..',
      '-rw-r--r-- 1 root root  120 Aug 30 19:00 index.js',
      'drwxr-xr-x 2 root root 4096 Aug 30 19:00 src',
      '-rw-r--r-- 1 root root   12 Aug 30 19:00 a file.txt',
    ].join('\n')
    assert.deepEqual(ops.parseLsLong(out), [
      { name: 'index.js', type: 'file', size: 120 },
      { name: 'src', type: 'directory', size: 4096 },
      { name: 'a file.txt', type: 'file', size: 12 },
    ])
  })
})

describe('listing and teardown', () => {
  beforeEach(() => resetFastTokenCache())

  it('reads the workspace listing into handles', async () => {
    const { client } = door(() => ({
      body: { items: [{ id: 'sbx-1', created_at: '2026-08-30T19:38:19.818862+00:00', depth: 1 }] },
    }))
    const all = await ops.listSandboxes(client)
    assert.equal(all.length, 1)
    assert.equal(all[0].id, 'sbx-1')
    assert.equal(all[0].createdAt.toISOString(), '2026-08-30T19:38:19.818Z')
  })

  it('answers null for a sandbox this workspace does not have', async () => {
    const { client } = door(() => ({ body: { items: [{ id: 'sbx-1' }] } }))
    assert.equal(await ops.getSandbox(client, 'sbx-other'), null)
  })

  it('reports a sandbox missing from the listing as stopped', async () => {
    const { client } = door(() => ({ body: { items: [] } }))
    const info = await ops.sandboxInfo({ id: 'sbx-1', client, createdAt: new Date(), metadata: {} })
    assert.equal(info.status, 'stopped')
    assert.equal(info.provider, 'givemeanode')
  })

  it('destroys through the array route', async () => {
    const { sent, client } = door(() => ({ body: { deleted: 1 } }))
    await ops.destroySandbox(client, 'sbx-1')
    assert.equal(sent[0].method, 'POST')
    assert.equal(sent[0].path, '/preview/sandboxes/deletes')
    assert.deepEqual(sent[0].body, { sandboxes: ['sbx-1'] })
  })
})

describe('snapshots', () => {
  beforeEach(() => resetFastTokenCache())

  it('snapshots a sandbox by id', async () => {
    const { sent, client } = door(() => ({ body: { snapshot: 'env-1', create_ms: 756, parent: 'sbx-1' } }))
    const snap = await ops.createSnapshot(client, 'sbx-1')
    assert.equal(sent[0].path, '/preview/sandboxes/sbx-1/snapshot')
    assert.equal(snap.id, 'env-1')
    assert.equal(snap.provider, 'givemeanode')
  })

  it('swallows a delete of a snapshot that is already gone', async () => {
    // Idempotent: the state the caller asked for is the state they get.
    const { client } = door(() => ({ status: 404, body: { error: 'unknown snapshot' } }))
    await ops.deleteSnapshot(client, 'env-gone')
  })

  it('lists snapshots off the same workspace read', async () => {
    const { client } = door(() => ({
      body: { snapshots: [{ id: 'env-1', created_at: '2026-08-30T16:18:06.301077+00:00', ram_gib: 2, durable: true }] },
    }))
    const all = await ops.listSnapshots(client)
    assert.equal(all[0].id, 'env-1')
    assert.equal(all[0].metadata?.durable, true)
  })
})
