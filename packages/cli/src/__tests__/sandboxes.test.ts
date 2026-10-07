import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const post = vi.fn(async (_path: string, _body: unknown): Promise<unknown> => ({}));
const fakeClient = { post, get: vi.fn(), del: vi.fn() };

vi.mock('../actions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../actions.js')>();
  return { ...actual, client: vi.fn(async () => fakeClient) };
});

const { registerSandboxesCommands, takeLeadingOptions } = await import('../sandboxes.js');

function buildProgram(): Command {
  const program = new Command().enablePositionalOptions().passThroughOptions().exitOverride();
  registerSandboxesCommands(program);
  return program;
}

const proc = {
  id: 'p1', jobId: 'j1', pid: 123, command: 'x', cwd: null, envNames: [],
  stdin: false, status: 'running', exitCode: null, signal: null,
  startedAt: 't', exitedAt: null,
};

describe('exec/spawn pass-through command flags', () => {
  beforeEach(() => {
    post.mockReset();
    post.mockImplementation(async (path: string) =>
      path.endsWith('/commands')
        ? { commandId: 'c1', exitCode: 0, stdout: '', stderr: '', durationMs: 1 }
        : { process: proc },
    );
  });

  it('exec <id> uname -a sends the flag to the sandbox', async () => {
    await buildProgram().parseAsync(['sandboxes', 'exec', 'sb1', 'uname', '-a'], { from: 'user' });
    expect(post).toHaveBeenCalledWith('/api/v1/sandboxes/sb1/commands', {
      command: `'uname' '-a'`,
    });
  });

  it('spawn <id> node -e "…" keeps -e in the command and env empty', async () => {
    await buildProgram().parseAsync(['sandboxes', 'spawn', 'sb1', 'node', '-e', 'console.log(1)'], { from: 'user' });
    expect(post).toHaveBeenCalledWith('/api/v1/sandboxes/sb1/processes', {
      command: `'node' '-e' 'console.log(1)'`,
    });
  });

  it('spawn <id> -e FOO=bar --cwd /app -- npm run dev splits options from the command', async () => {
    await buildProgram().parseAsync(
      ['sandboxes', 'spawn', 'sb1', '-e', 'FOO=bar', '--cwd', '/app', '--', 'npm', 'run', 'dev'],
      { from: 'user' },
    );
    expect(post).toHaveBeenCalledWith('/api/v1/sandboxes/sb1/processes', {
      command: `'npm' 'run' 'dev'`,
      cwd: '/app',
      env: { FOO: 'bar' },
    });
  });

  it('exec <id> --json -- ls -la prints JSON with the full command', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await buildProgram().parseAsync(['sandboxes', 'exec', 'sb1', '--json', '--', 'ls', '-la'], { from: 'user' });
    } finally {
      const printed = write.mock.calls.map((c) => String(c[0])).join('');
      write.mockRestore();
      expect(printed).toContain('"commandId": "c1"');
    }
    expect(post).toHaveBeenCalledWith('/api/v1/sandboxes/sb1/commands', {
      command: `'ls' '-la'`,
    });
  });

  it('options before the sandbox id still parse', async () => {
    await buildProgram().parseAsync(['sandboxes', 'exec', '--timeout-ms', '5000', 'sb1', 'uname', '-a'], { from: 'user' });
    expect(post).toHaveBeenCalledWith('/api/v1/sandboxes/sb1/commands', {
      command: `'uname' '-a'`,
      timeoutMs: 5000,
    });
  });
});

describe('takeLeadingOptions', () => {
  const specs = [
    { aliases: ['--json'], key: 'json', flag: 'bool' as const },
    { aliases: ['-e', '--env'], key: 'env', flag: 'repeat' as const },
    { aliases: ['--cwd'], key: 'cwd', flag: 'value' as const },
  ];

  it('leaves a bare command untouched', () => {
    expect(takeLeadingOptions(['uname', '-a'], specs)).toEqual({
      command: ['uname', '-a'],
      inline: {},
    });
  });

  it('parses leading options then stops at the command', () => {
    expect(takeLeadingOptions(['-e', 'A=1', '--env=B=2', '--cwd', '/x', 'ls', '-la', '--json'], specs)).toEqual({
      command: ['ls', '-la', '--json'],
      inline: { env: ['A=1', 'B=2'], cwd: '/x' },
    });
  });

  it('consumes a bare -- separator', () => {
    expect(takeLeadingOptions(['--json', '--', 'npm', 'run'], specs)).toEqual({
      command: ['npm', 'run'],
      inline: { json: true },
    });
  });

  it('rejects an unknown leading flag', () => {
    expect(() => takeLeadingOptions(['--bogus', 'ls'], specs)).toThrow(/unknown option '--bogus'/);
  });
});
