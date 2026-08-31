/**
 * Drive the provider's operations against the LIVE givemeanode API.
 *
 * Not a unit test and deliberately not in CI: it creates real sandboxes
 * and needs a real token. It exists because the unit tests prove the
 * package builds the requests it means to, and only this proves the service
 * agrees. Every wire shape this package reads was taken from a run of
 * this script rather than from a handler signature.
 *
 *   GMN_TOKEN=gmnt_... GMN_API_HOST=https://api.use1.givemeanode.com \
 *     node --experimental-strip-types scripts/smoke.ts
 *
 * The last two checks are the point of the package: that the service issues a
 * signed credential, and that the provider actually presents it.
 */

import assert from 'node:assert/strict'

import { GmnClient } from '../src/client.ts'
import * as ops from '../src/operations.ts'

const created: string[] = []
const snapshots: string[] = []
let client: GmnClient

async function step(name: string, fn: () => Promise<unknown>): Promise<void> {
  const t0 = performance.now()
  try {
    const detail = await fn()
    const ms = (performance.now() - t0).toFixed(0)
    console.log(`ok   ${name}  (${ms} ms)${detail === undefined ? '' : `  ${detail}`}`)
  } catch (err) {
    console.log(`FAIL ${name}: ${err instanceof Error ? err.message : String(err)}`)
    throw err
  }
}

