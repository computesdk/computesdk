import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile, chmod, link, symlink, lstat } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { cloudRun } from '../index'

const exec = promisify(execFile)
const MiB = 1024 * 1024
const digest = (content: string | Buffer) => createHash('sha256').update(content).digest('hex')

async function fixture(options: { failPart?: boolean; failCommit?: boolean; failInit?: boolean; plainError?: boolean; directoryAtCommit?: boolean; missingPart?: boolean; dropSetup?: boolean; dropPart?: boolean; dropCommit?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'gcp-upload-'))
  const cwd = join(directory, 'cwd "漢')
  await mkdir(cwd)
  const requests: Array<{ route: string; bytes: number; cookie?: string; body: Record<string, unknown> }> = []
  let activeParts = 0
  let activeHandlers = 0
  let drained: (() => void) | undefined
  let cleanupBeforeDrain = false
  let cleanupCompleted!: () => void
  const afterCleanup = new Promise<void>(resolve => { cleanupCompleted = resolve })
  const stages = new Set<string>()
  const server = createServer(async (req, res) => {
    activeHandlers++
    const reply = (status: number, value: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Set-Cookie': 'GAESA=creator; Path=/' })
      res.end(JSON.stringify(value))
    }
    try {
      const buffers: Buffer[] = []
      for await (const chunk of req) buffers.push(Buffer.from(chunk))
      const raw = Buffer.concat(buffers)
      const body = raw.length ? JSON.parse(raw.toString('utf8')) : {}
      const route = req.url!
      // Do not retain large payloads in the request history.
      requests.push({ route, bytes: raw.length, cookie: req.headers.cookie, body: { ...body, content: undefined } })
      if (raw.length > 32 * MiB) return reply(413, { error: 'request exceeds HTTP/1 ingress limit' })
      if (route === '/v1/health') return reply(200, { version: 2, features: ['stateful'] })
      if (route === '/v1/sandbox/create') return reply(200, { sandboxId: body.sandboxId ?? 'owned-id' })
      if (route === '/v1/sandbox/destroy') return reply(200, { success: true })
      if (route === '/v1/sandbox/exec') {
        if (body.command.includes('rm -rf')) cleanupBeforeDrain ||= activeParts > 0
        if (options.failInit && body.command.includes('mkdir')) return reply(200, { exitCode: 1, stderr: 'stage denied', stdout: '' })
        if (options.failCommit && body.command.includes('mv ')) return reply(200, { exitCode: 1, stderr: 'commit denied', stdout: '' })
        if (options.directoryAtCommit && body.command.includes('mv ')) await mkdir(join(cwd, 'target'))
        const result = await exec('/bin/sh', ['-c', body.command], { cwd: body.cwd ?? cwd }).then(
          result => ({ ...result, exitCode: 0 }),
          error => ({ stdout: error.stdout ?? '', stderr: error.stderr ?? '', exitCode: error.code ?? 1 }),
        )
        if (body.command.includes('rm -rf')) cleanupCompleted()
        if ((options.dropSetup && body.command.includes('mkdir -m 700')) || (options.dropCommit && body.command.includes('mv -fT'))) {
          res.destroy()
          return
        }
        return reply(200, result)
      }
      if (route === '/v1/sandbox/writeFile') {
        const target = resolve(body.cwd ?? cwd, body.path)
        const part = body.path.includes('.computesdk-upload-')
        if (part) {
          stages.add(dirname(target))
          activeParts++
        }
        try {
          if (part && options.dropPart && body.path.endsWith('000000000000')) {
            res.destroy()
            await afterCleanup
          }
          if (part && options.missingPart && body.path.endsWith('000000000000')) return reply(200, { success: true })
          if (part && options.failPart) {
            if (body.path.endsWith('000000000000')) {
              if (options.plainError) {
                res.writeHead(413, { 'Content-Type': 'text/plain' })
                res.end('part denied by proxy')
                return
              }
              return reply(500, { error: 'part denied' })
            }
            await new Promise(resolve => setTimeout(resolve, 80))
          }
          // v2 creates a new sibling file, then uses mv (not truncation).
          await mkdir(dirname(target), { recursive: true })
          const tmp = `${target}.computesdk-tmp.${randomUUID().slice(0, 8)}`
          await writeFile(tmp, body.content, 'utf8')
          await exec('mv', ['--', tmp, target])
          return reply(200, { success: true })
        } finally {
          if (part) activeParts--
        }
      }
      reply(404, { error: 'not found' })
    } catch (error) {
      reply(500, { error: error instanceof Error ? error.message : String(error) })
    } finally {
      if (--activeHandlers === 0) drained?.()
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const provider = cloudRun({
    sandboxUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, sandboxSecret: 'test-secret',
    executionMode: 'stateful', workdir: cwd,
    mounts: [{ src: '/quoted/"漢\\', dst: '/mount' }],
  })
  const sandbox = await provider.sandbox.create()
  return {
    cwd, directory, requests, stages, sandbox, provider,
    cleanupBeforeDrain: () => cleanupBeforeDrain,
    drainNative: async () => {
      if (activeHandlers) await new Promise<void>(resolve => { drained = resolve })
    },
    close: async () => {
      cleanupCompleted()
      await sandbox.destroy()
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      if (activeHandlers) await new Promise<void>(resolve => { drained = resolve })
      await rm(directory, { recursive: true, force: true })
    },
  }
}

async function noStages(f: Awaited<ReturnType<typeof fixture>>) {
  for (const stage of f.stages) await expect(stat(stage)).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await readdir(f.cwd)).some(name => name.startsWith('.computesdk-upload-'))).toBe(false)
}

