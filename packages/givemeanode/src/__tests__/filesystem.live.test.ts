import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { givemeanode } from '../index'
import { GmnClient } from '../client'
import { createSandbox, escapeShellArg, READ_CHUNK_BYTES, sameSandbox } from '../operations'

interface Stats {
  items?: Array<{ id: string }>
  snapshots?: Array<{ id: string }>
}

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const log = (event: string, detail: Record<string, unknown>) => console.log(JSON.stringify({ event, ...detail }))

describe('focused live bounded filesystem transport', () => {
  it.skipIf(!process.env.GMN_TOKEN)('round trips a 16 MiB payload above the native exec cap and cleans its exact resources', async () => {
    const client = new GmnClient({ apiKey: process.env.GMN_TOKEN, baseUrl: process.env.GMN_API_HOST })
    const before = await client.request<Stats>('GET', '/preview/sandboxes')
    const knownSnapshots = new Set(before.snapshots?.map(snapshot => snapshot.id))
    let id: string | undefined
    let ownedSnapshot: string | undefined
    try {
      const native = await createSandbox(client, undefined, undefined, {}, 0)
      id = native.id
      const snapshot = native.metadata.snapshot
      if (typeof snapshot === 'string' && !knownSnapshots.has(snapshot) && !native.metadata.reusedSnapshot) {
        ownedSnapshot = snapshot
      }
      log('created-before-operations', { sandboxId: id, snapshotId: snapshot ?? null, ownedSnapshot: ownedSnapshot ?? null, metadata: native.metadata })
      const provider = givemeanode({ apiKey: process.env.GMN_TOKEN, __client: client, execRetries: 0 })
      const sandbox = await provider.sandbox.getById(id)
      expect(sandbox).not.toBeNull()
      if (!sandbox) throw new Error('New native sandbox was not found through ComputeSDK')
      const present = await client.request<Stats>('GET', '/preview/sandboxes')
      expect(present.items?.some(item => sameSandbox(item.id, id!))).toBe(true)
      log('native-status-before', { sandboxId: id, present: true })

      const path = '/tmp/gmn-bounded " $HOME `id` \' file.b64'
      const quoted = `"${escapeShellArg(path)}"`
      const head = '\ufeff' + 'a'.repeat(READ_CHUNK_BYTES - 4) + '🌍日本語\0\r\n'
      const text = head + 'x'.repeat(16 * 1024 * 1024 - Buffer.byteLength(head) - 5) + '\nend\n'
      const payload = Buffer.from(text).toString('base64')
      await sandbox.filesystem.writeFile(path, payload)
      log('sdk-write', { sandboxId: id, payloadBytes: Buffer.byteLength(payload), decodedBytes: Buffer.byteLength(text), sha256: hash(payload) })

      const nativeRead = await client.request<{ results: Array<{ stdout?: string; exit_code?: number; truncated?: boolean }> }>(
        'POST', '/preview/sandboxes/execs', { execs: [{ sandbox: id, cmd: `cat ${quoted}` }] },
      )
      const raw = nativeRead.results[0]
      log('native-whole-cat', { sandboxId: id, exitCode: raw.exit_code, truncated: raw.truncated, stdoutBytes: Buffer.byteLength(raw.stdout ?? '') })
      expect(raw.exit_code).toBe(0)
      expect(raw.truncated).toBe(true)
      expect(Buffer.byteLength(raw.stdout ?? '')).toBe(1024 * 1024)

      const checksum = await sandbox.runCommand(`sha256sum ${quoted}`)
      expect(checksum.exitCode).toBe(0)
      const nativeHash = checksum.stdout.match(/[a-f0-9]{64}/)?.[0]
      expect(nativeHash).toBe(hash(payload))
      const back = await sandbox.filesystem.readFile(path)
      expect(back).toBe(payload)
      expect(Buffer.from(back, 'base64').toString('utf8')).toBe(text)
      log('sdk-benchmark-shaped-read', { sandboxId: id, bytes: Buffer.byteLength(back), sha256: hash(back), nativeSha256: nativeHash, exact: true })

      const decodedPath = '/tmp/gmn-bounded-utf8'
      const decode = await sandbox.runCommand(`base64 -d ${quoted} > "${decodedPath}" && ln -s "${decodedPath}" "${decodedPath}-link"`)
      expect(decode.exitCode).toBe(0)
      const utf8 = await sandbox.filesystem.readFile(`${decodedPath}-link`)
      expect(utf8).toBe(text)
      log('sdk-split-utf8-read', { sandboxId: id, bytes: Buffer.byteLength(utf8), sha256: hash(utf8), exact: true, symlink: true })
      for (const small of ['', 'hello', 'hello\n', '\ufeffnaïve 日本語\0\r\n\n']) {
        await sandbox.filesystem.writeFile('/tmp/gmn-small', small)
        expect(await sandbox.filesystem.readFile('/tmp/gmn-small')).toBe(small)
      }
      for (const badPath of ['/tmp/gmn-definitely-missing', '/tmp']) {
        const nativeError = await sandbox.runCommand(`cat "${badPath}"`)
        expect(nativeError.exitCode).not.toBe(0)
        await expect(sandbox.filesystem.readFile(badPath)).rejects.toThrow()
        log('native-sdk-read-errors', { sandboxId: id, path: badPath, nativeExitCode: nativeError.exitCode, sdkRejected: true })
      }
    } finally {
      try {
        if (id) {
          log('cleanup-before-delete', { sandboxId: id, snapshotId: ownedSnapshot ?? null })
          const deletion = await client.request('POST', '/preview/sandboxes/deletes', { sandboxes: [id] })
          log('native-delete', { sandboxId: id, response: deletion })
          if (ownedSnapshot) await client.request('DELETE', `/preview/sandboxes/snapshots/${encodeURIComponent(ownedSnapshot)}`)
          const after = await client.request<Stats>('GET', '/preview/sandboxes')
          const sandboxPresent = after.items?.some(item => sameSandbox(item.id, id!)) ?? false
          const snapshotPresent = ownedSnapshot ? after.snapshots?.some(snapshot => snapshot.id === ownedSnapshot) ?? false : false
          log('native-status-after', { sandboxId: id, present: sandboxPresent, ownedSnapshot: ownedSnapshot ?? null, snapshotPresent })
          expect(sandboxPresent).toBe(false)
          expect(snapshotPresent).toBe(false)
        }
      } finally {
        client.close()
      }
    }
  }, 300_000)

  it('has credentials when live integration is required', () => {
    if (process.env.COMPUTESDK_REQUIRE_INTEGRATION === '1') expect(process.env.GMN_TOKEN).toBeTruthy()
  })
})
