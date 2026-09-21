import { describe, it, expect, afterAll, vi } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import type { AddressInfo } from 'node:net'
import { daemonSeedScriptCommand, parseSeedInvocationOutput } from 'daemond'
import { defineProvider } from '../factory.js'
import type { CommandResult, SandboxInfo } from '../types/index.js'

const NODE_VERSION = '22.14.0'

function hostArch(): string {
  return os.arch() === 'arm64' ? 'arm64' : 'x64'
}

function runSeedCommand(command: string, env: NodeJS.ProcessEnv) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', command], { env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', (status) => resolve({ status, stdout, stderr }))
    setTimeout(() => child.kill('SIGKILL'), 55_000).unref()
  })
}

/**
 * A PATH containing only the tools the bootstrap chain needs — no node — to
 * simulate a minimal sandbox image.
 */
function minimalPathBin(dir: string): void {
  for (const tool of ['uname', 'mkdir', 'rm', 'mv', 'tar', 'gzip', 'curl', 'wget', 'busybox', 'python3']) {
    for (const candidate of [`/usr/bin/${tool}`, `/bin/${tool}`]) {
      if (fs.existsSync(candidate)) {
        fs.symlinkSync(candidate, path.join(dir, tool))
        break
      }
    }
  }
}

function makeProviderMethods(runCommand: (sandbox: unknown, command: string) => Promise<CommandResult>) {
  return {
    create: vi.fn().mockResolvedValue({ sandbox: { id: 's-1' }, sandboxId: 's-1' }),
    getById: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    destroy: vi.fn().mockResolvedValue(undefined),
    runCommand: vi.fn(runCommand),
    getInfo: vi.fn().mockResolvedValue({ id: 's-1' } as SandboxInfo),
    getUrl: vi.fn().mockResolvedValue('http://127.0.0.1:1'),
  }
}

describe('daemonSeedScriptCommand', () => {
  it('emits a node bootstrap prelude before invoking the launcher', () => {
    const command = daemonSeedScriptCommand({ ssePort: 38989 }, 'echo hi')
    expect(command).toContain('command -v node')
    expect(command).toContain('busybox --list')
    expect(command).toContain('https://nodejs.org/dist')
    expect(command).toContain('DAEMOND_NODE_DIST_URL')
    expect(command).toContain(`node-v${NODE_VERSION}-linux-$__daemond_arch`)
    expect(command).toContain('daemon bootstrap failed')
    expect(command).toContain('exec "$__daemond_node" -e ')
  })
})

describe('parseSeedInvocationOutput', () => {
  it('reports an empty launcher stdout clearly', () => {
    expect(() => parseSeedInvocationOutput('')).toThrow(/daemond: expected JSON output from seed launcher \(stdout was empty\)/)
    expect(() => parseSeedInvocationOutput('   \n ')).toThrow(/stdout was empty/)
  })

  it('includes the output tail when the last line is not JSON', () => {
    const garbage = `banner line one\n${'x'.repeat(300)}`
    try {
      parseSeedInvocationOutput(garbage)
      expect.unreachable()
    } catch (error) {
      const message = (error as Error).message
      expect(message).toMatch(/^daemond: expected JSON output/)
      expect(message).toContain('x'.repeat(200))
      expect(message).not.toContain('x'.repeat(201))
    }
    expect(() => parseSeedInvocationOutput('sh: node: not found')).toThrow(/output tail: sh: node: not found/)
  })
})

describe('seed launcher end-to-end', () => {
  const daemonPids: number[] = []
  afterAll(() => {
    for (const pid of daemonPids) {
      try { process.kill(pid) } catch { /* already gone */ }
    }
  })

  it('runs the launcher through node on PATH and parses the JSON result', async () => {
    const ssePort = 38100 + (process.pid % 500)
    const command = daemonSeedScriptCommand(
      { name: `vitest-${process.pid}`, ssePort },
      { command: 'sh', args: ['-c', 'echo hello-from-seed'], requestId: 'vitest-req' },
    )
    const result = await runSeedCommand(command, { ...process.env })
    expect(result.status).toBe(0)
    const invocation = parseSeedInvocationOutput(result.stdout)
    expect(invocation.requestId).toBe('vitest-req')
    expect(invocation.command.stdout).toBe('hello-from-seed\n')
    expect(invocation.command.exitCode).toBe(0)
    if (invocation.daemon.pid) daemonPids.push(invocation.daemon.pid)
  }, 30_000)
})

