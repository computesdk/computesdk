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
    await buildProgram().parseAsync(['sandboxes', 'exec', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'uname', '-a'], { from: 'user' });
    expect(post).toHaveBeenCalledWith('/api/v1/sandboxes/a1b2c3d4-e5f6-7890-abcd-ef1234567890/commands', {
      command: `'uname' '-a'`,
    });
  });

  it('spawn <id> node -e "…" keeps -e in the command and env empty', async () => {
    await buildProgram().parseAsync(['sandboxes', 'spawn', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'node', '-e', 'console.log(1)'], { from: 'user' });
    expect(post).toHaveBeenCalledWith('/api/v1/sandboxes/a1b2c3d4-e5f6-7890-abcd-ef1234567890/processes', {
      command: `'node' '-e' 'console.log(1)'`,
    });
  });

  it('spawn <id> -e FOO=bar --cwd /app -- npm run dev splits options from the command', async () => {
    await buildProgram().parseAsync(
      ['sandboxes', 'spawn', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '-e', 'FOO=bar', '--cwd', '/app', '--', 'npm', 'run', 'dev'],
      { from: 'user' },
    );
    expect(post).toHaveBeenCalledWith('/api/v1/sandboxes/a1b2c3d4-e5f6-7890-abcd-ef1234567890/processes', {
      command: `'npm' 'run' 'dev'`,
      cwd: '/app',
      env: { FOO: 'bar' },
    });
  });

  it('exec <id> --json -- ls -la prints JSON with the full command', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await buildProgram().parseAsync(['sandboxes', 'exec', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '--json', '--', 'ls', '-la'], { from: 'user' });
    } finally {
      const printed = write.mock.calls.map((c) => String(c[0])).join('');
      write.mockRestore();
      expect(printed).toContain('"commandId": "c1"');
    }
    expect(post).toHaveBeenCalledWith('/api/v1/sandboxes/a1b2c3d4-e5f6-7890-abcd-ef1234567890/commands', {
      command: `'ls' '-la'`,
    });
  });

  it('options before the sandbox id still parse', async () => {
    await buildProgram().parseAsync(['sandboxes', 'exec', '--timeout-ms', '5000', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'uname', '-a'], { from: 'user' });
    expect(post).toHaveBeenCalledWith('/api/v1/sandboxes/a1b2c3d4-e5f6-7890-abcd-ef1234567890/commands', {
      command: `'uname' '-a'`,
      timeoutMs: 5000,
    });
  });

  it('spawn <id> -eFOO=bar cmd accepts the attached short-option value', async () => {
    await buildProgram().parseAsync(['sandboxes', 'spawn', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '-eFOO=bar', 'cmd'], { from: 'user' });
    expect(post).toHaveBeenCalledWith('/api/v1/sandboxes/a1b2c3d4-e5f6-7890-abcd-ef1234567890/processes', {
      command: `'cmd'`,
      env: { FOO: 'bar' },
    });
  });

  it('exec <id> -- --flaggy-command sends a dash-prefixed command through', async () => {
    await buildProgram().parseAsync(['sandboxes', 'exec', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '--', '-command'], { from: 'user' });
    expect(post).toHaveBeenCalledWith('/api/v1/sandboxes/a1b2c3d4-e5f6-7890-abcd-ef1234567890/commands', {
      command: `'-command'`,
    });
  });

  it('a --json after the sandbox id still yields a JSON error envelope', async () => {
    post.mockRejectedValueOnce(new Error('boom'));
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      await buildProgram().parseAsync(['sandboxes', 'exec', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '--json', 'uname'], { from: 'user' });
    } finally {
      const printed = write.mock.calls.map((c) => String(c[0])).join('');
      write.mockRestore();
      exit.mockRestore();
      expect(printed.trim().startsWith('{')).toBe(true);
    }
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

const ID_A = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const ID_B = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const EXITED = { ...proc, status: 'exited', exitCode: 0, stdout: 'hi\n', stderr: '' };

const sandbox = {
  id: ID_A, label: 'my-app', provider: 'e2b', providerSandboxId: 'psb1',
  status: 'running', placementAttempts: [], commandCount: 2, secrets: [],
  requestedImage: null, image: 'img', createdAt: '2026-10-27T14:02:00Z',
  lastCommandAt: null, destroyedAt: null, destroyError: null,
  placement: {
    source: 'market', size: 'medium', orderType: 'market',
    rate: { usd: 0.12, per: 'hour' },
    box: { provider: 'e2b', sizeName: 'medium', resources: { cpus: 2, memoryMb: 4096, ephemeralDiskMb: null } },
  },
  cost: { rate: { usd: 0.12, unit: 'hour' }, runtimeSeconds: 60, costUsd: 0.002, settled: false },
};

describe('current instance resolution', () => {
  const tmp = '/tmp/cli-state-test';
  beforeEach(async () => {
    post.mockReset();
    fakeClient.get.mockReset();
    fakeClient.del.mockReset();
    process.env.BENCHSDK_STATE_DIR = tmp;
    delete process.env.COMPUTE_INSTANCE;
    const { _resetStateFileForTests } = await import('../current-instance.js');
    _resetStateFileForTests();
    post.mockImplementation(async (path: string) =>
      path.endsWith('/commands')
        ? { commandId: 'c1', exitCode: 0, stdout: '', stderr: '', durationMs: 1 }
        : path.includes('/wait')
          ? { process: EXITED }
          : { process: proc },
    );
  });

  it('exec with no ID errors with the no-instance hint', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      await buildProgram().parseAsync(['sandboxes', 'exec', 'uname', '-a'], { from: 'user' });
    } finally {
      expect(exit).toHaveBeenCalledWith(1);
      err.mockRestore();
      exit.mockRestore();
    }
  });

  it('COMPUTE_INSTANCE supplies the sandbox id', async () => {
    process.env.COMPUTE_INSTANCE = ID_B;
    await buildProgram().parseAsync(['sandboxes', 'exec', 'uname', '-a'], { from: 'user' });
    expect(post).toHaveBeenCalledWith(`/api/v1/sandboxes/${ID_B}/commands`, {
      command: `'uname' '-a'`,
    });
  });

  it('use <id> stores the pick; a later exec uses it', async () => {
    fakeClient.get.mockResolvedValueOnce({ sandbox });
    await buildProgram().parseAsync(['sandboxes', 'use', ID_A], { from: 'user' });
    expect(fakeClient.get).toHaveBeenCalledWith(`/api/v1/sandboxes/${ID_A}`);
    await buildProgram().parseAsync(['sandboxes', 'exec', 'uname'], { from: 'user' });
    expect(post).toHaveBeenCalledWith(`/api/v1/sandboxes/${ID_A}/commands`, {
      command: `'uname'`,
    });
  });

  it('use <id> refuses a destroyed instance', async () => {
    fakeClient.get.mockResolvedValueOnce({ sandbox: { ...sandbox, status: 'destroyed' } });
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      await buildProgram().parseAsync(['sandboxes', 'use', ID_A], { from: 'user' });
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      exit.mockRestore();
    }
  });

  it('create sets the current instance; destroy clears it', async () => {
    post.mockResolvedValueOnce({ sandbox });
    await buildProgram().parseAsync(['sandboxes', 'create'], { from: 'user' });
    const { readFileCurrent, orgKey } = await import('../current-instance.js');
    expect(readFileCurrent(orgKey({}))).toBe(ID_A);
    fakeClient.del.mockResolvedValueOnce({ sandbox: { ...sandbox, status: 'destroyed' } });
    await buildProgram().parseAsync(['sandboxes', 'destroy'], { from: 'user' });
    expect(fakeClient.del).toHaveBeenCalledWith(`/api/v1/sandboxes/${ID_A}`);
    expect(readFileCurrent(orgKey({}))).toBeUndefined();
  });

  it('use --clear forgets the stored pick', async () => {
    const { setCurrentInstance, readFileCurrent, orgKey } = await import('../current-instance.js');
    setCurrentInstance(ID_A, orgKey({}));
    await buildProgram().parseAsync(['sandboxes', 'use', '--clear'], { from: 'user' });
    expect(readFileCurrent(orgKey({}))).toBeUndefined();
  });
});