describe('Cloud Run bounded v2 file uploads', () => {
  it('attempts owned cleanup and reports uncertainty after the setup socket drops', async () => {
    const f = await fixture({ dropSetup: true })
    try {
      await writeFile(join(f.cwd, 'target'), 'original')
      await expect(f.sandbox.filesystem.writeFile('target', 's'.repeat(25 * MiB))).rejects.toThrow(/cleanup UNCONFIRMED/)
      expect(f.requests.filter(r => String(r.body.command).includes('rm -rf'))).toHaveLength(1)
      expect(await readFile(join(f.cwd, 'target'), 'utf8')).toBe('original')
      await noStages(f)
    } finally { await f.close() }
  }, 60_000)

  it('does not mistake a successful cleanup for termination of a socket-dropped native part', async () => {
    const f = await fixture({ dropPart: true })
    try {
      await writeFile(join(f.cwd, 'target'), 'original')
      await expect(f.sandbox.filesystem.writeFile('target', 's'.repeat(25 * MiB))).rejects.toThrow(/cleanup UNCONFIRMED/)
      await f.drainNative()
      expect(f.requests.filter(r => String(r.body.command).includes('rm -rf'))).toHaveLength(1)
      expect(f.cleanupBeforeDrain()).toBe(true)
      expect((await readdir(f.cwd)).filter(name => name.startsWith('.computesdk-upload-'))).toHaveLength(1)
      expect(await readFile(join(f.cwd, 'target'), 'utf8')).toBe('original')
      expect(f.requests.some(r => String(r.body.command).includes('mv -fT'))).toBe(false)
    } finally { await f.close() }
  }, 60_000)

  it('reports publication ambiguity when the final commit socket drops after replacing the target', async () => {
    const f = await fixture({ dropCommit: true })
    const content = 's'.repeat(25 * MiB)
    try {
      await writeFile(join(f.cwd, 'target'), 'original')
      await expect(f.sandbox.filesystem.writeFile('target', content)).rejects.toThrow(/publication UNCONFIRMED.*cleanup UNCONFIRMED/)
      expect(digest(await readFile(join(f.cwd, 'target')))).toBe(digest(content))
      await noStages(f)
    } finally { await f.close() }
  }, 60_000)

  it('avoids the HTTP/1 limit, preserves bytes, cwd and creator affinity on every request', async () => {
    const f = await fixture()
    const content = 'a'.repeat(34 * MiB)
    try {
      const path = 'missing/quote "\'漢$(touch injected)\\file\nline'
      await f.sandbox.filesystem.writeFile(path, content)
      const result = await readFile(join(f.cwd, path))
      expect(result.length).toBe(Buffer.byteLength(content))
      expect(digest(result)).toBe(digest(content))
      expect(f.stages.size).toBe(1)
      const uploads = f.requests.filter(r => r.route === '/v1/sandbox/writeFile')
      expect(uploads.length).toBeGreaterThan(1)
      expect(uploads.every(r => r.bytes <= 8 * MiB)).toBe(true)
      expect(Math.max(...f.requests.map(r => r.bytes))).toBeLessThanOrEqual(24 * MiB)
      expect(f.requests.filter(r => r.route === '/v1/sandbox/writeFile').every(r => r.bytes <= 8 * MiB)).toBe(true)
      expect(f.requests.filter(r => r.route !== '/v1/sandbox/create' && r.route !== '/v1/health').every(r => r.cookie === 'GAESA=creator')).toBe(true)
      expect(uploads.every(r => r.body.cwd === f.cwd && r.body.executionMode === 'stateful')).toBe(true)
      const commandTimeouts = f.requests.filter(r => r.route === '/v1/sandbox/exec').map(r => Number(r.body.timeout))
      expect(commandTimeouts.every(timeout => timeout > 0 && timeout <= 300_000)).toBe(true)
      expect(commandTimeouts[1]).toBeLessThan(commandTimeouts[0])
      await expect(stat(join(f.cwd, 'injected'))).rejects.toMatchObject({ code: 'ENOENT' })
      await noStages(f)
    } finally { await f.close() }
  }, 60_000)

  it('budgets actual escaped JSON bytes and does not split UTF-16 surrogate pairs', async () => {
    const f = await fixture()
    const content = '\0\\"😀漢\ud800'.repeat(2 * MiB)
    try {
      const path = join(f.cwd, 'unicode')
      await f.sandbox.filesystem.writeFile(path, content)
      const result = await readFile(path)
      expect(result.length).toBe(Buffer.byteLength(content))
      expect(digest(result)).toBe(digest(content))
      expect(Math.max(...f.requests.map(r => r.bytes))).toBeLessThanOrEqual(24 * MiB)
      expect(f.stages.size).toBe(1)
      await noStages(f)
    } finally { await f.close() }
  }, 60_000)

  it('uses disjoint stage namespaces for concurrent writes to the same destination', async () => {
    const f = await fixture()
    const a = 'A'.repeat(25 * MiB), b = 'B'.repeat(25 * MiB)
    try {
      await Promise.all([f.sandbox.filesystem.writeFile('same', a), f.sandbox.filesystem.writeFile('same', b)])
      expect([digest(a), digest(b)]).toContain(digest(await readFile(join(f.cwd, 'same'))))
      expect(f.stages.size).toBe(2)
      await noStages(f)
    } finally { await f.close() }
  }, 60_000)

  it.each([{ failPart: true }, { failPart: true, plainError: true }, { failCommit: true }, { failInit: true }, { missingPart: true }])('preserves the destination and drains uploads before owned cleanup: %j', async failure => {
    const f = await fixture(failure)
    try {
      await writeFile(join(f.cwd, 'target'), 'original')
      await expect(f.sandbox.filesystem.writeFile('target', 'x'.repeat(25 * MiB))).rejects.toThrow(/part denied|commit denied|stage denied|byte count mismatch/)
      expect(await readFile(join(f.cwd, 'target'), 'utf8')).toBe('original')
      expect(f.cleanupBeforeDrain()).toBe(false)
      await noStages(f)
    } finally { await f.close() }
  }, 60_000)

  it('stops queued work and never publishes after the operation signal aborts', async () => {
    const f = await fixture()
    const controller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    const realFetch = globalThis.fetch
    let partsStarted = 0
    let commits = 0
    vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(input).endsWith('/v1/sandbox/writeFile')) {
        if (++partsStarted === 2) controller.abort(new Error('upload deadline'))
      } else if (String(input).endsWith('/v1/sandbox/exec') && String(init?.body).includes('mv -fT')) commits++
      return realFetch(input, init)
    })
    try {
      await writeFile(join(f.cwd, 'target'), 'original')
      await expect(f.sandbox.filesystem.writeFile('target', 't'.repeat(34 * MiB))).rejects.toThrow(/upload deadline.*cleanup failed/)
      expect(partsStarted).toBe(2)
      expect(commits).toBe(0)
      expect(await readFile(join(f.cwd, 'target'), 'utf8')).toBe('original')
    } finally {
      timeout.mockRestore()
      vi.unstubAllGlobals()
      await f.close()
    }
  }, 60_000)

  it('matches v2 replacement semantics for existing modes, hardlinks and symlinks', async () => {
    const f = await fixture()
    try {
      const content = 'L'.repeat(25 * MiB)
      await f.sandbox.filesystem.writeFile('native-mode', 'small')
      const nativeMode = (await stat(join(f.cwd, 'native-mode'))).mode & 0o777
      const original = join(f.cwd, 'original'), hard = join(f.cwd, 'hard'), soft = join(f.cwd, 'soft')
      await writeFile(original, 'old')
      await chmod(original, 0o600)
      await link(original, hard)
      await symlink(original, soft)
      await f.sandbox.filesystem.writeFile(hard, content)
      expect(await readFile(original, 'utf8')).toBe('old')
      expect((await stat(hard)).mode & 0o777).toBe(nativeMode)
      await f.sandbox.filesystem.writeFile(soft, content)
      expect((await lstat(soft)).isSymbolicLink()).toBe(false)
      expect(await readFile(original, 'utf8')).toBe('old')
      expect(digest(await readFile(hard))).toBe(digest(content))
      expect(digest(await readFile(soft))).toBe(digest(content))
      await noStages(f)
    } finally { await f.close() }
  }, 60_000)

  it.each([false, true])('does not report mv-into-directory as a successful file write (directory created during upload: %s)', async directoryAtCommit => {
    const f = await fixture({ directoryAtCommit })
    try {
      if (!directoryAtCommit) await mkdir(join(f.cwd, 'target'))
      await expect(f.sandbox.filesystem.writeFile('target', 'd'.repeat(25 * MiB))).rejects.toThrow(/directory/i)
      expect(await readdir(join(f.cwd, 'target'))).toEqual([])
      await noStages(f)
    } finally { await f.close() }
  }, 60_000)

  it('keeps the exact serialized-byte boundary on the direct route and splits the next byte', async () => {
    const f = await fixture()
    try {
      await f.sandbox.filesystem.writeFile('boundary', '')
      const overhead = f.requests.find(r => r.route === '/v1/sandbox/writeFile')!.bytes
      const content = 'b'.repeat(24 * MiB - overhead)
      await f.sandbox.filesystem.writeFile('boundary', content)
      expect(f.requests.filter(r => r.route === '/v1/sandbox/writeFile').at(-1)!.bytes).toBe(24 * MiB)
      expect(f.stages.size).toBe(0)
      await f.sandbox.filesystem.writeFile('boundary', `${content}b`)
      expect(f.stages.size).toBe(1)
      expect(digest(await readFile(join(f.cwd, 'boundary')))).toBe(digest(`${content}b`))
      await noStages(f)
    } finally { await f.close() }
  }, 60_000)

  it('preserves the single-request small and empty-file path and clearly rejects oversized ephemeral writes', async () => {
    const f = await fixture()
    try {
      await f.sandbox.filesystem.writeFile('empty', '')
      await f.sandbox.filesystem.writeFile('small', 'small')
      expect((await readFile(join(f.cwd, 'empty'))).length).toBe(0)
      expect(f.stages.size).toBe(0)
      expect(f.requests.filter(r => r.route === '/v1/sandbox/writeFile').map(r => r.body.path)).toEqual(['empty', 'small'])
      const ephemeral = await f.provider.sandbox.create({ executionMode: 'ephemeral' })
      try {
        await expect(ephemeral.filesystem.writeFile('large', 'e'.repeat(34 * MiB))).rejects.toThrow(/oversized.*stateful/i)
      } finally { await ephemeral.destroy() }
    } finally { await f.close() }
  }, 60_000)
})
