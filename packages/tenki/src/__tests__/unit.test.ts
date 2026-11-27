/**
 * Mock-based unit tests for the Luxor provider (package/provider id remain Tenki). These run without credentials
 * and exercise option mapping, shell wrapping, status mapping, the native
 * filesystem path, and not-found handling. Integration coverage lives in
 * index.test.ts via the standard provider test suite.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const enc = new TextEncoder();

class SessionNotFoundError extends Error {}

let lastCreateOptions: any = null;
let lastClientOptions: any = null;
let lastExec: { command: string; args?: string[]; env?: Record<string, string> } | null = null;
let execOutputChunks: Array<{ data: Uint8Array; isStderr: boolean }> | null = null;

class FakeSession {
  id = 'sbx_123';
  name = 'test-sandbox';
  state = 'RUNNING';
  cpuCores = 2;
  memoryMb = 4096;
  diskSizeGb = 10;
  workspaceId = 'ws_1';
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
    if (path.startsWith('/tmp/')) throw new Error(`[permission_denied] guest_error: path outside workdir: ${path} (workdir: /home/tenki)`);
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
  async pause() {
    this.state = 'PAUSING';
  }
  async waitPaused() {
    this.state = 'PAUSED';
  }
  async resume() {
    this.state = 'RESUMING';
  }
  async waitResumed() {
    this.state = 'RUNNING';
  }
}

let shouldNotFind = false;
const sharedSession = new FakeSession();

class FakeLuxorSandbox {
  constructor(public options: any) {
    lastClientOptions = options;
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
  async createSnapshotAndWait(sessionId: string, opts: any) {
    lastSnapshotCall = { sessionId, opts };
    return { id: 'snap_1', sessionId, state: 'READY', createdAt: new Date(0) };
  }
  async listSessionSnapshots(sessionId: string) {
    return [{ id: `snap_of_${sessionId}`, createdAt: new Date(0) }];
  }
  async listSnapshots() {
    return [{ id: 'snap_a', createdAt: new Date(0) }, { id: 'snap_b', createdAt: new Date(0) }];
  }
  async deleteSnapshot(snapshotId: string) {
    lastSnapshotCall = { deleted: snapshotId };
    return { id: snapshotId };
  }
}

let lastSnapshotCall: any = null;

vi.mock('@luxorai/sandbox', () => ({
  LuxorSandbox: FakeLuxorSandbox,
  TenkiSandbox: FakeLuxorSandbox,
  Session: FakeSession,
  SessionNotFoundError,
  stdoutText: (r: any) => new TextDecoder().decode(r.stdout).trim(),
  stderrText: (r: any) => new TextDecoder().decode(r.stderr).trim(),
}));

// Import lazily so the hoisted vi.mock factory's classes are initialized first.
let luxor: typeof import('../index').luxor;
let tenki: typeof import('../index').tenki;

describe('luxor provider (mocked SDK)', () => {
  beforeAll(async () => {
    ({ luxor, tenki } = await import('../index'));
  });

  beforeEach(() => {
    lastCreateOptions = null;
    lastClientOptions = null;
    lastExec = null;
    execOutputChunks = null;
    shouldNotFind = false;
    sharedSession.closed = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('snapshot.create waits for READY and returns the snapshot id', async () => {
    const provider = tenki({ apiKey: 'tk_test' });
    const snap: any = await provider.snapshot!.create('sbx_123', { name: 'pre' });
    expect(snap.id).toBe('snap_1');
    expect(lastSnapshotCall).toEqual({ sessionId: 'sbx_123', opts: { name: 'pre' } });
  });

  it('snapshot.list scopes by instance, and delete forwards the id', async () => {
    const provider = tenki({ apiKey: 'tk_test' });
    expect((await provider.snapshot!.list({ instanceId: 'sbx_9' })).map((s: any) => s.id)).toEqual(['snap_of_sbx_9']);
    expect((await provider.snapshot!.list({ limit: 1 })).map((s: any) => s.id)).toEqual(['snap_a']);
    await provider.snapshot!.delete('snap_1');
    expect(lastSnapshotCall).toEqual({ deleted: 'snap_1' });
  });

  it('pauses and resumes through the native session, waiting for each state', async () => {
    const provider = tenki({ apiKey: 'tk_test' });
    expect(provider.sandbox.pause).toEqual({ memory: true });
    expect(provider.snapshot!.capabilities).toMatchObject({ scope: 'rootfs', memory: true, destroysSource: false });
    const sandbox = await provider.sandbox.create();
    await sandbox.pause!();
    expect(sharedSession.state).toBe('PAUSED');
    await sandbox.resume!();
    expect(sharedSession.state).toBe('RUNNING');
  });

  it('restores from a snapshot via create({ snapshotId })', async () => {
    const provider = tenki({ apiKey: 'tk_test' });
    await provider.sandbox.create({ snapshotId: 'snap_1' });
    expect(lastCreateOptions).toMatchObject({ snapshotId: 'snap_1' });
  });

  it('writeFile outside the workdir falls back to the shell', async () => {
    const provider = tenki({ apiKey: 'tk_test' });
    const sandbox = await provider.sandbox.create();
    const lines: string[] = [];
    const exec = vi.spyOn(sharedSession, 'exec').mockImplementation(async (_cmd: any, options: any) => {
      lines.push(options.args[1]);
      return { stdout: new Uint8Array(), stderr: new Uint8Array(), exitCode: 0, durationMs: 1 } as any;
    });
    await sandbox.filesystem.writeFile('/tmp/a b.txt', 'hi');
    expect(exec).toHaveBeenCalledTimes(2);
    expect(lines[0]).toBe(`mkdir -p "$(dirname '/tmp/a b.txt')" && : > '/tmp/a b.txt'`);
    expect(lines[1]).toBe(`printf '%s' '${Buffer.from('hi').toString('base64')}' | base64 -d >> '/tmp/a b.txt'`);
  });

  it('has the right name', () => {
    expect(tenki({ apiKey: 'tk_test' }).name).toBe('tenki');
  });

  it('creates with server-inferred scope and maps options', async () => {
    vi.stubEnv('TENKI_WORKSPACE_ID', '');
    const provider = tenki({ apiKey: 'tk_test', memoryMb: 8192 });
    const sandbox = await provider.sandbox.create({
      envs: { NODE_ENV: 'production' },
      timeout: 60_000,
    });
    expect(sandbox.sandboxId).toBe('sbx_123');
    expect(lastCreateOptions).toMatchObject({
      env: { NODE_ENV: 'production' },
      maxDurationMs: 60_000,
      memoryMb: 8192,
    });
    expect(lastCreateOptions).not.toHaveProperty('workspaceId');
  });

  it('passes an explicit workspace and ignores legacy project scope', async () => {
    const provider = tenki({ apiKey: 'tk_test', workspaceId: 'ws_x', projectId: 'proj_x' });
    await provider.sandbox.create();
    expect(lastCreateOptions).toMatchObject({ workspaceId: 'ws_x' });
    expect(lastCreateOptions).not.toHaveProperty('projectId');
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

  it.each([0, 137])('reports a timed-out command as failure when its exit code is %i', async (exitCode) => {
    const provider = tenki({ apiKey: 'tk_test' });
    const sandbox = await provider.sandbox.create();
    const exec = vi.spyOn(sharedSession, 'exec').mockResolvedValueOnce({
      status: 'TIMED_OUT',
      stdout: enc.encode('partial stdout'),
      stderr: enc.encode('partial stderr'),
      exitCode,
      durationMs: 100,
    } as Awaited<ReturnType<FakeSession['exec']>>);

    expect(await sandbox.runCommand('sleep 10', { timeout: 100 })).toEqual({
      stdout: 'partial stdout',
      stderr: 'partial stderr\nLuxor command timed out.',
      exitCode: 124,
      durationMs: 100,
    });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith('sh', expect.objectContaining({ timeoutMs: 100 }));
  });

  it('keeps normal nonzero exits and output unchanged', async () => {
    const provider = tenki({ apiKey: 'tk_test' });
    const sandbox = await provider.sandbox.create();
    vi.spyOn(sharedSession, 'exec').mockResolvedValueOnce({
      stdout: enc.encode('stdout'),
      stderr: enc.encode('stderr'),
      exitCode: 7,
      durationMs: 12,
    });
    expect(await sandbox.runCommand('exit 7')).toEqual({
      stdout: 'stdout', stderr: 'stderr', exitCode: 7, durationMs: 12,
    });
  });

  it('explains a timeout even when the guest produced no stderr', async () => {
    const provider = tenki({ apiKey: 'tk_test' });
    const sandbox = await provider.sandbox.create();
    vi.spyOn(sharedSession, 'exec').mockResolvedValueOnce({
      status: 'TIMED_OUT',
      stdout: new Uint8Array(),
      stderr: new Uint8Array(),
      exitCode: 0,
      durationMs: 100,
    } as Awaited<ReturnType<FakeSession['exec']>>);
    const result = await sandbox.runCommand('sleep 10');
    expect(result.exitCode).toBe(124);
    expect(result.stderr).toBe('Luxor command timed out.');
  });

  it('passes the provider timeout through and lets a command override it', async () => {
    const provider = tenki({ apiKey: 'tk_test', timeout: 300 });
    const sandbox = await provider.sandbox.create();
    const exec = vi.spyOn(sharedSession, 'exec');
    await sandbox.runCommand('true');
    expect(exec).toHaveBeenLastCalledWith('sh', expect.objectContaining({ timeoutMs: 300 }));
    await sandbox.runCommand('true', { timeout: 50 });
    expect(exec).toHaveBeenLastCalledWith('sh', expect.objectContaining({ timeoutMs: 50 }));
  });

  it('runCommand passes per-command env vars through to exec', async () => {
    const provider = tenki({ apiKey: 'tk_test' });
    const sandbox = await provider.sandbox.create();
    await sandbox.runCommand('printenv FOO', { env: { FOO: 'bar baz', QUOTED: `it's "quoted"` } });
    // Env goes through Luxor's native exec env (execve), not shell prefixing,
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
    expect(info.metadata?.workspaceId).toBe('ws_1');
    expect(info.createdAt).toBeInstanceOf(Date);
  });

  it('getUrl exposes the port and returns the preview URL', async () => {
    const provider = tenki({ apiKey: 'tk_test' });
    const sandbox = await provider.sandbox.create();
    expect(await sandbox.getUrl({ port: 3000 })).toBe('https://sbx-123-3000.sb.tenki.sh');
  });

  it('filesystem round-trips through native Luxor fs', async () => {
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

  it('destroy closes the session create returned without fetching it first', async () => {
    const held = Object.assign(new FakeSession(), { id: 'sbx_held' });
    vi.spyOn(FakeLuxorSandbox.prototype, 'createAndWait').mockResolvedValueOnce(held);
    const get = vi.spyOn(FakeLuxorSandbox.prototype, 'get');
    const provider = tenki({ apiKey: 'tk_test' });
    const sandbox = await provider.sandbox.create();
    await sandbox.destroy();
    expect(held.closed).toBe(true);
    expect(get).not.toHaveBeenCalled();

    // A destroyed session is forgotten, so a repeat destroy looks the id up.
    await provider.sandbox.destroy('sbx_held');
    expect(get).toHaveBeenCalledWith('sbx_held');
  });

  it('destroy reuses the session getById fetched', async () => {
    const fetched = Object.assign(new FakeSession(), { id: 'sbx_fetched' });
    const get = vi.spyOn(FakeLuxorSandbox.prototype, 'get').mockResolvedValueOnce(fetched);
    const provider = tenki({ apiKey: 'tk_test' });
    await provider.sandbox.getById('sbx_fetched');
    await provider.sandbox.destroy('sbx_fetched');
    expect(get).toHaveBeenCalledTimes(1);
    expect(fetched.closed).toBe(true);
  });

  it('destroy does not reuse a session held under other credentials', async () => {
    const held = Object.assign(new FakeSession(), { id: 'sbx_other_key' });
    vi.spyOn(FakeLuxorSandbox.prototype, 'createAndWait').mockResolvedValueOnce(held);
    const get = vi.spyOn(FakeLuxorSandbox.prototype, 'get');
    await tenki({ apiKey: 'tk_a' }).sandbox.create();
    await tenki({ apiKey: 'tk_b' }).sandbox.destroy('sbx_other_key');
    expect(get).toHaveBeenCalledWith('sbx_other_key');
    expect(held.closed).toBe(false);
  });

  it('destroy keeps a held session for a retry when close fails', async () => {
    const held = Object.assign(new FakeSession(), { id: 'sbx_retry' });
    vi.spyOn(FakeLuxorSandbox.prototype, 'createAndWait').mockResolvedValueOnce(held);
    vi.spyOn(held, 'close').mockRejectedValueOnce(new Error('[unavailable] connection reset'));
    const get = vi.spyOn(FakeLuxorSandbox.prototype, 'get');
    const sandbox = await tenki({ apiKey: 'tk_test' }).sandbox.create();
    await expect(sandbox.destroy()).rejects.toThrow('connection reset');
    await sandbox.destroy();
    expect(held.closed).toBe(true);
    expect(get).not.toHaveBeenCalled();
  });

  it('destroy forgets a held session the server no longer has', async () => {
    const held = Object.assign(new FakeSession(), { id: 'sbx_expired' });
    vi.spyOn(FakeLuxorSandbox.prototype, 'createAndWait').mockResolvedValueOnce(held);
    vi.spyOn(held, 'close').mockRejectedValueOnce(new SessionNotFoundError('gone'));
    const get = vi.spyOn(FakeLuxorSandbox.prototype, 'get');
    const provider = tenki({ apiKey: 'tk_test' });
    const sandbox = await provider.sandbox.create();
    await expect(sandbox.destroy()).resolves.toBeUndefined();
    await provider.sandbox.destroy('sbx_expired');
    expect(get).toHaveBeenCalledWith('sbx_expired');
  });

  it('prefers LUXOR credentials and keeps LUXORAI/TENKI fallbacks', async () => {
    const envNames = [
      'LUXOR_API_KEY', 'LUXOR_AUTH_TOKEN', 'LUXOR_API_ENDPOINT', 'LUXOR_API_URL',
      'LUXORAI_API_KEY', 'LUXORAI_AUTH_TOKEN', 'LUXORAI_API_ENDPOINT', 'LUXORAI_API_URL',
      'TENKI_API_KEY', 'TENKI_AUTH_TOKEN', 'TENKI_API_ENDPOINT', 'TENKI_API_URL',
    ] as const;
    const saved = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
    for (const name of envNames) delete process.env[name];
    const restore = () => {
      for (const name of envNames) {
        const value = saved[name];
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    };
    try {
      await expect(tenki({}).sandbox.create()).rejects.toThrow(/Missing API key for Luxor/);

      process.env.LUXOR_API_KEY = 'lx_new';
      process.env.LUXOR_API_URL = 'https://luxor.example';
      process.env.LUXORAI_API_KEY = 'lx_ai';
      process.env.LUXORAI_API_URL = 'https://luxorai.example';
      process.env.TENKI_API_KEY = 'tk_legacy';
      process.env.TENKI_API_URL = 'https://tenki.example';
      await tenki({}).sandbox.create();
      expect(lastClientOptions).toEqual({ authToken: 'lx_new', baseUrl: 'https://luxor.example' });

      delete process.env.LUXOR_API_KEY;
      delete process.env.LUXOR_API_URL;
      await tenki({}).sandbox.create();
      expect(lastClientOptions).toEqual({ authToken: 'lx_ai', baseUrl: 'https://luxorai.example' });

      delete process.env.LUXORAI_API_KEY;
      delete process.env.LUXORAI_API_URL;
      await tenki({}).sandbox.create();
      expect(lastClientOptions).toEqual({ authToken: 'tk_legacy', baseUrl: 'https://tenki.example' });
    } finally {
      restore();
    }
  });

  it('exports tenki as a deprecated alias of luxor', () => {
    expect(tenki).toBe(luxor);
    expect(tenki({ apiKey: 'lx_test' }).name).toBe('tenki');
  });

  it('throws a helpful error when no API key is configured', async () => {
    const envNames = [
      'LUXOR_API_KEY', 'LUXOR_AUTH_TOKEN',
      'LUXORAI_API_KEY', 'LUXORAI_AUTH_TOKEN',
      'TENKI_API_KEY', 'TENKI_AUTH_TOKEN',
    ] as const;
    const saved = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
    for (const name of envNames) delete process.env[name];
    try {
      const provider = tenki({});
      await expect(provider.sandbox.create()).rejects.toThrow(/Missing API key for Luxor/);
    } finally {
      for (const name of envNames) {
        const value = saved[name];
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }
  });
});
