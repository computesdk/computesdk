/**
 * Mock-based unit tests for the Tenki provider. These run without credentials
 * and exercise option mapping, shell wrapping, status mapping, the native
 * filesystem path, and not-found handling. Integration coverage lives in
 * index.test.ts via the standard provider test suite.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const enc = new TextEncoder();

class SessionNotFoundError extends Error {}

let lastCreateOptions: any = null;
let lastExec: { command: string; args?: string[]; env?: Record<string, string> } | null = null;
let execOutputChunks: Array<{ data: Uint8Array; isStderr: boolean }> | null = null;

class FakeSession {
  id = 'sbx_123';
  name = 'test-sandbox';
  state = 'RUNNING';
  cpuCores = 2;
  memoryMb = 4096;
  diskSizeGb = 10;
  projectId = 'proj_1';
  tags: string[] = [];
  timeoutAt = new Date(Date.now() + 3_600_000);
  closed = false;
  private files = new Map<string, Uint8Array>();
  private dirs = new Set<string>(['/work']);

  async exec(command: string, options?: any) {
    lastExec = { command, args: options?.args, env: options?.env };
    const line: string = options?.args?.[1] ?? '';
    // Emulate `test -e "<path>"` against the fake filesystem.
    const testMatch = line.match(/^test -e "(.+)"$/);
    if (testMatch) {
      const path = testMatch[1];
      const exitCode = this.files.has(path) || this.dirs.has(path) ? 0 : 1;
      return { stdout: new Uint8Array(), stderr: new Uint8Array(), exitCode, durationMs: 1 };
    }
    if (execOutputChunks) {
      const chunks = execOutputChunks;
      const total = chunks.reduce((n, c) => n + c.data.length, 0);
      const stdout = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        options?.onOutput?.({ data: chunk.data, isStderr: chunk.isStderr, isFinal: false });
        if (!chunk.isStderr) {
          stdout.set(chunk.data, offset);
          offset += chunk.data.length;
        }
      }
      return { stdout: stdout.slice(0, offset), stderr: new Uint8Array(), exitCode: 0, durationMs: 12 };
    }
    const stdout = enc.encode('hello\n');
    options?.onOutput?.({ data: stdout, isStderr: false, isFinal: true });
    return { stdout, stderr: new Uint8Array(), exitCode: 0, durationMs: 12 };
  }

  async exposePort(port: number) {
    return { port, previewUrl: `https://sbx-123-${port}.sb.tenki.sh` };
  }

  async writeFile(path: string, data: Uint8Array | string) {
    this.files.set(path, typeof data === 'string' ? enc.encode(data) : data);
  }
  async readFile(path: string): Promise<Uint8Array> {
    const v = this.files.get(path);
    if (!v) throw new Error('not found');
    return v;
  }
  async mkdir(path: string) {
    this.dirs.add(path);
  }
  async remove(path: string) {
    this.files.delete(path);
    this.dirs.delete(path);
  }
  async stat(path: string) {
    if (!this.files.has(path) && !this.dirs.has(path)) throw new Error('not found');
    return {
      path,
      size: BigInt(this.files.get(path)?.length ?? 0),
      mode: 0o644,
      isDir: this.dirs.has(path),
      modifiedUnixNs: 1_700_000_000_000_000_000n,
    };
  }
  async list(_path: string) {
    return [
      { path: '/work/a.txt', size: 5n, mode: 0o644, isDir: false, modifiedUnixNs: 1_700_000_000_000_000_000n },
      { path: '/work/sub', size: 0n, mode: 0o755, isDir: true, modifiedUnixNs: 1_700_000_000_000_000_000n },
    ];
  }
  async close() {
    this.closed = true;
  }
}

let shouldNotFind = false;
const sharedSession = new FakeSession();

class FakeTenkiSandbox {
  constructor(public options: any) {}
  async whoAmI() {
    return {
      ownerType: 'USER',
      ownerId: 'user_1',
      workspaces: [{ id: 'ws_1', name: 'WS', projects: [{ id: 'proj_1', name: 'P' }] }],
    };
  }
  async createAndWait(opts: any) {
    lastCreateOptions = opts;
    return sharedSession;
  }
  async get(id: string) {
    if (shouldNotFind) throw new SessionNotFoundError('nope');
    if (id === 'malformed') {
      // The live API rejects non-UUID ids with a validation error before lookup.
      throw new Error('[invalid_argument] validation error:\n - session_id: value must be a valid UUID [string.uuid]');
    }
    return sharedSession;
  }
  async list() {
    return [sharedSession];
  }
}

vi.mock('@tenkicloud/sandbox', () => ({
  TenkiSandbox: FakeTenkiSandbox,
  Session: FakeSession,
  SessionNotFoundError,
  stdoutText: (r: any) => new TextDecoder().decode(r.stdout).trim(),
  stderrText: (r: any) => new TextDecoder().decode(r.stderr).trim(),
}));

// Import lazily so the hoisted vi.mock factory's classes are initialized first.
let tenki: typeof import('../index').tenki;

describe('tenki provider (mocked SDK)', () => {
  beforeAll(async () => {
    ({ tenki } = await import('../index'));
  });

  beforeEach(() => {
    lastCreateOptions = null;
    lastExec = null;
    execOutputChunks = null;
    shouldNotFind = false;
    sharedSession.closed = false;
  });

  it('has the right name', () => {
    expect(tenki({ apiKey: 'tk_test' }).name).toBe('tenki');
  });

  it('create resolves scope via whoAmI and maps options', async () => {
    const provider = tenki({ apiKey: 'tk_test', memoryMb: 8192 });
    const sandbox = await provider.sandbox.create({
      envs: { NODE_ENV: 'production' },
      timeout: 60_000,
    });
    expect(sandbox.sandboxId).toBe('sbx_123');
    expect(lastCreateOptions).toMatchObject({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      env: { NODE_ENV: 'production' },
      maxDurationMs: 60_000,
      memoryMb: 8192,
    });
  });

  it('explicit workspace/project skips whoAmI resolution', async () => {
    const provider = tenki({ apiKey: 'tk_test', workspaceId: 'ws_x', projectId: 'proj_x' });
    await provider.sandbox.create();
    expect(lastCreateOptions).toMatchObject({ workspaceId: 'ws_x', projectId: 'proj_x' });
  });

  it('runCommand wraps the command in sh -lc', async () => {
    const provider = tenki({ apiKey: 'tk_test' });
    const sandbox = await provider.sandbox.create();
    const result = await sandbox.runCommand('echo "hello"');
    expect(lastExec?.command).toBe('sh');
    expect(lastExec?.args).toEqual(['-lc', 'echo "hello"']);
    expect(result.stdout).toBe('hello');
    expect(result.exitCode).toBe(0);
  });

  it('runCommand honors cwd by prefixing a quoted cd', async () => {
    const provider = tenki({ apiKey: 'tk_test' });
    const sandbox = await provider.sandbox.create();
    await sandbox.runCommand('ls', { cwd: '/work' });
    expect(lastExec?.args?.[1]).toBe("cd '/work' && ls");
  });

  it('runCommand passes per-command env vars through to exec', async () => {
    const provider = tenki({ apiKey: 'tk_test' });
    const sandbox = await provider.sandbox.create();
    await sandbox.runCommand('printenv FOO', { env: { FOO: 'bar baz', QUOTED: `it's "quoted"` } });
    // Env goes through Tenki's native exec env (execve), not shell prefixing,
    // so values need no escaping and arrive verbatim.
    expect(lastExec?.env).toEqual({ FOO: 'bar baz', QUOTED: `it's "quoted"` });
    expect(lastExec?.args).toEqual(['-lc', 'printenv FOO']);
  });

  it('background commands also receive per-command env vars', async () => {
    const provider = tenki({ apiKey: 'tk_test' });
    const sandbox = await provider.sandbox.create();
    await sandbox.runCommand('server --start', { background: true, env: { PORT: '3000' } });
    expect(lastExec?.env).toEqual({ PORT: '3000' });
  });

  it('reassembles multi-byte UTF-8 characters split across output chunks', async () => {
    const provider = tenki({ apiKey: 'tk_test' });
    const sandbox = await provider.sandbox.create();

    // "héllo🌍" with the é (2 bytes) and 🌍 (4 bytes) split across chunks.
    const bytes = enc.encode('héllo🌍');
    execOutputChunks = [
      { data: bytes.slice(0, 2), isStderr: false }, // 'h' + first byte of é
      { data: bytes.slice(2, 8), isStderr: false }, // rest of é + 'llo' + first byte of 🌍
      { data: bytes.slice(8), isStderr: false }, // rest of 🌍
    ];

    // The computesdk factory reroutes onStdout/onStderr through its in-sandbox
    // daemon, so to exercise the provider-level decoder we call the provider's
    // runCommand method directly.
    const runCommand = (provider.sandbox as any).methods.runCommand;
    const streamed: string[] = [];
    await runCommand(sandbox.getInstance(), 'echo international', {
      onStdout: (chunk: string) => streamed.push(chunk),
    });
    expect(streamed.join('')).toBe('héllo🌍');
    expect(streamed.join('')).not.toContain('�');
  });

  it('background commands are detached from the output stream', async () => {
    const provider = tenki({ apiKey: 'tk_test' });
    const sandbox = await provider.sandbox.create();
    const result = await sandbox.runCommand('python3 -m http.server 3000', { background: true });
    expect(lastExec?.args?.[1]).toContain('>/dev/null 2>&1 </dev/null &');
    expect(result.exitCode).toBe(0);
  });

  it('getInfo reports tenki provider and running status', async () => {
    const provider = tenki({ apiKey: 'tk_test' });
    const sandbox = await provider.sandbox.create();
    const info = await sandbox.getInfo();
    expect(info.provider).toBe('tenki');
    expect(info.status).toBe('running');
    expect(info.id).toBe('sbx_123');
    expect(info.createdAt).toBeInstanceOf(Date);
  });

  it('getUrl exposes the port and returns the preview URL', async () => {
    const provider = tenki({ apiKey: 'tk_test' });
    const sandbox = await provider.sandbox.create();
    expect(await sandbox.getUrl({ port: 3000 })).toBe('https://sbx-123-3000.sb.tenki.sh');
  });

  it('filesystem round-trips through native Tenki fs', async () => {
    const provider = tenki({ apiKey: 'tk_test' });
    const sandbox = await provider.sandbox.create();

    await sandbox.filesystem.writeFile('/work/a.txt', 'data');
    expect(await sandbox.filesystem.readFile('/work/a.txt')).toBe('data');
    expect(await sandbox.filesystem.exists('/work/a.txt')).toBe(true);
    expect(await sandbox.filesystem.exists('/work/missing')).toBe(false);

    const entries = await sandbox.filesystem.readdir('/work');
    expect(entries).toEqual([
      expect.objectContaining({ name: 'a.txt', type: 'file', size: 5 }),
      expect.objectContaining({ name: 'sub', type: 'directory' }),
    ]);

    await sandbox.filesystem.remove('/work/a.txt');
    expect(await sandbox.filesystem.exists('/work/a.txt')).toBe(false);
  });

  it('getById returns null when the session is not found', async () => {
    shouldNotFind = true;
    const provider = tenki({ apiKey: 'tk_test' });
    expect(await provider.sandbox.getById('nope')).toBeNull();
  });

  it('getById returns null for malformed (non-UUID) ids', async () => {
    const provider = tenki({ apiKey: 'tk_test' });
    expect(await provider.sandbox.getById('malformed')).toBeNull();
  });

  it('destroy closes the session and tolerates already-gone sandboxes', async () => {
    const provider = tenki({ apiKey: 'tk_test' });
    const sandbox = await provider.sandbox.create();
    await sandbox.destroy();
    expect(sharedSession.closed).toBe(true);

    shouldNotFind = true;
    await expect(provider.sandbox.destroy('gone')).resolves.toBeUndefined();
  });

  it('throws a helpful error when no API key is configured', async () => {
    const saved = { key: process.env.TENKI_API_KEY, token: process.env.TENKI_AUTH_TOKEN };
    delete process.env.TENKI_API_KEY;
    delete process.env.TENKI_AUTH_TOKEN;
    try {
      const provider = tenki({});
      await expect(provider.sandbox.create()).rejects.toThrow(/Missing API key for Tenki/);
    } finally {
      if (saved.key) process.env.TENKI_API_KEY = saved.key;
      if (saved.token) process.env.TENKI_AUTH_TOKEN = saved.token;
    }
  });
});
