import { describe, it, expect, vi } from 'vitest'
import { defineProvider } from '../factory.js'
import type { CommandResult, ProcessHandle } from '../types/index.js'
import { parseFramedLog } from '../shell-process.js'
import {
  REPLY_END,
  REPLY_MARKER,
  SHELL_TIER_TOOLS,
  killScript,
  launchScript,
  normalizeSignal,
  readScript,
  runFile,
  shQuote,
  singleLine,
  supervisorFile,
  writeStdinScript,
} from '../shell-scripts.js'

vi.mock('daemond', () => ({
  daemonSeedScriptCommand: vi.fn(() => 'DAEMOND_SEED'),
  parseSeedInvocationOutput: vi.fn(() => ({
    token: 't',
    requestId: 'r',
    daemon: { reused: true, pid: 1, sseUrl: '' },
    command: { exitCode: 0, signal: null, stdout: 'via-daemond\n', stderr: '', jobId: 'dj', pid: 9, status: 'running' },
  })),
  egressShimScript: () => '',
}))

describe('shell scripts', () => {
  it('sends every program as one base64 line', () => {
    const wire = singleLine('echo a\necho b')
    expect(wire).not.toContain('\n')
    expect(wire).toContain(`printf '%s' '${Buffer.from('echo a\necho b').toString('base64')}' | base64 -d`)
  })

  it('quotes values for sh', () => {
    expect(shQuote("it's")).toBe(`'it'\\''s'`)
  })

  it('builds the command file with env exports and cwd', () => {
    expect(runFile({ command: 'echo $A', cwd: "/w s", env: { A: "x'y" } })).toBe(
      `export A='x'\\''y'\ncd '/w s' || exit 1\necho $A\n`
    )
    expect(() => runFile({ command: 'x', env: { 'BAD-KEY': '1' } })).toThrow(/env var name/)
  })

  it('launches detached through nohup setsid after probing every tool', () => {
    const script = launchScript({ jobId: 'j1', command: 'sleep 1', stdin: true, timeoutMs: 1500 })
    for (const tool of SHELL_TIER_TOOLS) expect(script).toContain(` ${tool}`)
    expect(script).toContain(`${REPLY_MARKER} unsupported $t`)
    expect(script).toContain('$N setsid sh "$D/sup.sh" "$D" > /dev/null 2>&1 < /dev/null &')
    expect(script).toContain('D="${TMPDIR:-/tmp}/.computesdk/jobs/j1"')
    expect(script).toContain('umask 077')
    expect(script).toContain('TIMEOUT=1.500')
    expect(script).toContain('STDIN=1')
    expect(script).toContain('HOLD=0')
    expect(script).toContain('W="$D/pid"')
    const held = launchScript({ jobId: 'j1', command: 'x', hold: true })
    expect(held).toContain('HOLD=1')
    expect(held).toContain('W="$D/sup"')
  })

  it('supervises with FIFOs, a stdin holder, a group-killing watchdog and exit-after-drain', () => {
    const sup = supervisorFile()
    expect(sup).toContain('mkfifo "$D/o" "$D/e"')
    expect(sup).toContain('sleep 2147483647 1<>"$D/in"')
    expect(sup).toContain('setsid sh "$D/run.sh" < "$IN" > "$D/o" 2> "$D/e" &')
    expect(sup).toContain('kill -s KILL -- "-$4"')
    expect(sup.indexOf('wait "$pg"')).toBeLessThan(sup.indexOf('mv "$D/exit.tmp" "$D/exit"'))
  })

  it('reads a bounded window after the cursor and long-polls in the box', () => {
    const script = readScript({ jobId: 'j1', cursor: 100, maxBytes: 4096, waitMs: 60_000, untilOutput: true })
    expect(script).toContain('tail -c +101 "$D/out.log" | head -c 4096 | base64')
    // capped at 25s of 200ms naps
    expect(script).toContain('n=125')
    expect(script).toContain('-le 100')
    expect(script).toContain(REPLY_END)
    expect(readScript({ jobId: 'j1', cursor: 0 })).not.toContain('nap')
  })

  it('validates job ids, signals and stdin payloads', () => {
    expect(() => readScript({ jobId: '../x', cursor: 0 })).toThrow(/invalid job id/)
    expect(normalizeSignal('sigint')).toBe('INT')
    expect(() => killScript('j1', 'TERM; rm -rf /')).toThrow(/invalid signal/)
    expect(killScript('j1', 'SIGKILL')).toContain('kill -s KILL -- "-$pg"')
    expect(() => writeStdinScript('j1', "a'b")).toThrow(/base64/)
  })

  it('parses framed records and leaves a partial record for the next read', () => {
    const log = Buffer.concat([Buffer.from('O3\nabcE2\nxy'), Buffer.from('O5\nab')])
    const records = parseFramedLog(log, 1000)
    expect(records.map((r) => [r.stream, r.offset, r.end, Buffer.from(r.data).toString()])).toEqual([
      ['stdout', 1000, 1006, 'abc'],
      ['stderr', 1006, 1011, 'xy'],
    ])
  })
})

