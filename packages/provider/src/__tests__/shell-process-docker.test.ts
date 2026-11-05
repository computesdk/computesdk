/**
 * The shell process tier against real images, through `defineProvider` with a
 * provider whose only exec primitive is `docker exec <id> sh -c <command>`.
 *
 * Needs a Docker daemon and pulls the images below, so it only runs with
 * COMPUTESDK_SHELL_DOCKER_TESTS=1 (`pnpm --filter @computesdk/provider test:shell-docker`).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { defineProvider } from '../factory.js'
import type { CommandResult, RunCommandOptions } from '../types/index.js'

const IMAGES = (process.env.COMPUTESDK_SHELL_DOCKER_IMAGES ?? 'alpine:3.21,busybox:latest,debian:bookworm-slim,node:22-slim').split(',')
const enabled = process.env.COMPUTESDK_SHELL_DOCKER_TESTS === '1'

type Box = { id: string }

const execStats: Record<string, number[]> = {}

function dockerExec(box: Box, command: string, options?: RunCommandOptions): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const child = spawn('docker', ['exec', box.id, 'sh', '-c', command])
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => { stdout += String(c) })
    child.stderr.on('data', (c) => { stderr += String(c) })
    child.on('error', reject)
    const timer = options?.timeout ? setTimeout(() => child.kill('SIGKILL'), options.timeout) : undefined
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      ;(execStats[box.id] ??= []).push(stdout.length)
      resolve({ stdout, stderr, exitCode: code ?? -1, durationMs: Date.now() - started })
    })
  })
}

const dockerBox = defineProvider<Box, { image: string }>({
  name: 'docker-shell-test',
  methods: {
    instances: {
      create: async (config) => {
        const run = spawnSync('docker', ['run', '-d', '--rm', config.image, 'tail', '-f', '/dev/null'], { encoding: 'utf8' })
        if (run.status !== 0) throw new Error(run.stderr)
        const id = run.stdout.trim()
        return { instance: { id }, instanceId: id }
      },
      getById: async (_config, id) => ({ instance: { id }, instanceId: id }),
      list: async () => [],
      destroy: async (_config, id) => { spawnSync('docker', ['rm', '-f', id]) },
      runCommand: (box, command, options) => dockerExec(box, command, options),
      getInfo: async (box) => ({ id: box.id, provider: 'docker-shell-test', status: 'running', createdAt: new Date(), timeout: 0 }),
      getUrl: async () => { throw new Error('no ports') },
    },
  },
})

const exists = async (instance: { runCommand: (c: string) => Promise<CommandResult> }, file: string) =>
  (await instance.runCommand(`[ -e ${file} ] && echo yes || echo no`)).stdout.trim() === 'yes'

describe.runIf(enabled).concurrent.each(IMAGES)('shell process tier on %s', (image) => {
  const provider = dockerBox({ image })
  let instance: Awaited<ReturnType<typeof provider.instances.create>>

  beforeAll(async () => {
    spawnSync('docker', ['pull', '-q', image])
    instance = await provider.instances.create()
  }, 180_000)
  afterAll(async () => { await instance?.destroy() })

  it('reports the shell tier when the provider has no native hooks', () => {
    expect(instance.processRuntime).toEqual({ streaming: 'shell', processes: 'shell' })
  })

  it('runs a background job; status and logs advance by cursor', async () => {
    const proc = await instance.startProcess('echo one; echo oops >&2; sleep 2; echo two; exit 7', { env: { X: 'y' } })
    expect(proc.runtime).toBe('shell')
    const early = await proc.status()
    expect(early.status).toBe('running')
    const result = await proc.wait({ timeout: 30_000 })
    expect(result).toMatchObject({ exitCode: 7, stdout: 'one\ntwo\n', stderr: 'oops\n', signal: null })
    const after = await proc.status()
    expect(after.status).toBe('exited')
    expect(after.stdout).toBe('one\ntwo\n')
  }, 60_000)

  it('writes stdin and closes it', async () => {
    const chunks: string[] = []
    const proc = await instance.startProcess('cat; echo done', { stdin: true, onStdout: (c) => chunks.push(c) })
    await proc.write('hello\n')
    await proc.write('wörld\n')
    await proc.closeStdin()
    const result = await proc.wait({ timeout: 30_000 })
    expect(result.stdout).toBe('hello\nwörld\ndone\n')
    expect(chunks.join('')).toBe(result.stdout)
    await expect(proc.write('late\n')).rejects.toThrow(/exited/)
  }, 60_000)

  it('kill signals the whole process group', async () => {
    const marker = `/tmp/kill-marker-${Date.now()}`
    const proc = await instance.startProcess(`(sleep 3; touch ${marker}) & sleep 60`)
    await proc.kill()
    const result = await proc.wait({ timeout: 20_000 })
    expect(result.signal).toBe('SIGTERM')
    await new Promise((r) => setTimeout(r, 4_000))
    expect(await exists(instance, marker)).toBe(false)
  }, 60_000)

  it('times out in the box with no delayed side effect', async () => {
    const marker = `/tmp/timeout-marker-${Date.now()}`
    const out: string[] = []
    const result = await instance.runCommand(`echo starting; sleep 4; touch ${marker}`, {
      timeout: 1_500,
      onStdout: (c) => out.push(c),
    })
    expect(result.exitCode).toBe(124)
    expect(result.durationMs).toBeLessThan(15_000)
    expect(out.join('')).toBe('starting\n')
    await new Promise((r) => setTimeout(r, 5_000))
    expect(await exists(instance, marker)).toBe(false)
  }, 60_000)

  it('starts 8 processes in parallel on a fresh box', async () => {
    const fresh = await provider.instances.create()
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => fresh.startProcess(`echo job-${i}`).then((p) => p.wait({ timeout: 30_000 })))
      )
      results.forEach((r, i) => expect(r).toMatchObject({ exitCode: 0, stdout: `job-${i}\n` }))
    } finally {
      await fresh.destroy()
    }
  }, 120_000)

  it('streams a runCommand that runs longer than 70s without killing it', async () => {
    const chunks: string[] = []
    const startedAt = Date.now()
    let firstAt: number | undefined
    const result = await instance.runCommand('i=0; while [ $i -lt 8 ]; do echo tick $i; i=$((i+1)); sleep 10; done; echo end', {
      onStdout: (c) => { firstAt ??= Date.now(); chunks.push(c) },
    })
    expect(result.exitCode).toBe(0)
    expect(result.durationMs).toBeGreaterThan(70_000)
    expect(chunks.join('')).toBe(result.stdout)
    expect(result.stdout).toContain('tick 7\nend\n')
    expect((firstAt as number) - startedAt).toBeLessThan(15_000)
  }, 150_000)

  it('returns large output in bounded chunks', async () => {
    const before = execStats[instance.instanceId]?.length ?? 0
    // ~1.9 MB of stdout
    const proc = await instance.startProcess('i=0; while [ $i -lt 100000 ]; do echo "line number $i"; i=$((i+1)); done')
    const result = await proc.wait({ timeout: 120_000 })
    expect(result.exitCode).toBe(0)
    const lines = result.stdout.split('\n')
    expect(lines.length).toBe(100_001)
    expect(lines[99_999]).toBe('line number 99999')
    const sizes = execStats[instance.instanceId].slice(before)
    // Every exec reply stays under SSM's 24,000-char inline stdout cap.
    expect(Math.max(...sizes)).toBeLessThan(24_000)
  }, 180_000)

  it('reattaches from the job id in a new client', async () => {
    const proc = await instance.startProcess('echo before; sleep 2; echo after')
    const other = await dockerBox({ image }).instances.getById(instance.instanceId)
    const attached = await other!.attachProcess!(proc.jobId)
    const result = await attached.wait({ timeout: 30_000 })
    expect(result).toMatchObject({ exitCode: 0, stdout: 'before\nafter\n' })
  }, 60_000)
})
