import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBody, execArgv, execBody, kosa8, MAX_EXEC_BODY_BYTES, SCRIPT_ENV, SNAPSHOT_CAPABILITIES, WRITE_CHUNK_CHARS } from '../index';
import { INLINE_READ_BYTES, INLINE_WRITE_BYTES, MAX_FILE_BYTES, PART_BYTES, workspacePath } from '../files';

const sandboxRow = {
  id: 'sbx_123',
  state: 'running',
  template: 'base',
  cpus: 1,
  mem_mb: 1024,
  region: 'eu-hel1',
  created_at: 1_700_000_000_000,
  started_at: 1_700_000_000_500,
  sleep_after_s: 600,
  delete_after: null,
  last_error: null,
};

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
  /** A binary request body (a file PUT). */
  raw?: Buffer;
}

/**
 * Stubs global fetch with a router; records every call. Never reaches the network. A route may
 * answer with `raw` bytes (a file GET) instead of a JSON body.
 */
function mockFetch(route: (call: Call) => { status: number; body?: unknown; raw?: Uint8Array }) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const call: Call = {
      url,
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      ...(init.body instanceof Uint8Array ? { raw: Buffer.from(init.body) } : {}),
    };
    calls.push(call);
    const { status, body, raw } = route(call);
    const bytes = raw ?? Buffer.from(body === undefined ? '' : JSON.stringify(body));
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => Buffer.from(bytes).toString('utf8'),
      arrayBuffer: async () => Uint8Array.from(bytes).buffer,
    } as Response;
  });
  vi.stubGlobal('fetch', fetch);
  return calls;
}

const API = 'https://api.kosa8.test';
const provider = () => kosa8({ apiKey: 'k8c_test_key', baseUrl: `${API}/` });