function methods(extra: Record<string, unknown> = {}) {
  const runCommand = vi.fn(async (_box: unknown, wire: string): Promise<CommandResult> => {
    const encoded = /printf '%s' '([A-Za-z0-9+/=]+)' \| base64 -d\)"$/.exec(wire)
    const command = encoded ? Buffer.from(encoded[1], 'base64').toString('utf8') : wire
    if (command.includes(': > "$D/go"')) return { stdout: `${REPLY_MARKER} ok\n`, stderr: '', exitCode: 0, durationMs: 1 }
    if (command.includes('sup.sh')) return { stdout: `${REPLY_MARKER} ok 4242\n`, stderr: '', exitCode: 0, durationMs: 1 }
    if (command.includes('out.log')) {
      const log = Buffer.from('O6\nshell\n').toString('base64')
      return { stdout: `${REPLY_MARKER} exited 0 - 0 9 4242\n${log}\n${REPLY_END}\n`, stderr: '', exitCode: 0, durationMs: 1 }
    }
    return { stdout: 'DAEMOND', stderr: '', exitCode: 0, durationMs: 1 }
  })
  return {
    create: vi.fn().mockResolvedValue({ instance: { id: 'b' }, instanceId: 'b' }),
    getById: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    destroy: vi.fn().mockResolvedValue(undefined),
    getInfo: vi.fn(),
    getUrl: vi.fn().mockRejectedValue(new Error('no ports')),
    runCommand,
    ...extra,
  }
}

describe('process runtime dispatch', () => {
  it('prefers native streamCommand and startProcess hooks', async () => {
    const native = { pid: 1, jobId: 'n' } as ProcessHandle
    const m = methods({
      streamCommand: vi.fn().mockResolvedValue({ stdout: 'native', stderr: '', exitCode: 0, durationMs: 1 }),
      startProcess: vi.fn().mockResolvedValue(native),
    })
    const instance = await defineProvider({ name: 'p', methods: { instances: m } })({ processRuntime: 'daemond' }).instances.create()
    expect(instance.processRuntime).toEqual({ streaming: 'native', processes: 'native' })
    expect((await instance.runCommand('x', { onStdout: () => {} })).stdout).toBe('native')
    const handle = await instance.startProcess('x')
    expect(handle.runtime).toBe('native')
    expect(m.runCommand).not.toHaveBeenCalled()
  })

  it('falls back to the shell tier by default', async () => {
    const m = methods()
    const instance = await defineProvider({ name: 'p', methods: { instances: m } })({}).instances.create()
    expect(instance.processRuntime).toEqual({ streaming: 'shell', processes: 'shell' })
    const chunks: string[] = []
    const result = await instance.runCommand('echo shell', { onStdout: (c) => chunks.push(c) })
    expect(result).toMatchObject({ stdout: 'shell\n', exitCode: 0 })
    expect(chunks).toEqual(['shell\n'])
    const handle = await instance.startProcess('echo shell')
    expect(handle.runtime).toBe('shell')
    expect(handle.pid).toBe(4242)
    expect(m.runCommand.mock.calls.every(([, command]) => !command.includes('DAEMOND'))).toBe(true)
  })

  it('uses daemond only when processRuntime is daemond, and strips the option from provider config', async () => {
    const m = methods()
    const instance = await defineProvider({ name: 'p', methods: { instances: m } })({ apiKey: 'k', processRuntime: 'daemond' }).instances.create()
    expect(m.create).toHaveBeenCalledWith({ apiKey: 'k' }, undefined)
    expect(instance.processRuntime).toEqual({ streaming: 'daemond', processes: 'daemond' })
    const result = await instance.runCommand('x', { onStdout: () => {} })
    expect(result.stdout).toBe('via-daemond\n')
    expect(m.runCommand).toHaveBeenCalledWith({ id: 'b' }, 'DAEMOND_SEED', expect.anything())
    expect((await instance.startProcess('x')).runtime).toBe('daemond')
  })

  it('rejects an unknown processRuntime', () => {
    expect(() => defineProvider({ name: 'p', methods: { instances: methods() } })({ processRuntime: 'node' as never })).toThrow(/processRuntime/)
  })
})