describe('quiet and verbose output', () => {
  beforeEach(async () => {
    post.mockReset();
    fakeClient.get.mockReset();
    process.env.BENCHSDK_STATE_DIR = '/tmp/cli-state-test';
    const { _resetStateFileForTests } = await import('../current-instance.js');
    _resetStateFileForTests();
  });

  it('create -q prints only the instance ID', async () => {
    post.mockResolvedValueOnce({ sandbox });
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await buildProgram().parseAsync(['sandboxes', 'create', '-q', '--no-use'], { from: 'user' });
      const lines = out.mock.calls.map((c) => String(c[0]));
      expect(lines).toEqual([ID_A]);
      const { readFileCurrent, orgKey } = await import('../current-instance.js');
      expect(readFileCurrent(orgKey({}))).toBeUndefined();
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });

  it('create --quiet --json is a usage error', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      await buildProgram().parseAsync(['sandboxes', 'create', '-q', '--json'], { from: 'user' });
      expect(exit).toHaveBeenCalledWith(1);
      expect(post).not.toHaveBeenCalled();
    } finally {
      err.mockRestore();
      exit.mockRestore();
    }
  });

  it('the compact line shows id, status, provider, size, rate', async () => {
    fakeClient.get.mockResolvedValueOnce({ sandbox });
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await buildProgram().parseAsync(['sandboxes', 'get', ID_A], { from: 'user' });
      const line1 = String(out.mock.calls[0]?.[0]);
      expect(line1).toContain(ID_A);
      expect(line1).toContain('running');
      expect(line1).toContain('e2b');
      expect(line1).toContain('medium');
      expect(line1).toContain('$0.12/h');
      expect(String(out.mock.calls[1]?.[0])).toContain('label: my-app');
    } finally {
      out.mockRestore();
    }
  });

  it('spawn -q prints only the job ID', async () => {
    post.mockResolvedValueOnce({ process: proc });
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await buildProgram().parseAsync(['sandboxes', 'spawn', ID_A, '-q', '--', 'npm', 'start'], { from: 'user' });
      expect(out.mock.calls.map((c) => String(c[0]))).toEqual(['j1']);
    } finally {
      out.mockRestore();
    }
  });
});