/** A fake exec endpoint that runs nothing: answers with what the test supplies. */
function execRoute(answer: (call: Call) => { exit: number | null; stdout?: string; stderr?: string }) {
  return (call: Call) => {
    if (call.method === 'POST' && call.url === `${API}/v1/sandboxes`) return { status: 201, body: { sandbox: sandboxRow } };
    if (call.url === `${API}/v1/sandboxes/sbx_123/exec`) {
      const r = answer(call);
      return { status: 200, body: { stdout: '', stderr: '', ...r } };
    }
    if (call.method === 'DELETE') return { status: 200, body: { ok: true, id: 'sbx_123' } };
    return { status: 500, body: { error: 'unexpected', message: `${call.method} ${call.url}` } };
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('kosa8 config', () => {
  it('fails early with a helpful message when no API key is set', async () => {
    vi.stubEnv('KOSA8_API_KEY', '');
    const calls = mockFetch(() => ({ status: 200 }));
    await expect(kosa8({}).sandbox.create()).rejects.toThrow(/KOSA8_API_KEY/);
    expect(calls).toHaveLength(0);
  });

  it('falls back to KOSA8_API_KEY and KOSA8_API_URL', async () => {
    vi.stubEnv('KOSA8_API_KEY', 'k8c_env_key');
    vi.stubEnv('KOSA8_API_URL', 'https://env.kosa8.test');
    const calls = mockFetch(() => ({ status: 201, body: { sandbox: sandboxRow } }));
    await kosa8({}).sandbox.create();
    expect(calls[0].url).toBe('https://env.kosa8.test/v1/sandboxes');
    expect(calls[0].headers.Authorization).toBe('Bearer k8c_env_key');
  });
});

describe('kosa8 create options', () => {
  it('maps templateId, region, timeout and sleepAfterSeconds', () => {
    expect(createBody({}, { templateId: 'python', region: 'eu-hel1', timeout: 120_000, sleepAfterSeconds: 300 })).toEqual({
      template: 'python',
      region: 'eu-hel1',
      ttl_s: 120,
      sleep_after_s: 300,
    });
  });

  it('uses config defaults and sends nothing it was not given', () => {
    expect(createBody({ template: 'node', region: 'us-ash1' })).toEqual({ template: 'node', region: 'us-ash1' });
    expect(createBody({})).toEqual({});
  });

  it('raises a short timeout to the API minimum lifetime of 60 s', () => {
    expect(createBody({}, { timeout: 5_000 })).toEqual({ ttl_s: 60 });
  });

  it('boots an OCI image without the configured default template', () => {
    expect(createBody({ template: 'node', region: 'us-ash1' }, { image: 'node:22', timeout: 120_000 })).toEqual({
      image: 'node:22',
      region: 'us-ash1',
      ttl_s: 120,
    });
    expect(createBody({}, { image: 'python:3.12-slim', templateId: 'python' })).toEqual({ image: 'python:3.12-slim', template: 'python' });
  });

  it('restores a snapshot with snapshotId, leaving out the configured template and region', () => {
    expect(createBody({ template: 'node', region: 'us-ash1' }, { snapshotId: 'snap_abc12345', timeout: 120_000, sleepAfterSeconds: 60 })).toEqual({
      snapshot: 'snap_abc12345',
      ttl_s: 120,
      sleep_after_s: 60,
    });
  });

  it.each(['templateId', 'image', 'region'])('refuses %s together with snapshotId', (key) => {
    expect(() => createBody({}, { snapshotId: 'snap_abc12345', [key]: 'x' } as any)).toThrow(new RegExp(`leave out '${key}'`));
  });

  it.each(['cpu', 'memory', 'envs'])('rejects %s before calling the API', async (key) => {
    const calls = mockFetch(() => ({ status: 201, body: { sandbox: sandboxRow } }));
    await expect(provider().sandbox.create({ [key]: key === 'envs' ? { A: '1' } : 1 } as any)).rejects.toThrow(
      new RegExp(`'${key}' create option`),
    );
    expect(calls).toHaveLength(0);
  });
});

describe('kosa8 lifecycle', () => {
  it('creates a sandbox with a bearer key and returns its id', async () => {
    const calls = mockFetch(() => ({ status: 201, body: { sandbox: sandboxRow, host_ms: 80 } }));
    const sandbox = await provider().sandbox.create({ templateId: 'base' });
    expect(sandbox.sandboxId).toBe('sbx_123');
    expect(sandbox.provider).toBe('kosa8');
    expect(calls[0]).toMatchObject({
      url: `${API}/v1/sandboxes`,
      method: 'POST',
      headers: { Authorization: 'Bearer k8c_test_key', 'Content-Type': 'application/json' },
      body: { template: 'base' },
    });
  });

  it('gets a sandbox by id, and returns null for one that does not exist', async () => {
    mockFetch((call) =>
      call.url.endsWith('/sbx_123')
        ? { status: 200, body: { sandbox: sandboxRow } }
        : { status: 404, body: { error: 'not_found', message: 'no such sandbox' } },
    );
    const found = await provider().sandbox.getById('sbx_123');
    expect(found?.sandboxId).toBe('sbx_123');
    expect(await provider().sandbox.getById('sbx_missing')).toBeNull();
  });

  it('lists sandboxes', async () => {
    const calls = mockFetch(() => ({ status: 200, body: { sandboxes: [sandboxRow, { ...sandboxRow, id: 'sbx_456' }] } }));
    const list = await provider().sandbox.list();
    expect(list.map((s) => s.sandboxId)).toEqual(['sbx_123', 'sbx_456']);
    expect(calls[0]).toMatchObject({ url: `${API}/v1/sandboxes`, method: 'GET' });
  });

  it('destroys a sandbox, and treats one already gone as destroyed', async () => {
    const calls = mockFetch((call) =>
      call.url.endsWith('/sbx_123') ? { status: 200, body: { ok: true, id: 'sbx_123' } } : { status: 404, body: { error: 'not_found' } },
    );
    await provider().sandbox.destroy('sbx_123');
    await provider().sandbox.destroy('sbx_gone');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `DELETE ${API}/v1/sandboxes/sbx_123`,
      `DELETE ${API}/v1/sandboxes/sbx_gone`,
    ]);
  });

  it('surfaces the API error code and message', async () => {
    mockFetch(() => ({ status: 429, body: { error: 'quota_exceeded', message: 'this organization already has 20 active sandboxes' } }));
    await expect(provider().sandbox.create()).rejects.toThrow(
      'kosa8 API error (429) on POST /v1/sandboxes: quota_exceeded: this organization already has 20 active sandboxes',
    );
  });

  it('reports info, mapping a sleeping sandbox to running and a stopped, deleted or expired one to stopped', async () => {
    let state = 'running';
    mockFetch((call) =>
      call.method === 'POST' ? { status: 201, body: { sandbox: sandboxRow } } : { status: 200, body: { sandbox: { ...sandboxRow, state } } },
    );
    const sandbox = await provider().sandbox.create();
    expect(await sandbox.getInfo()).toMatchObject({
      id: 'sbx_123',
      provider: 'kosa8',
      status: 'running',
      createdAt: new Date(sandboxRow.created_at),
      metadata: { state: 'running', template: 'base', region: 'eu-hel1' },
    });
    // Sleeping wakes on the next call, so it is alive; the rest are not running.
    state = 'sleeping';
    expect((await sandbox.getInfo()).status).toBe('running');
    for (const gone of ['stopped', 'deleted', 'expired', 'creating', 'paused']) {
      state = gone;
      expect((await sandbox.getInfo()).status).toBe('stopped');
    }
    state = 'error';
    expect((await sandbox.getInfo()).status).toBe('error');
  });

  it('does not report a sandbox that is still creating as running', async () => {
    mockFetch(() => ({ status: 200, body: { sandboxes: [{ ...sandboxRow, state: 'creating' }] } }));
    const [sandbox] = await provider().sandbox.list();
    mockFetch(() => ({ status: 200, body: { sandbox: { ...sandboxRow, state: 'creating' } } }));
    expect((await sandbox.getInfo()).status).toBe('stopped');
  });

  it('pauses with sleep and resumes with wake', async () => {
    const calls = mockFetch((call) => {
      if (call.url.endsWith('/sleep')) return { status: 200, body: { sandbox: { ...sandboxRow, state: 'sleeping' } } };
      if (call.url.endsWith('/wake')) return { status: 200, body: { sandbox: sandboxRow, wake_ms: 70 } };
      return { status: 201, body: { sandbox: sandboxRow } };
    });
    const p = provider();
    expect(p.sandbox.pause).toEqual({ memory: true });
    const sandbox = await p.sandbox.create();
    await sandbox.pause!();
    await sandbox.resume!();
    expect(calls.slice(1).map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${API}/v1/sandboxes/sbx_123/sleep`,
      `POST ${API}/v1/sandboxes/sbx_123/wake`,
    ]);
  });

  it('extends a lifetime by moving delete_after later, and leaves an unbounded sandbox alone', async () => {
    const deleteAfter = Date.now() + 600_000;
    let row: Record<string, unknown> = { ...sandboxRow, delete_after: deleteAfter };
    const calls = mockFetch((call) => {
      if (call.method === 'PATCH') return { status: 200, body: { sandbox: { ...row, delete_after: call.body.delete_after } } };
      if (call.method === 'GET') return { status: 200, body: { sandbox: row } };
      return { status: 201, body: { sandbox: row } };
    });
    const sandbox = await provider().sandbox.create();
    await sandbox.extendLifetime!(60_000);
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toBe(`${API}/v1/sandboxes/sbx_123`);
    expect(patch.body).toEqual({ delete_after: deleteAfter + 60_000 });

    row = { ...sandboxRow, delete_after: null };
    const before = calls.length;
    await sandbox.extendLifetime!(60_000);
    expect(calls.slice(before).map((c) => c.method)).toEqual(['GET']);
  });

  it('fails to extend a lifetime when the sandbox is deleted before the update (PATCH 404)', async () => {
    const row = { ...sandboxRow, delete_after: Date.now() + 1_000 };
    mockFetch((call) => {
      if (call.method === 'PATCH') return { status: 404, body: { error: 'not_found', message: 'no such sandbox' } };
      if (call.method === 'GET') return { status: 200, body: { sandbox: row } };
      return { status: 201, body: { sandbox: row } };
    });
    const sandbox = await provider().sandbox.create();
    await expect(sandbox.extendLifetime!(60_000)).rejects.toThrow(/sbx_123 not found/);
  });

  it('does not offer port URLs', async () => {
    mockFetch(() => ({ status: 201, body: { sandbox: sandboxRow } }));
    const sandbox = await provider().sandbox.create();
    await expect(sandbox.getUrl({ port: 3000 })).rejects.toThrow(/port URLs/);
  });

  it('lists templates, and refuses to create or delete them', async () => {
    const templates = [{ key: 'base', cpus: 1, mem_mb: 1024, regions: ['eu-hel1'], hosts: 1, warm: 2, own_host: false }];
    const calls = mockFetch(() => ({ status: 200, body: { templates, default_template: 'base' } }));
    const p = provider();
    expect(await p.template!.list()).toEqual(templates);
    expect(calls[0]).toMatchObject({ url: `${API}/v1/templates`, method: 'GET' });
    await expect(p.template!.create({ name: 'x' } as any)).rejects.toThrow(/does not support creating templates/);
    await expect(p.template!.delete('base')).rejects.toThrow(/does not support deleting templates/);
  });
});

describe('kosa8 image boot', () => {
  it('waits for a sandbox booting an image to run, then fetches its direct exec token', async () => {
    let polls = 0;
    const calls = mockFetch((call) => {
      if (call.method === 'POST' && call.url === `${API}/v1/sandboxes`) return { status: 202, body: { sandbox: { ...sandboxRow, state: 'creating' } } };
      if (call.method === 'GET' && call.url === `${API}/v1/sandboxes/sbx_123`) {
        polls++;
        return { status: 200, body: { sandbox: { ...sandboxRow, state: polls < 2 ? 'creating' : 'running' } } };
      }
      if (call.url === `${API}/v1/sandboxes/sbx_123/direct`) {
        return { status: 200, body: { direct: { exec_url: 'https://h.kosa8.test/x', token: 't', expires_at: Date.now() + 300_000 } } };
      }
      return { status: 500, body: { error: 'unexpected' } };
    });
    const sandbox = await provider().sandbox.create({ image: 'node:22' });
    expect(sandbox.sandboxId).toBe('sbx_123');
    expect(calls[0].body).toEqual({ image: 'node:22' });
    expect(polls).toBe(2);
    expect(calls.at(-1)!.url).toBe(`${API}/v1/sandboxes/sbx_123/direct`);
    expect((sandbox.getInstance() as any).direct.token).toBe('t');
  });

  it('deletes a sandbox whose image failed to boot, and reports why', async () => {
    const calls = mockFetch((call) => {
      if (call.method === 'POST') return { status: 202, body: { sandbox: { ...sandboxRow, state: 'creating' } } };
      if (call.method === 'GET') return { status: 200, body: { sandbox: { ...sandboxRow, state: 'error', last_error: 'pull failed' } } };
      return { status: 200, body: { ok: true } };
    });
    await expect(provider().sandbox.create({ image: 'nope:1' })).rejects.toThrow(/is error, not running: pull failed/);
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', url: `${API}/v1/sandboxes/sbx_123` });
  });
});

describe('kosa8 snapshots', () => {
  const snapRow = {
    id: 'snap_abc12345',
    name: 'golden',
    state: 'ready',
    source_sandbox_id: 'sbx_123',
    template: 'base',
    cpus: 1,
    mem_mb: 256,
    image: null,
    bytes: 268_503_140,
    region: 'us-ash1',
    created_at: 1_700_000_001_000,
  };

  it('declares a full-memory snapshot that keeps its source and restores many times', () => {
    expect(provider().snapshot!.capabilities).toEqual(SNAPSHOT_CAPABILITIES);
    expect(SNAPSHOT_CAPABILITIES).toMatchObject({ scope: 'rootfs', memory: true, destroysSource: false, source: 'kept', fork: true, readiness: 'immediate' });
  });

  it('creates a snapshot of a sandbox', async () => {
    const calls = mockFetch(() => ({ status: 201, body: { snapshot: snapRow, ms: 216 } }));
    const snap: any = await provider().snapshot!.create('sbx_123', { name: 'golden' });
    expect(calls[0]).toMatchObject({ method: 'POST', url: `${API}/v1/sandboxes/sbx_123/snapshots`, body: { name: 'golden' } });
    expect(snap).toMatchObject({ id: 'snap_abc12345', provider: 'kosa8', metadata: { sourceInstanceId: 'sbx_123', bytes: 268_503_140, createMs: 216 } });
    expect(snap.createdAt).toEqual(new Date(1_700_000_001_000));
  });

  it('does not send a name the API would refuse', async () => {
    const calls = mockFetch(() => ({ status: 201, body: { snapshot: { ...snapRow, name: null } } }));
    await provider().snapshot!.create('sbx_123', { name: 'has spaces/and slashes' });
    expect(calls[0].body).toEqual({});
  });

  it('fails clearly for a sandbox that does not exist', async () => {
    mockFetch(() => ({ status: 404, body: { error: 'not_found' } }));
    await expect(provider().snapshot!.create('sbx_gone')).rejects.toThrow(/sbx_gone not found/);
  });

  it('lists snapshots and deletes one, treating one already gone as deleted', async () => {
    const calls = mockFetch((call) => {
      if (call.method === 'GET') return { status: 200, body: { snapshots: [snapRow], max: 50 } };
      return { status: call.url.endsWith('snap_gone') ? 404 : 200, body: { ok: true } };
    });
    const p = provider();
    expect((await p.snapshot!.list()).map((s: any) => s.id)).toEqual(['snap_abc12345']);
    await p.snapshot!.delete('snap_abc12345');
    await p.snapshot!.delete('snap_gone');
    expect(calls.slice(1).map((c) => `${c.method} ${c.url}`)).toEqual([
      `DELETE ${API}/v1/snapshots/snap_abc12345`,
      `DELETE ${API}/v1/snapshots/snap_gone`,
    ]);
  });

  it('restores a sandbox from a snapshot with POST /v1/sandboxes {snapshot}', async () => {
    const calls = mockFetch(() => ({ status: 201, body: { sandbox: { ...sandboxRow, id: 'sbx_456' } } }));
    const sandbox = await kosa8({ apiKey: 'k', baseUrl: API, template: 'node' }).sandbox.create({ snapshotId: 'snap_abc12345' });
    expect(sandbox.sandboxId).toBe('sbx_456');
    expect(calls[0].body).toEqual({ snapshot: 'snap_abc12345' });
  });
});

describe('kosa8 commands', () => {
  it('runs a command through sh -c with cwd and env', async () => {
    const calls = mockFetch(execRoute(() => ({ exit: 0, stdout: 'hi\n' })));
    const sandbox = await provider().sandbox.create();
    const result = await sandbox.runCommand('echo "$GREETING"', { cwd: '/work dir', env: { GREETING: 'hi there' } });
    expect(result).toMatchObject({ stdout: 'hi\n', stderr: '', exitCode: 0 });
    expect(typeof result.durationMs).toBe('number');
    const exec = calls.find((c) => c.url.endsWith('/exec'))!;
    expect(exec.body).toEqual({ cmd: ['sh', '-c', 'cd "/work dir" && echo "$GREETING"'], env: ['GREETING=hi there'] });
  });

  it('passes through a non-zero exit and stderr', async () => {
    mockFetch(execRoute(() => ({ exit: 3, stderr: 'boom\n' })));
    const sandbox = await provider().sandbox.create();
    expect(await sandbox.runCommand('exit 3')).toMatchObject({ exitCode: 3, stderr: 'boom\n' });
  });

  it('rejects an invalid environment variable name', async () => {
    mockFetch(execRoute(() => ({ exit: 0 })));
    const sandbox = await provider().sandbox.create();
    await expect(sandbox.runCommand('true', { env: { 'BAD-NAME': '1' } })).rejects.toThrow(/Invalid environment variable name/);
  });

  it('detaches background commands', () => {
    expect(execArgv('sleep 30', { background: true })).toEqual(['sh', '-c', 'nohup sh -c "sleep 30" >/dev/null 2>&1 &']);
  });

  it('sends a script longer than one exec argument in an environment variable', () => {
    const long = `echo ${'a'.repeat(9000)}`;
    expect(execBody(long, { env: { A: '1' } })).toEqual({
      cmd: ['sh', '-c', 'eval "$KOSA8_SCRIPT"'],
      env: ['A=1', `KOSA8_SCRIPT=${long}`],
    });
    expect(execBody('echo hi').cmd).toEqual(['sh', '-c', 'echo hi']);
  });

  it('rejects a caller environment that sets the reserved KOSA8_SCRIPT name', async () => {
    const calls = mockFetch(execRoute(() => ({ exit: 0 })));
    const sandbox = await provider().sandbox.create();
    const long = `echo "$KOSA8_SCRIPT"; # ${'a'.repeat(8200)}`;
    await expect(sandbox.runCommand(long, { env: { KOSA8_SCRIPT: 'hello' } })).rejects.toThrow(/KOSA8_SCRIPT is reserved/);
    expect(() => execBody('echo hi', { env: { KOSA8_SCRIPT: 'hello' } })).toThrow(/KOSA8_SCRIPT is reserved/);
    expect(calls.filter((c) => c.url.endsWith('/exec'))).toHaveLength(0);
  });

  it('rejects a request body over the 64 KiB exec limit before sending it', async () => {
    const calls = mockFetch(execRoute(() => ({ exit: 0 })));
    const sandbox = await provider().sandbox.create();
    await expect(sandbox.runCommand(`echo ${'a'.repeat(MAX_EXEC_BODY_BYTES)}`)).rejects.toThrow(/65536 bytes \(64 KiB\)/);
    expect(calls.filter((c) => c.url.endsWith('/exec'))).toHaveLength(0);

    // Caller environment counts toward the same limit.
    expect(() => execBody(`echo ${'a'.repeat(40_000)}`, { env: { BIG: 'b'.repeat(30_000) } })).toThrow(/64 KiB/);

    // Multi-byte characters are counted in bytes, not characters.
    expect(() => execBody(`echo ${'ü'.repeat(40_000)}`)).toThrow(/64 KiB/);

    // A body just under the limit is accepted.
    const fits = `echo ${'a'.repeat(MAX_EXEC_BODY_BYTES - 200)}`;
    const body = execBody(fits);
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(MAX_EXEC_BODY_BYTES);
    expect(body.env).toEqual([`KOSA8_SCRIPT=${fits}`]);
  });

  it('enforces a timeout inside the sandbox, reporting exit 124', () => {
    const [, , script] = execArgv('sleep 60', { timeout: 1500 });
    expect(script).toContain('timeout -s KILL 2 sh -c');
    expect(script).toContain('s=124');
    // 137 counts as a timeout only when the command never returned (no marker file).
    expect(script).toContain('[ $s -eq 137 ] && [ ! -e "$KOSA8_DONE" ] && [ $(( $(date +%s) - t0 )) -ge 2 ]');
  });

  it('counts the argv limit in UTF-8 bytes, so multibyte commands move to the env path', () => {
    const cmd = `echo ${'ü'.repeat(4100)}`; // 4,105 characters, 8,205 bytes
    const body = execBody(cmd);
    expect(body.cmd).toEqual(['sh', '-c', `eval "$${SCRIPT_ENV}"`]);
    expect(body.env).toEqual([`${SCRIPT_ENV}=${cmd}`]);
    const ascii = execBody('echo hi');
    expect(ascii.cmd).toEqual(['sh', '-c', 'echo hi']);
  });
});

// Runs the generated timeout wrapper in a real shell. Needs `timeout` on PATH (coreutils or
// busybox), as in kosa8's images and Linux CI; skipped elsewhere.
const hasTimeout = (() => {
  try { execFileSync('sh', ['-c', 'command -v timeout'], { stdio: 'ignore' }); return true; } catch { return false; }
})();
function runLocal(command: string, timeoutMs: number): number {
  const [file, flag, script] = execArgv(command, { timeout: timeoutMs });
  try { execFileSync(file, [flag, script], { stdio: 'ignore' }); return 0; } catch (e: any) { return e.status; }
}
describe.skipIf(!hasTimeout)('kosa8 timeout wrapper in a real shell', () => {
  it('keeps an early exit 137', () => expect(runLocal('exit 137', 10_000)).toBe(137));
  it('keeps a child killed early by SIGKILL', () => expect(runLocal("sh -c 'kill -9 $$'", 10_000)).toBe(137));
  it('keeps an early kill of the wrapper shell itself', () => expect(runLocal('kill -9 $$', 10_000)).toBe(137));
  it('keeps ordinary exit codes', () => expect(runLocal('exit 3', 10_000)).toBe(3));
  it('reports 124 when the deadline kills the command', () => expect(runLocal('sleep 30', 1000)).toBe(124));
  it('handles quotes, comments and $ in the command', () =>
    expect(runLocal('x="a b"; [ "$x" = "a b" ] && exit 5 # note', 10_000)).toBe(5));
});

describe('kosa8 template and region defaults from the environment', () => {
  afterEach(() => { delete process.env.KOSA8_TEMPLATE; delete process.env.KOSA8_REGION; });
  it('uses KOSA8_TEMPLATE and KOSA8_REGION when neither options nor config set them', () => {
    process.env.KOSA8_TEMPLATE = 'node';
    process.env.KOSA8_REGION = 'eu-hel1';
    expect(createBody({}, {})).toMatchObject({ template: 'node', region: 'eu-hel1' });
  });
  it('prefers options, then config, over the environment', () => {
    process.env.KOSA8_TEMPLATE = 'node';
    expect(createBody({ template: 'base' }, { templateId: 'python' }).template).toBe('python');
    expect(createBody({ template: 'base' }, {}).template).toBe('base');
  });
  it('sends no template when nothing sets one', () => {
    expect(createBody({}, {}).template).toBeUndefined();
  });
});

/**
 * A fake sandbox for file tests: its file API keeps files in `store` (only under /workspace, at
 * most 8 MiB, as kosa8's does), and its exec answers with what the test supplies.
 */
function filesRoute(
  store: Map<string, Buffer>,
  exec: (call: Call) => { exit: number | null; stdout?: string; stderr?: string } = () => ({ exit: 0 }),
  { fileApi = true } = {},
) {
  return (call: Call) => {
    if (call.method === 'POST' && call.url === `${API}/v1/sandboxes`) return { status: 201, body: { sandbox: sandboxRow } };
    if (call.url === `${API}/v1/sandboxes/sbx_123/exec`) return { status: 200, body: { stdout: '', stderr: '', ...exec(call) } };
    if (call.url.startsWith(`${API}/v1/sandboxes/sbx_123/files?`)) {
      if (!fileApi) return { status: 501, body: { error: 'not_available', message: 'Files are not available on this host' } };
      const path = new URL(call.url).searchParams.get('path')!;
      if (!path.startsWith('/workspace/')) return { status: 400, body: { error: 'bad_request', message: 'outside the workspace' } };
      if (call.method === 'PUT') {
        if (call.raw!.length > MAX_FILE_BYTES) return { status: 413, body: { error: 'too_large' } };
        store.set(path, call.raw!);
        return { status: 200, body: { file: { path } } };
      }
      const file = store.get(path);
      if (!file) return { status: 404, body: { error: 'not_found' } };
      if (file.length > MAX_FILE_BYTES) return { status: 413, body: { error: 'too_large' } };
      return { status: 200, raw: file };
    }
    return { status: 500, body: { error: 'unexpected', message: `${call.method} ${call.url}` } };
  };
}

const execs = (calls: Call[]) => calls.filter((c) => c.url.endsWith('/exec'));
const fileCalls = (calls: Call[], method: string) => calls.filter((c) => c.method === method && c.url.includes('/files?'));
const pathOf = (c: Call) => new URL(c.url).searchParams.get('path')!;
/** Content of n bytes with a multibyte character across every part boundary. */
const bigContent = (n: number) => ('ab'.repeat(PART_BYTES / 2 - 1) + 'ü').repeat(Math.ceil(n / PART_BYTES)).slice(0, n);

describe('kosa8 workspace paths', () => {
  it.each([
    ['/workspace/a.txt', '/workspace/a.txt'],
    ['/workspace/x/../b', '/workspace/b'],
    ['/workspace//d/e', '/workspace/d/e'],
    ['/workspace', null],
    ['/workspace/', null],
    ['/workspace/../etc/passwd', null],
    ['/workspacefoo/a', null],
    ['workspace/a', null],
    ['/tmp/a', null],
  ])('%s -> %s', (path, want) => expect(workspacePath(path)).toBe(want));
});

describe('kosa8 file writes', () => {
  it('writes a small file with one exec: env-carried base64, then an atomic rename', async () => {
    const content = 'hello\nü';
    const calls = mockFetch(filesRoute(new Map()));
    const sandbox = await provider().sandbox.create();
    await sandbox.filesystem.writeFile('/tmp/dir/file.txt', content);
    const [e, ...rest] = execs(calls);
    expect(rest).toHaveLength(0);
    expect(fileCalls(calls, 'PUT')).toHaveLength(0);
    for (const arg of e.body.cmd) expect(arg.length).toBeLessThanOrEqual(8192);
    expect(e.body.cmd[2]).toMatch(/mkdir -p .* base64 -d > "\/tmp\/dir\/file\.txt\.computesdk-[0-9a-f]{12}" && mv -f /);
    expect(Buffer.from(e.body.env[0].replace(/^KOSA8_CHUNK=/, ''), 'base64').toString('utf8')).toBe(content);
  });

  it('reports a failed small write, and the command removes its temporary file', async () => {
    const calls = mockFetch(filesRoute(new Map(), () => ({ exit: 1, stderr: 'read-only' })));
    const sandbox = await provider().sandbox.create();
    await expect(sandbox.filesystem.writeFile('/ro/file', 'data')).rejects.toThrow(/write '\/ro\/file' failed \(exit 1\): read-only/);
    expect(execs(calls)[0].body.cmd[2]).toMatch(/\|\| \{ s=\$\?; rm -f "\/ro\/file\.computesdk-[0-9a-f]{12}"; exit \$s; \}$/);
  });

  it('writes a larger file under /workspace with one PUT of its bytes', async () => {
    const store = new Map<string, Buffer>();
    const content = 'ü'.repeat(INLINE_WRITE_BYTES);
    const calls = mockFetch(filesRoute(store));
    const sandbox = await provider().sandbox.create();
    await sandbox.filesystem.writeFile('/workspace/sub/../big.txt', content);
    expect(execs(calls)).toHaveLength(0);
    const [put] = fileCalls(calls, 'PUT');
    expect(pathOf(put)).toBe('/workspace/big.txt');
    expect(put.headers.Authorization).toBe('Bearer k8c_test_key');
    expect(store.get('/workspace/big.txt')!.toString('utf8')).toBe(content);
  });

  it('stages a file outside /workspace, or over 8 MiB, as parts put together by one command', async () => {
    const store = new Map<string, Buffer>();
    const content = bigContent(2 * PART_BYTES + 1000);
    const calls = mockFetch(filesRoute(store));
    const sandbox = await provider().sandbox.create();
    await sandbox.filesystem.writeFile('/root/data.bin', content);

    const puts = fileCalls(calls, 'PUT');
    expect(puts).toHaveLength(3);
    const dir = pathOf(puts[0]).replace(/\/[^/]+$/, '');
    expect(dir).toMatch(/^\/workspace\/\.computesdk-[0-9a-f]{12}$/);
    const parts = [...store.keys()].sort();
    expect(parts).toEqual([`${dir}/000000`, `${dir}/000001`, `${dir}/000002`]);
    expect(Buffer.concat(parts.map((k) => store.get(k)!)).toString('utf8')).toBe(content);

    const [assemble, ...rest] = execs(calls);
    expect(rest).toHaveLength(0);
    expect(assemble.body.cmd[2]).toContain(`cat "${dir}"/* > "/root/data.bin.computesdk-`);
    expect(assemble.body.cmd[2]).toContain(`rm -rf "${dir}"`);
  });

  it('retries a part that failed in transit, then succeeds', async () => {
    const store = new Map<string, Buffer>();
    const route = filesRoute(store);
    let failures = 0;
    const calls = mockFetch((call) => {
      if (call.method === 'PUT' && pathOf(call).endsWith('000001') && failures++ < 2) return { status: 503, body: { error: 'host_busy' } };
      return route(call);
    });
    const sandbox = await provider().sandbox.create();
    const content = bigContent(PART_BYTES + 10);
    await sandbox.filesystem.writeFile('/root/x', content);
    expect(fileCalls(calls, 'PUT').filter((c) => pathOf(c).endsWith('000001'))).toHaveLength(3);
    expect(Buffer.concat([...store.keys()].sort().map((k) => store.get(k)!)).toString('utf8')).toBe(content);
  });

  it('removes the staged parts when a part upload fails', async () => {
    const route = filesRoute(new Map());
    const calls = mockFetch((call) =>
      call.method === 'PUT' && pathOf(call).endsWith('000001') ? { status: 502, body: { error: 'host_failed' } } : route(call),
    );
    const sandbox = await provider().sandbox.create();
    await expect(sandbox.filesystem.writeFile('/root/x', bigContent(PART_BYTES + 10))).rejects.toThrow(/kosa8 API error \(502\) on write '\/root\/x': host_failed/);
    expect(execs(calls).at(-1)!.body.cmd[2]).toMatch(/^rm -rf "\/workspace\/\.computesdk-[0-9a-f]{12}"$/);
  });

  it('starts no more parts after one fails, and cleans up only once the others have finished', async () => {
    const route = filesRoute(new Map());
    const calls = mockFetch((call) =>
      call.method === 'PUT' && pathOf(call).endsWith('000000') ? { status: 400, body: { error: 'bad_request' } } : route(call),
    );
    const sandbox = await provider().sandbox.create();
    await expect(sandbox.filesystem.writeFile('/root/x', bigContent(10 * PART_BYTES))).rejects.toThrow(/\(400\)/);
    const puts = fileCalls(calls, 'PUT');
    expect(puts.length).toBeLessThanOrEqual(4);
    expect(calls.indexOf(execs(calls).at(-1)!)).toBeGreaterThan(calls.indexOf(puts.at(-1)!));
  });

  it('falls back to exec chunks on a host without the file API, and remembers it', async () => {
    const calls = mockFetch(filesRoute(new Map(), () => ({ exit: 0 }), { fileApi: false }));
    const sandbox = await provider().sandbox.create();
    const content = 'x'.repeat(WRITE_CHUNK_CHARS) + '\nü';
    await sandbox.filesystem.writeFile('/workspace/a.txt', content);
    await sandbox.filesystem.writeFile('/workspace/b.txt', content);
    expect(fileCalls(calls, 'PUT')).toHaveLength(1);
    const writes = execs(calls);
    for (const e of writes) for (const arg of e.body.cmd) expect(arg.length).toBeLessThanOrEqual(8192);
    const chunks = writes.filter((e) => e.body.env.length > 0).map((e) => e.body.env[0].replace(/^KOSA8_CHUNK=/, ''));
    expect(chunks.length).toBe(4);
    expect(Buffer.from(chunks.slice(0, 2).join(''), 'base64').toString('utf8')).toBe(content);
    expect(writes.at(-1)!.body.cmd[2]).toMatch(/^mv -f "\/workspace\/b\.txt\.computesdk-[0-9a-f]{12}" "\/workspace\/b\.txt"$/);
  });
});

describe('kosa8 file reads', () => {
  it('reads a file under /workspace with one GET', async () => {
    const store = new Map([['/workspace/a.txt', Buffer.from('hello ü\n')]]);
    const calls = mockFetch(filesRoute(store));
    const sandbox = await provider().sandbox.create();
    expect(await sandbox.filesystem.readFile('/workspace/a.txt')).toBe('hello ü\n');
    expect(execs(calls)).toHaveLength(0);
  });

  it('reports a missing /workspace file as ENOENT', async () => {
    mockFetch(filesRoute(new Map()));
    const sandbox = await provider().sandbox.create();
    await expect(sandbox.filesystem.readFile('/workspace/nope')).rejects.toThrow(/ENOENT: no such file or directory, open '\/workspace\/nope'/);
  });

  it('reads a small file elsewhere inline with one exec', async () => {
    const calls = mockFetch(filesRoute(new Map(), () => ({ exit: 0, stdout: `6\n${Buffer.from('hello\n').toString('base64')}\n` })));
    const sandbox = await provider().sandbox.create();
    expect(await sandbox.filesystem.readFile('/tmp/a.txt')).toBe('hello\n');
    expect(execs(calls)).toHaveLength(1);
    expect(fileCalls(calls, 'GET')).toHaveLength(0);
  });

  it('reports a missing file elsewhere as ENOENT', async () => {
    mockFetch(filesRoute(new Map(), () => ({ exit: 44 })));
    const sandbox = await provider().sandbox.create();
    await expect(sandbox.filesystem.readFile('/tmp/nope')).rejects.toThrow(/ENOENT/);
  });

  it('reads a large file as parts split under /workspace, fetched and then removed', async () => {
    const content = Buffer.from(bigContent(MAX_FILE_BYTES + 5000));
    const store = new Map<string, Buffer>([['/workspace/big', content]]);
    const calls = mockFetch(
      filesRoute(store, (call) => {
        const cmd: string = call.body.cmd[2];
        const dir = /mkdir -p "(\/workspace\/\.computesdk-[0-9a-f]{12})"/.exec(cmd)?.[1];
        if (dir) {
          for (let i = 0; i * PART_BYTES < content.length; i++) {
            store.set(`${dir}/${String(i).padStart(6, '0')}`, content.subarray(i * PART_BYTES, (i + 1) * PART_BYTES));
          }
          return { exit: 0, stdout: `${content.length}\n` };
        }
        return { exit: 0 };
      }),
    );
    const sandbox = await provider().sandbox.create();
    expect(await sandbox.filesystem.readFile('/workspace/big')).toBe(content.toString('utf8'));
    const gets = fileCalls(calls, 'GET').map(pathOf);
    expect(gets[0]).toBe('/workspace/big'); // 413: over the file API's limit
    const parts = Array.from({ length: Math.ceil(content.length / PART_BYTES) }, (_, i) => String(i).padStart(6, '0'));
    expect(parts.length).toBeGreaterThan(1);
    expect(gets.slice(1).map((p) => p.replace(/.*\//, '')).sort()).toEqual(parts);
    const [split, cleanup] = execs(calls);
    expect(split.body.cmd[2]).toContain(`dd if="/workspace/big"`);
    expect(cleanup.body.cmd[2]).toMatch(/^rm -rf "\/workspace\/\.computesdk-[0-9a-f]{12}"$/);
  });

  it('reads a large file in 1 MiB exec chunks on a host without the file API', async () => {
    const content = Buffer.from(bigContent(INLINE_READ_BYTES * 2 + 7));
    const calls = mockFetch(
      filesRoute(
        new Map(),
        (call) => {
          const cmd: string = call.body.cmd[2];
          const skip = /skip=(\d+) count=1/.exec(cmd);
          if (skip) {
            const i = Number(skip[1]);
            return { exit: 0, stdout: content.subarray(i * INLINE_READ_BYTES, (i + 1) * INLINE_READ_BYTES).toString('base64') };
          }
          expect(cmd).not.toContain('mkdir');
          return { exit: 0, stdout: `${content.length}\n` };
        },
        { fileApi: false },
      ),
    );
    const sandbox = await provider().sandbox.create();
    expect(await sandbox.filesystem.readFile('/workspace/big')).toBe(content.toString('utf8'));
    expect(execs(calls)).toHaveLength(4);
  });

  it('checks existence', async () => {
    mockFetch(filesRoute(new Map(), () => ({ exit: 0, stdout: 'no\n' })));
    const sandbox = await provider().sandbox.create();
    expect(await sandbox.filesystem.exists('/tmp/missing')).toBe(false);
  });
});

describe('kosa8 direct exec', () => {
  const HOST = 'https://us1.kosa8.test/host/v1/sandboxes/sbx_123/exec';
  const direct = (ms = 300_000) => ({ exec_url: HOST, token: 'tok_direct', expires_at: Date.now() + ms });

  function directRoute(hostStatus: number, hostBody: unknown, d = direct()) {
    return (call: Call) => {
      if (call.method === 'POST' && call.url === `${API}/v1/sandboxes`) return { status: 201, body: { sandbox: sandboxRow, direct: d } };
      if (call.url === HOST) return { status: hostStatus, body: hostBody };
      if (call.url === `${API}/v1/sandboxes/sbx_123/exec`) return { status: 200, body: { exit: 0, stdout: 'via api\n', stderr: '' } };
      if (call.url === `${API}/v1/sandboxes/sbx_123/direct`) return { status: 200, body: { direct: direct() } };
      return { status: 500, body: { error: 'unexpected', message: `${call.method} ${call.url}` } };
    };
  }

  it('sends commands to the host with the direct token, not the API key', async () => {
    const calls = mockFetch(directRoute(200, { exit: 0, stdout: 'v22.11.0\n', stderr: '' }));
    const sandbox = await provider().sandbox.create();
    const r = await sandbox.runCommand('node -v');
    expect(r.stdout).toBe('v22.11.0\n');
    expect(r.exitCode).toBe(0);
    const exec = calls.find((c) => c.url === HOST)!;
    expect(exec.headers.Authorization).toBe('Bearer tok_direct');
    expect(exec.body.cmd).toEqual(['sh', '-c', 'node -v']);
    expect(calls.some((c) => c.url.endsWith('/exec') && c.url.startsWith(API))).toBe(false);
  });

  it.each([401, 404, 409, 501, 530])('falls back to the API when the host answers %i (the command did not run there)', async (status) => {
    const calls = mockFetch(directRoute(status, { error: 'no', code: 'use_api' }));
    const sandbox = await provider().sandbox.create();
    expect((await sandbox.runCommand('echo hi')).stdout).toBe('via api\n');
    // And stays on the API afterwards.
    await sandbox.runCommand('echo again');
    expect(calls.filter((c) => c.url === HOST)).toHaveLength(1);
  });

  it('reports a host failure that may have run the command, without running it again', async () => {
    const calls = mockFetch(directRoute(502, { error: 'exec failed: boom' }));
    const sandbox = await provider().sandbox.create();
    await expect(sandbox.runCommand('rm -rf /tmp/x')).rejects.toThrow(/kosa8 host error \(502\).*boom/);
    expect(calls.filter((c) => c.url.endsWith('/exec'))).toHaveLength(1);
  });

  it('does not use a token about to expire, and renews it in the background', async () => {
    const calls = mockFetch(directRoute(200, { exit: 0, stdout: 'direct\n', stderr: '' }, direct(5_000)));
    const sandbox = await provider().sandbox.create();
    expect((await sandbox.runCommand('echo hi')).stdout).toBe('via api\n');
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.some((c) => c.url === `${API}/v1/sandboxes/sbx_123/direct`)).toBe(true);
    expect((await sandbox.runCommand('echo hi')).stdout).toBe('direct\n');
  });

  it('ignores a malformed or non-https direct object', async () => {
    const calls = mockFetch(directRoute(200, {}, { exec_url: 'http://plain.test/x', token: 't', expires_at: Date.now() + 300_000 }));
    const sandbox = await provider().sandbox.create();
    expect((await sandbox.runCommand('echo hi')).stdout).toBe('via api\n');
    expect(calls.some((c) => c.url.startsWith('http://'))).toBe(false);
  });
});
