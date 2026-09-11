import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cloudRun, writeFileCommand } from '../index'

// Stand-in for /usr/local/gcp/bin/sandbox: drops everything up to `--`, then runs
// the command locally so stdin/argv handling can be exercised without Cloud Run.
const FAKE_SANDBOX = `#!/bin/sh
while [ "$1" != "--" ]; do shift; done
shift
exec "$@"
`

describe('cloudRun filesystem.writeFile (local CLI mode)', () => {
  let dir: string
  let binary: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cloud-run-fs-'))
    binary = join(dir, 'sandbox')
    await writeFile(binary, FAKE_SANDBOX)
    await chmod(binary, 0o755)
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('pipes the payload through stdin so argv stays small', () => {
    const command = writeFileCommand('/tmp/bench/file.txt')
    expect(command).toBe('mkdir -p "$(dirname "/tmp/bench/file.txt")" && base64 -d > "/tmp/bench/file.txt"')
  })

  it('writes a 100 KiB file and a nested path without spawn E2BIG', async () => {
    const compute = cloudRun({ sandboxBinary: binary })
    const sandbox = await compute.sandbox.create()
    const content = 'x'.repeat(100 * 1024)
    const target = join(dir, 'nested', 'deep', 'file.txt')

    await sandbox.filesystem.writeFile(target, content)
    expect(await readFile(target, 'utf8')).toBe(content)

    const unicode = 'héllo wörld\n'.repeat(1000)
    await sandbox.filesystem.writeFile(target, unicode)
    expect(await readFile(target, 'utf8')).toBe(unicode)
    expect(await sandbox.filesystem.readFile(target)).toBe(unicode)
  })
})