describe('run', () => {
  beforeEach(async () => {
    post.mockReset();
    fakeClient.del.mockReset();
    fakeClient.get.mockReset();
    process.env.BENCHSDK_STATE_DIR = '/tmp/cli-state-test';
    const { _resetStateFileForTests } = await import('../current-instance.js');
    _resetStateFileForTests();
  });

  it('run -- cmd creates, spawns, waits, destroys — exit code passes through', async () => {
    post.mockImplementation(async (path: string) => {
      if (path === '/api/v1/sandboxes') return { sandbox };
      if (path.endsWith('/processes')) return { process: proc };
      if (path.endsWith('/wait')) return { process: { ...EXITED, exitCode: 1 } };
      return {};
    });
    fakeClient.del.mockResolvedValueOnce({ sandbox: { ...sandbox, status: 'destroyed' } });
    const prev = process.exitCode;
    await buildProgram().parseAsync(['sandboxes', 'run', '--', 'false'], { from: 'user' });
    expect(post).toHaveBeenCalledWith('/api/v1/sandboxes', {});
    expect(post).toHaveBeenCalledWith(`/api/v1/sandboxes/${ID_A}/processes`, { command: `'false'` });
    expect(fakeClient.del).toHaveBeenCalledWith(`/api/v1/sandboxes/${ID_A}`);
    expect(process.exitCode).toBe(1);
    process.exitCode = prev;
  });

  it('run -d detaches: no wait, no destroy, summary printed', async () => {
    post.mockImplementation(async (path: string) => {
      if (path === '/api/v1/sandboxes') return { sandbox };
      if (path.endsWith('/processes')) return { process: proc };
      throw new Error('unexpected ' + path);
    });
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await buildProgram().parseAsync(['sandboxes', 'run', '-d', '--timeout-ms', '3600000', '--', 'sleep', '600'], { from: 'user' });
      const text = out.mock.calls.map((c) => String(c[0])).join('\n');
      expect(text).toContain('job j1');
      expect(text).toContain('instance timeout: 1h');
      expect(text).toContain(`logs j1`);
      expect(fakeClient.del).not.toHaveBeenCalled();
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
    const { readFileCurrent, orgKey } = await import('../current-instance.js');
    expect(readFileCurrent(orgKey({}))).toBe(ID_A);
  });

  it('run --keep waits, does not destroy, becomes current', async () => {
    post.mockImplementation(async (path: string) => {
      if (path === '/api/v1/sandboxes') return { sandbox };
      if (path.endsWith('/processes')) return { process: proc };
      if (path.endsWith('/wait')) return { process: EXITED };
      return {};
    });
    await buildProgram().parseAsync(['sandboxes', 'run', '--keep', '--', 'true'], { from: 'user' });
    expect(fakeClient.del).not.toHaveBeenCalled();
    const { readFileCurrent, orgKey } = await import('../current-instance.js');
    expect(readFileCurrent(orgKey({}))).toBe(ID_A);
  });

  it('run --keep destroys the instance when the wait fails', async () => {
    post.mockImplementation(async (path: string) => {
      if (path === '/api/v1/sandboxes') return { sandbox };
      if (path.endsWith('/processes')) return { process: proc };
      if (path.endsWith('/wait')) throw new Error('connection dropped');
      return {};
    });
    fakeClient.del.mockResolvedValueOnce({ sandbox: { ...sandbox, status: 'destroyed' } });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      await buildProgram().parseAsync(['sandboxes', 'run', '--keep', '--', 'true'], { from: 'user' });
      expect(exit).toHaveBeenCalledWith(1);
      expect(fakeClient.del).toHaveBeenCalledWith(`/api/v1/sandboxes/${ID_A}`);
    } finally {
      err.mockRestore();
      exit.mockRestore();
    }
    const { readFileCurrent, orgKey } = await import('../current-instance.js');
    expect(readFileCurrent(orgKey({}))).toBeUndefined();
  });

  it('logs <uuid-job> resolves the implicit instance', async () => {
    const { setCurrentInstance, orgKey } = await import('../current-instance.js');
    setCurrentInstance(ID_A, orgKey({}));
    const JOB_UUID = 'f1e2d3c4-b5a6-7890-aaaa-bbbbccccdddd';
    fakeClient.get.mockResolvedValueOnce({ process: { ...proc, jobId: JOB_UUID, status: 'exited', exitCode: 0 } });
    await buildProgram().parseAsync(['sandboxes', 'logs', JOB_UUID], { from: 'user' });
    expect(fakeClient.get).toHaveBeenCalledWith(`/api/v1/sandboxes/${ID_A}/processes/${JOB_UUID}`);
  });

  it('run --keep -d is a usage error', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      await buildProgram().parseAsync(['sandboxes', 'run', '--keep', '-d', '--', 'true'], { from: 'user' });
      expect(exit).toHaveBeenCalledWith(1);
      expect(post).not.toHaveBeenCalled();
    } finally {
      err.mockRestore();
      exit.mockRestore();
    }
  });
});