describe('node bootstrap in a sandbox without node', () => {
  it('downloads node via the fetch chain and the launcher output parses', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'daemond-home-'))
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'daemond-bin-'))
    minimalPathBin(bin)

    // A tarball mimicking the node dist layout whose "node" is a stub that
    // prints a well-formed launcher result.
    const distName = `node-v${NODE_VERSION}-linux-${hostArch()}`
    const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'daemond-dist-'))
    const nodeBin = path.join(tree, distName, 'bin')
    fs.mkdirSync(nodeBin, { recursive: true })
    const payload = JSON.stringify({
      token: 'tok',
      requestId: 'r',
      daemon: { reused: false, pid: 4242, sseUrl: '' },
      command: { exitCode: 0, signal: null, stdout: 'ok', stderr: '', combined: 'ok' },
    })
    fs.writeFileSync(
      path.join(nodeBin, 'node'),
      `#!/bin/sh\necho '${payload}'\n`,
      { mode: 0o755 },
    )
    const tarball = path.join(tree, 'node.tar.gz')
    spawnSync('tar', ['-czf', tarball, '-C', tree, distName])
    const tarballBytes = fs.readFileSync(tarball)

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/gzip' })
      res.end(tarballBytes)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

    try {
      const port = (server.address() as AddressInfo).port
      const command = daemonSeedScriptCommand({ ssePort: 38989 }, 'ignored')
      const result = await runSeedCommand(command, {
        PATH: bin,
        HOME: home,
        DAEMOND_NODE_DIST_URL: `http://127.0.0.1:${port}`,
      })
      expect(result.status).toBe(0)
      const invocation = parseSeedInvocationOutput(result.stdout)
      expect(invocation.token).toBe('tok')
      expect(invocation.command.stdout).toBe('ok')
      // The downloaded runtime is cached for the next invocation.
      expect(fs.existsSync(path.join(home, '.computesdk', 'daemond', distName, 'bin', 'node'))).toBe(true)
    } finally {
      server.close()
    }
  }, 60_000)

  it('fails with a clear capability error when node cannot be fetched', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'daemond-home-'))
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'daemond-bin-'))
    minimalPathBin(bin)

    const command = daemonSeedScriptCommand({ ssePort: 38989 }, 'ignored')
    const result = await runSeedCommand(command, {
      PATH: bin,
      HOME: home,
      // Nothing listens here, so every fetch tool fails.
      DAEMOND_NODE_DIST_URL: 'http://127.0.0.1:1',
    })
    expect(result.status).toBe(127)
    expect(result.stdout.trim()).toBe('')
    expect(result.stderr).toContain('daemond: sandbox lacks a JavaScript runtime and daemon bootstrap failed')
  }, 60_000)
})

describe('factory daemon bootstrap failure', () => {
  it('surfaces a daemond capability error instead of opaque parse failure', async () => {
    const methods = makeProviderMethods(async (_sandbox: unknown, command: string) => {
      if (command.includes('daemon bootstrap failed')) {
        // The emitted seed command hit a sandbox with no node and no way to
        // fetch one: stderr carries the capability error, stdout is empty.
        return { stdout: '', stderr: 'daemond: sandbox lacks a JavaScript runtime and daemon bootstrap failed: download of http://node/dist failed', exitCode: 127, durationMs: 5 }
      }
      return { stdout: 'plain output', stderr: '', exitCode: 0, durationMs: 5 }
    })
    const provider = defineProvider({ name: 'mock', methods: { sandbox: methods } })({})
    const sandbox = await provider.sandbox.create()

    await expect(
      sandbox.runCommand('git checkout .', { onStdout: () => {} }),
    ).rejects.toThrow(/^daemond: daemon bootstrap produced no JSON output \(exit code 127\): daemond: sandbox lacks a JavaScript runtime/)

    // The non-daemon runCommand path is unaffected, so callers can degrade.
    const plain = await sandbox.runCommand('git checkout .')
    expect(plain.stdout).toBe('plain output')
  })
})
