import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { defineProvider } from '../factory.js'
import {
  ShellProcessRuntime,
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

  it('detects an instance whose execs share no state and never runs the command twice', async () => {
    // Every exec gets its own TMPDIR, like a fresh container per command.
    const counter = path.join(tmp, `ran-${Date.now()}`)
    const ephemeral: CommandRunner = (command) =>
      new Promise((resolve, reject) => {
        const started = Date.now()
        const child = spawn('/bin/sh', ['-c', command], { env: { ...process.env, TMPDIR: fs.mkdtempSync(path.join(tmp, 'exec-')) } })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (c) => { stdout += String(c) })
        child.stderr.on('data', (c) => { stderr += String(c) })
        child.on('error', reject)
        child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? -1, durationMs: Date.now() - started }))
      })
    const provider = defineProvider({
      name: 'ephemeral',
      methods: {
        instances: {
          create: async () => ({ instance: {}, instanceId: 'ephemeral-1' }),
          getById: async () => null,
          list: async () => [],
          destroy: async () => {},
          runCommand: (_instance, command, options) => ephemeral(command, options),
          getInfo: async () => { throw new Error('unused') },
          getUrl: async () => '',
        },
      },
    })({})
    const instance = await provider.instances.create()
    expect(instance.processRuntime?.streaming).toBe('shell')
    const chunks: string[] = []
    await expect(instance.runCommand(`echo x >> ${counter}; echo hi`, { onStdout: (c) => chunks.push(c) }))
      .rejects.toMatchObject({ code: 'unsupported' })
    expect(instance.processRuntime?.streaming).toBe('unsupported')
    expect(chunks).toEqual([])
    expect(fs.existsSync(counter)).toBe(false)
    await expect(instance.runCommand(`echo unexpected >> ${counter}`, { onStderr: (c) => chunks.push(c) }))
      .rejects.toMatchObject({ code: 'unsupported' })
    expect(fs.existsSync(counter)).toBe(false)
    const result = await instance.runCommand(`echo x >> ${counter}; echo hi`)
    expect(result).toMatchObject({ exitCode: 0, stdout: 'hi\n' })
    expect(chunks).toEqual([])
    await new Promise((r) => setTimeout(r, 1000))
    expect(fs.readFileSync(counter, 'utf8')).toBe('x\n')
    await expect(instance.startProcess('echo hi')).rejects.toMatchObject({ code: 'unsupported' })
  }, 30_000)

  it('confirms state once, then launches without the hold', async () => {
    const launches: string[] = []
    const recording: CommandRunner = (command, options) => { launches.push(command); return run(command, options) }
    const runtime = new ShellProcessRuntime(recording)
    const first = await runtime.startProcess('echo one')
    expect((await first.wait({ timeout: 20_000 })).stdout).toBe('one\n')
    const execsForFirst = launches.length
    const second = await runtime.startProcess('echo two')
    expect((await second.wait({ timeout: 20_000 })).stdout).toBe('two\n')
    // Held start: launch + confirm; unheld start: launch only.
    expect(launches.length - execsForFirst).toBeLessThan(execsForFirst)
  }, 30_000)

  it('reports no signal for a command that exits 143 on its own', async () => {
    const proc = await startShellProcess(run, 'exit 143')
    expect(await proc.wait({ timeout: 20_000 })).toMatchObject({ exitCode: 143, signal: null })
  }, 30_000)

  it('accepts a stdin write right after a held first start', async () => {
    const runtime = new ShellProcessRuntime(run)
    const proc = await runtime.startProcess('cat', { stdin: true })
    await proc.write('early\n')
    await proc.closeStdin()
    expect((await proc.wait({ timeout: 20_000 })).stdout).toBe('early\n')
  }, 30_000)

  it('still advances when maxReadBytes is smaller than a record', async () => {
    const proc = await startShellProcess(run, 'i=0; while [ $i -lt 2000 ]; do echo "line $i"; i=$((i+1)); done', { maxReadBytes: 1 })
    expect((await proc.wait({ timeout: 30_000 })).stdout.split('\n').length).toBe(2001)
  }, 60_000)

  it('refuses a job root it does not own', async () => {
    const box = fs.mkdtempSync(path.join(tmp, 'unsafe-'))
    fs.mkdirSync(path.join(box, 'elsewhere'))
    fs.symlinkSync(path.join(box, 'elsewhere'), path.join(box, '.computesdk'))
    const runIn: CommandRunner = (command, options) => run(`TMPDIR=${box}; export TMPDIR; ${command}`, options)
    await expect(startShellProcess(runIn, 'echo hi')).rejects.toThrow(/unsafe-job-root/)
  }, 30_000)
})