describe('serve', () => {
  const TMP = '/tmp/cli-state-test';
  beforeEach(() => {
    post.mockReset();
    fakeClient.get.mockReset();
    process.env.BENCHSDK_STATE_DIR = TMP;
  });

  function mockServe(ports: { port: number; address: string; public: boolean }[], url = 'https://3000-x.dev'): void {
    post.mockImplementation(async (path: string) =>
      path.endsWith('/processes') ? { process: proc } : {},
    );
    fakeClient.get.mockImplementation(async (path: string) => {
      if (path.includes('/ports')) return { ports, waited: true, found: ports.length > 0 };
      if (path.includes('/urls')) return { url };
      return { process: proc };
    });
  }

  it('waits for the port then prints the URL and job footer', async () => {
    mockServe([{ port: 3000, address: '0.0.0.0', public: true }]);
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await buildProgram().parseAsync(
        ['sandboxes', 'serve', ID_A, '--port', '3000', '--', 'python3', '-m', 'http.server', '3000'],
        { from: 'user' },
      );
      expect(fakeClient.get).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/sandboxes/${ID_A}/ports?wait=3000`),
      );
      expect(out.mock.calls.map((c) => String(c[0]))).toContain('https://3000-x.dev');
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });

  it('-q prints only the URL', async () => {
    mockServe([{ port: 3000, address: '0.0.0.0', public: true }]);
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await buildProgram().parseAsync(
        ['sandboxes', 'serve', ID_A, '--port', '3000', '-q', '--', 'python3', '-m', 'http.server', '3000'],
        { from: 'user' },
      );
      expect(out.mock.calls.map((c) => String(c[0]))).toEqual(['https://3000-x.dev']);
    } finally {
      out.mockRestore();
    }
  });

  it('fails with the bind hint when the port is loopback-only', async () => {
    mockServe([{ port: 3000, address: '127.0.0.1', public: false }]);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      await buildProgram().parseAsync(
        ['sandboxes', 'serve', ID_A, '--port', '3000', '--', 'python3', '-m', 'http.server', '3000', '--bind', '127.0.0.1'],
        { from: 'user' },
      );
      const text = err.mock.calls.map((c) => String(c[0])).join('');
      expect(text).toContain('127.0.0.1 only');
      expect(text).toContain('0.0.0.0');
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      err.mockRestore();
      exit.mockRestore();
    }
  });

  it('fails with the exit code when the server dies first', async () => {
    post.mockImplementation(async (path: string) =>
      path.endsWith('/processes') ? { process: proc } : {},
    );
    fakeClient.get.mockImplementation(async (path: string) => {
      if (path.includes('/ports')) return { ports: [], waited: true, found: false };
      return { process: { ...EXITED, exitCode: 2, stdout: 'traceback\n' } };
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      await buildProgram().parseAsync(
        ['sandboxes', 'serve', ID_A, '--port', '3000', '--', 'python3', 'bad.py'],
        { from: 'user' },
      );
      const text = err.mock.calls.map((c) => String(c[0])).join('');
      expect(text).toContain('exited (code 2)');
      expect(text).toContain('traceback');
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      err.mockRestore();
      exit.mockRestore();
    }
  });

  it('fails instead of printing a URL when the port is owned by a stale listener', async () => {
    mockServe([{ port: 3000, address: '0.0.0.0', public: true }]);
    fakeClient.get.mockImplementation(async (path: string) => {
      if (path.includes('/ports')) return { ports: [{ port: 3000, address: '0.0.0.0', public: true }] };
      return { process: { ...EXITED, exitCode: 1 } };
    });
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      await buildProgram().parseAsync(
        ['sandboxes', 'serve', ID_A, '--port', '3000', '--', 'python3', 'bad.py'],
        { from: 'user' },
      );
      expect(exit).toHaveBeenCalledWith(1);
      expect(out.mock.calls.map((c) => String(c[0])).join('')).not.toContain('https://3000');
    } finally {
      out.mockRestore();
      exit.mockRestore();
    }
  });
});
