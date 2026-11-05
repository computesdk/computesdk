import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  attachShellProcess,
  runCommandViaShell,
  startShellProcess,
  type CommandRunner,
} from '../shell-process.js'

/** The shell tier against the host's own /bin/sh — the "box" is a temp TMPDIR. */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csdk-shell-'))
const run: CommandRunner = (command) =>
  new Promise((resolve, reject) => {
    const started = Date.now()
    const child = spawn('/bin/sh', ['-c', command], { env: { ...process.env, TMPDIR: tmp } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => { stdout += String(c) })
    child.stderr.on('data', (c) => { stderr += String(c) })
    child.on('error', reject)
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? -1, durationMs: Date.now() - started }))
  })

describe('shell process tier (host sh)', () => {
  it('runs a background job and reads logs by cursor', async () => {
    const proc = await startShellProcess(run, 'echo one; echo err >&2; sleep 1; echo two; exit 3')
    expect(proc.pid).toBeGreaterThan(0)
    const first = await proc.status()
    expect(first.status).toBe('running')
    const result = await proc.wait({ timeout: 20_000 })
    expect(result.exitCode).toBe(3)
    expect(result.stdout).toBe('one\ntwo\n')
    expect(result.stderr).toBe('err\n')
    expect(result.signal).toBeNull()
  }, 30_000)

  it('writes stdin and closes it', async () => {
    const chunks: string[] = []
    const proc = await startShellProcess(run, 'cat', { stdin: true, onStdout: (c) => chunks.push(c) })
    await proc.write('hello\n')
    await proc.write(new TextEncoder().encode('world\n'))
    await proc.closeStdin()
    const result = await proc.wait({ timeout: 20_000 })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('hello\nworld\n')
    expect(chunks.join('')).toBe(result.stdout)
  }, 30_000)

  it('kills the whole process group', async () => {
    const marker = path.join(tmp, `kill-${Date.now()}`)
    const proc = await startShellProcess(run, `(sleep 2; touch ${marker}) & sleep 30`)
    await proc.kill()
    const result = await proc.wait({ timeout: 15_000 })
    expect(result.signal).toBe('SIGTERM')
    await new Promise((r) => setTimeout(r, 3000))
    expect(fs.existsSync(marker)).toBe(false)
  }, 30_000)

  it('streams runCommand with the in-box timeout and no delayed side effect', async () => {
    const marker = path.join(tmp, `timeout-${Date.now()}`)
    const out: string[] = []
    const result = await runCommandViaShell(run, `echo starting; sleep 3; touch ${marker}`, {
      timeout: 1000,
      onStdout: (c) => out.push(c),
    })
    expect(result.exitCode).toBe(124)
    expect(out.join('')).toBe('starting\n')
    await new Promise((r) => setTimeout(r, 3500))
    expect(fs.existsSync(marker)).toBe(false)
  }, 30_000)

  it('starts 8 jobs in parallel on a fresh root', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => startShellProcess(run, `echo job-${i}`).then((p) => p.wait({ timeout: 20_000 })))
    )
    results.forEach((r, i) => expect(r.stdout).toBe(`job-${i}\n`))
  }, 30_000)

  it('returns large output in bounded chunks and reattaches', async () => {
    const reads: number[] = []
    const counting: CommandRunner = async (command, options) => {
      const result = await run(command, options)
      reads.push(result.stdout.length)
      return result
    }
    const proc = await startShellProcess(counting, `i=0; while [ $i -lt 20000 ]; do echo "line $i"; i=$((i+1)); done`, { maxReadBytes: 8192 })
    const result = await proc.wait({ timeout: 60_000 })
    expect(result.stdout.split('\n').length).toBe(20001)
    expect(Math.max(...reads)).toBeLessThan(12_000)
    const again = attachShellProcess(run, proc.jobId)
    const replay = await again.wait({ timeout: 20_000 })
    expect(replay.stdout).toBe(result.stdout)
  }, 90_000)

  it('survives an exec API that flattens newlines', async () => {
    const flattening: CommandRunner = (command, options) => run(command.replace(/\n/g, ' '), options)
    const chunks: string[] = []
    const result = await runCommandViaShell(flattening, 'echo a\necho b', { onStdout: (c) => chunks.push(c) })
    // The caller's command travels base64-encoded, so its own newlines survive.
    expect(result).toMatchObject({ exitCode: 0, stdout: 'a\nb\n' })
    const proc = await startShellProcess(flattening, 'cat', { stdin: true })
    await proc.write('x\ny\n')
    await proc.closeStdin()
    expect((await proc.wait({ timeout: 20_000 })).stdout).toBe('x\ny\n')
  }, 30_000)
})
