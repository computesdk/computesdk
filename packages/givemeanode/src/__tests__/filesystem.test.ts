import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { filesystem, READ_CHUNK_BYTES, WRITE_CHUNK_BASE64_CHARS, writeFileCommands } from '../operations'
import type { CommandResultShape, SandboxHandle } from '../operations'

const sandbox = {} as SandboxHandle
const dir = mkdtempSync(join(tmpdir(), 'gmn-filesystem-'))
const result = (stdout: string, extra: Partial<CommandResultShape> = {}): CommandResultShape =>
  ({ stdout, stderr: '', exitCode: 0, durationMs: 0, ...extra })
const shell = async (_sandbox: SandboxHandle, command: string): Promise<CommandResultShape> => {
  const r = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8', maxBuffer: 1024 * 1024 })
  if (r.error) throw r.error
  return result(r.stdout, { stderr: r.stderr, exitCode: r.status ?? 1 })
}
const encoded = (content: string, status = 0) => Buffer.from(`${content}\n${status}`).toString('base64')

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('bounded filesystem reads', () => {
  it.each([0, READ_CHUNK_BYTES - 1, READ_CHUNK_BYTES, READ_CHUNK_BYTES + 1, 1048575, 1048576, 1048577, 16 * 1048576])(
    'reads %i bytes exactly through a 1 MiB output channel', async size => {
      const path = join(dir, 'boundary')
      writeFileSync(path, Buffer.alloc(size, 'x'))
      const text = await filesystem.readFile(sandbox, path, shell)
      expect(Buffer.byteLength(text)).toBe(size)
      expect(createHash('sha256').update(text).digest('hex'))
        .toBe(createHash('sha256').update(readFileSync(path)).digest('hex'))
    },
  )

  it('decodes only after assembly, preserving split UTF-8, BOM, NUL and newlines', async () => {
    const text = '\ufeff' + 'a'.repeat(READ_CHUNK_BYTES - 4) + '🌍日本語\0\r\nlast\n\n'
    const path = join(dir, 'unicode')
    writeFileSync(path, text)
    expect(await filesystem.readFile(sandbox, path, shell)).toBe(text)
  })

  it('quotes paths literally, follows links, and refuses directories and missing files', async () => {
    const path = join(dir, 'space " $HOME `id` \' \\\nfile')
    writeFileSync(path, 'literal\n')
    const link = join(dir, 'link')
    symlinkSync(path, link)
    expect(await filesystem.readFile(sandbox, link, shell)).toBe('literal\n')
    await expect(filesystem.readFile(sandbox, dir, shell)).rejects.toThrow()
    await expect(filesystem.readFile(sandbox, join(dir, 'absent'), shell)).rejects.toThrow()
  })

  it.skipIf(process.getuid?.() === 0)('honors permissions, including a dd failure after the size check', async () => {
    const path = join(dir, 'permissions')
    writeFileSync(path, 'private')
    chmodSync(path, 0)
    try {
      expect((await shell(sandbox, `cat "${path}"`)).exitCode).not.toBe(0)
      await expect(filesystem.readFile(sandbox, path, shell)).rejects.toThrow(/Permission denied/)
      chmodSync(path, 0o600)
      await expect(filesystem.readFile(sandbox, path, async (handle, command) => {
        if (!command.startsWith('wc')) chmodSync(path, 0)
        return shell(handle, command)
      })).rejects.toThrow(/Permission denied/)
    } finally {
      chmodSync(path, 0o600)
    }
  })

  it.each([
    ['truncation', result(encoded('hello'), { truncated: true }), /Truncated/],
    ['short read', result(encoded('hell')), /Short or oversized/],
    ['oversized read', result(encoded('hello!')), /Short or oversized/],
    ['invalid base64', result('%%%'), /Invalid base64/],
    ['missing status', result(Buffer.from('hello').toString('base64')), /Cannot read/],
    ['failed dd hidden by the pipeline', result(encoded('hello', 1), { stderr: 'Permission denied' }), /Permission denied/],
    ['failed base64', result('', { exitCode: 1, stderr: 'encoder failed' }), /encoder failed/],
  ] as const)('rejects %s rather than returning a prefix', async (_name, response, message) => {
    const run = async (_sandbox: SandboxHandle, command: string) => command.startsWith('wc') ? result('5') : response
    await expect(filesystem.readFile(sandbox, '/file', run)).rejects.toThrow(message)
  })

  it.each(['', '-1', '1.5', 'NaN', '9007199254740992'])('rejects invalid native size %j', async size => {
    await expect(filesystem.readFile(sandbox, '/file', async () => result(size))).rejects.toThrow(/Invalid file size/)
  })

  it('propagates permissions, transport errors and a size change during the read', async () => {
    await expect(filesystem.readFile(sandbox, '/file', async () => result('', { exitCode: 1, stderr: 'Permission denied' })))
      .rejects.toThrow('Permission denied')
    let calls = 0
    await expect(filesystem.readFile(sandbox, '/file', async () => {
      if (++calls === 1) return result('5')
      throw new Error('connection lost')
    })).rejects.toThrow('connection lost')
    calls = 0
    await expect(filesystem.readFile(sandbox, '/file', async () => {
      calls++
      return calls === 1 ? result('5') : calls === 2 ? result(encoded('hello')) : result('6')
    })).rejects.toThrow(/File size changed/)
  })
})