async function main(): Promise<void> {
  client = new GmnClient({ fastToken: 'prime' })
  console.log(`endpoint ${client.baseUrl}\n`)

  assert.equal(client.hasFastToken(), false, 'nothing vended before the first call')

  let sandbox!: ops.SandboxHandle
  await step('create', async () => {
    sandbox = await ops.createSandbox(client, undefined, undefined, {})
    created.push(sandbox.id)
    return `${sandbox.id} pooled=${sandbox.metadata.pooled ?? false} forkMs=${sandbox.metadata.forkMs ?? '-'}`
  })

  await step('runCommand: node -v', async () => {
    const r = await ops.runCommand(sandbox, 'node -v')
    assert.equal(r.exitCode, 0)
    assert.match(r.stdout, /^v\d+\./)
    return r.stdout.trim()
  })

  await step('runCommand: cwd and env are carried', async () => {
    const r = await ops.runCommand(sandbox, 'pwd && echo "$GREETING"', { cwd: '/tmp', env: { GREETING: 'hello $USER' } })
    assert.equal(r.exitCode, 0)
    assert.equal(r.stdout.trim(), '/tmp\nhello $USER', 'the value must arrive unexpanded')
    return 'value not expanded'
  })

  await step('runCommand: a failing command is a result, not a throw', async () => {
    const r = await ops.runCommand(sandbox, 'exit 42')
    assert.equal(r.exitCode, 42)
    return 'exit 42'
  })

  await step('filesystem: write, read, exists, readdir, remove', async () => {
    const run = ops.runCommand
    // Every case a heredoc got wrong: no trailing newline (the one their
    // provider suite asserts), one that has a trailing newline, empty,
    // and content whose bytes would be shell metacharacters.
    const cases = [
      'no trailing newline',
      'line one\ncost is $100 and `date`\n',
      '',
      'na\u00efve \u65e5\u672c\u8a9e',
      "quote ' and double \" and backslash \\",
    ]
    for (const body of cases) {
      await ops.filesystem.writeFile(sandbox, '/tmp/gmn-smoke/a file.txt', body, run)
      const back = await ops.filesystem.readFile(sandbox, '/tmp/gmn-smoke/a file.txt', run)
      assert.equal(back, body, `content must round trip byte for byte: ${JSON.stringify(body)}`)
    }
    assert.equal(await ops.filesystem.exists(sandbox, '/tmp/gmn-smoke/a file.txt', run), true)
    const entries = await ops.filesystem.readdir(sandbox, '/tmp/gmn-smoke', run)
    assert.deepEqual(
      entries.map(e => e.name),
      ['a file.txt'],
      'a name with a space must survive the ls parse',
    )
    await ops.filesystem.remove(sandbox, '/tmp/gmn-smoke', run)
    assert.equal(await ops.filesystem.exists(sandbox, '/tmp/gmn-smoke', run), false)
    return `${cases.length} round trips exact`
  })

  await step('list and getById, in BOTH id forms', async () => {
    const found = await ops.getSandbox(client, sandbox.id)
    assert.ok(found, 'the sandbox we just made must be in the listing')
    assert.equal(await ops.getSandbox(client, 'sbx-000000000000'), null)
    // Whichever form this create returned, the OTHER one must find it too.
    // A pool-served sandbox comes back signed while the listing reports
    // the plain id, and matching those by string equality answers null -
    // which is what made getInfo call a live sandbox stopped.
    const plain = ops.plainSandboxId(sandbox.id)
    const alsoBy = plain ?? sandbox.id
    assert.ok(await ops.getSandbox(client, alsoBy), `must also find it by ${alsoBy}`)
    const form = plain ? 'signed, plain recovered' : 'plain'
    return `${(await ops.listSandboxes(client)).length} live, id ${form}`
  })

  await step('getInfo', async () => {
    const info = await ops.sandboxInfo(sandbox)
    assert.equal(info.status, 'running')
    assert.equal(info.provider, 'givemeanode')
    return info.status
  })

  let snapshotId!: string
  await step('snapshot', async () => {
    const snap = await ops.createSnapshot(client, sandbox.id)
    snapshotId = snap.id
    snapshots.push(snap.id)
    assert.match(snap.id, /^env-/)
    return `${snap.id} in ${snap.metadata?.createMs} ms`
  })

  await step('create from that snapshot forks it', async () => {
    const forked = await ops.createSandbox(client, undefined, undefined, { snapshotId })
    created.push(forked.id)
    assert.equal(forked.metadata.forkedFrom, snapshotId)
    const r = await ops.runCommand(forked, 'node -v')
    assert.equal(r.exitCode, 0, 'a forked sandbox must be immediately usable')
    return `${forked.id} ready in ${forked.metadata.allReadyMs} ms`
  })

  await step('listSnapshots includes it', async () => {
    const all = await ops.listSnapshots(client)
    assert.ok(all.some(s => s.id === snapshotId))
    return `${all.length} snapshots`
  })

  await step('THE POINT: the service issued a signed credential', async () => {
    assert.equal(client.hasFastToken(), true, 'one must have been issued by now')
    return 'held'
  })

  await step('THE POINT: the provider presents it, not the minted token', async () => {
    const bearer = client.bearer()
    assert.ok(bearer.startsWith('gmns_'), `expected a signed bearer, got ${bearer.slice(0, 6)}...`)
    assert.notEqual(bearer, client.apiKey)
    // And it has to still be accepted, which is the half an offline
    // test cannot reach: a credential the service will not verify would
    // fall back silently and look identical from here.
    const r = await ops.runCommand(sandbox, 'true')
    assert.equal(r.exitCode, 0)
    assert.ok(client.bearer().startsWith('gmns_'), 'still signed after the call')
    return `${bearer.slice(0, 12)}... accepted`
  })
}

async function cleanup(): Promise<void> {
  for (const id of created) {
    await ops.destroySandbox(client, id).catch(() => undefined)
  }
  for (const id of snapshots) {
    await ops.deleteSnapshot(client, id).catch(() => undefined)
  }
  console.log(`\ncleaned up ${created.length} sandboxes and ${snapshots.length} snapshots`)
  const left = await ops.listSandboxes(client).catch(() => [])
  console.log(`live sandboxes remaining in this workspace: ${left.length}`)
}

let failed = false
try {
  await main()
} catch {
  failed = true
} finally {
  await cleanup()
}
console.log(failed ? '\nSMOKE FAILED' : '\nSMOKE PASSED')
process.exit(failed ? 1 : 0)