describe('bounded write encoding', () => {
  it('generates only the next command, including its base64 payload', () => {
    const encode = vi.spyOn(globalThis, 'btoa')
    try {
      const commands = writeFileCommands('/file', '🌍'.repeat(100_000))
      expect(encode).not.toHaveBeenCalled()
      expect(commands.next().value).toContain('.gmn-part')
      expect(encode).toHaveBeenCalledTimes(1)
      commands.next()
      expect(encode).toHaveBeenCalledTimes(2)
      commands.return(undefined)
    } finally {
      encode.mockRestore()
    }
  })

  it.each(['', 'hello', 'hello\n', '\ufeff€\0\r\n', '🌍'.repeat(100_000)])('round trips an exact write (%#)', async text => {
    const path = join(dir, 'written " $HOME `id` \' \\\nfile')
    await filesystem.writeFile(sandbox, path, text, shell)
    expect(readFileSync(path, 'utf8')).toBe(text)
    expect(existsSync(path + '.gmn-part')).toBe(false)
  })

  it('preserves small-write permissions/link behavior and multipart rename behavior', async () => {
    const target = join(dir, 'target')
    const link = join(dir, 'write-link')
    writeFileSync(target, 'old')
    chmodSync(target, 0o640)
    symlinkSync(target, link)
    await filesystem.writeFile(sandbox, link, 'new', shell)
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readFileSync(target, 'utf8')).toBe('new')
    expect(lstatSync(target).mode & 0o777).toBe(0o640)
    await filesystem.writeFile(sandbox, link, 'x'.repeat(WRITE_CHUNK_BASE64_CHARS), shell)
    expect(lstatSync(link).isSymbolicLink()).toBe(false)
    expect(readFileSync(target, 'utf8')).toBe('new')
  })

  it.each([false, true])('cleans a failed multipart write without replacing the target (throw=%s)', async throws => {
    const path = join(dir, 'failed')
    writeFileSync(path, 'old')
    let writes = 0
    await expect(filesystem.writeFile(sandbox, path, 'x'.repeat(100_000), async (handle, command) => {
      if (command.includes('base64 -d') && ++writes === 2) {
        if (throws) throw new Error('transport failed')
        return result('', { exitCode: 1, stderr: 'write failed' })
      }
      return shell(handle, command)
    })).rejects.toThrow(/failed/)
    expect(readFileSync(path, 'utf8')).toBe('old')
    expect(existsSync(path + '.gmn-part')).toBe(false)
  })
})
