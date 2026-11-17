import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBody, execArgv, execBody, kosa8, MAX_EXEC_BODY_BYTES, SCRIPT_ENV, SNAPSHOT_CAPABILITIES, WRITE_CHUNK_CHARS } from '../index';
import { fileParts, INLINE_READ_BYTES } from '../files';

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
function mockFetch(route: (call: Call) => { status: number; body?: unknown; raw?: Uint8Array; headers?: Record<string, string> }) {
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
    const { status, body, raw, headers } = route(call);
    const bytes = raw ?? Buffer.from(body === undefined ? '' : JSON.stringify(body));
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(headers ?? {}),
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
 * A fake sandbox for file tests. `store` is the sandbox's disk. Its file stream (`stream`) serves
 * any path at the API (`/v1/sandboxes/sbx_123/files`) and, with a direct token, at HOST_FILES:
 * offset= writes keep the rest of the file, Range reads answer 206 or 416. As `legacy` it is an
 * older host's base64 file API: /workspace only, 8 MiB at most, no offsets, Range ignored. Exec
 * answers with what the test supplies.
 */
const HOST_FILES = 'https://h.kosa8.test/host/v1/sandboxes/sbx_123/files/raw';
const directWithFiles = (ms = 300_000) => ({
  exec_url: 'https://h.kosa8.test/host/v1/sandboxes/sbx_123/exec',
  files_url: HOST_FILES,
  token: 'tok_direct',
  expires_at: Date.now() + ms,
});

function filesRoute(
  store: Map<string, Buffer>,
  {
    api = 'stream' as 'stream' | 'legacy' | 'none',
    direct = undefined as ReturnType<typeof directWithFiles> | undefined,
    host = (_call: Call): { status: number; body?: unknown } | null => null,
    exec = (_call: Call): { exit: number | null; stdout?: string; stderr?: string; stdout_truncated?: boolean } => ({ exit: 0 }),
  } = {},
) {
  const serve = (call: Call, legacy: boolean) => {
    const u = new URL(call.url);
    const path = u.searchParams.get('path')!;
    const offset = u.searchParams.get('offset');
    if (legacy && !path.startsWith('/workspace/')) return { status: 400, body: { error: 'bad_request', message: `path "${path}" is outside the workspace` } };
    if (legacy && offset !== null) return { status: 501, body: { error: 'not_available', message: 'offset writes are not available' } };
    if (call.method === 'PUT') {
      if (legacy && call.raw!.length > 8 * 1024 * 1024) return { status: 413, body: { error: 'too_large' } };
      if (offset === null) store.set(path, Buffer.from(call.raw!));
      else {
        const at = Number(offset);
        const old = store.get(path) ?? Buffer.alloc(0);
        const next = Buffer.alloc(Math.max(old.length, at + call.raw!.length));
        old.copy(next);
        call.raw!.copy(next, at);
        store.set(path, next);
      }
      return { status: 200, body: { file: { path } } };
    }
    const file = store.get(path);
    if (!file) return { status: 404, body: { error: 'not_found', message: `no such file or folder: ${path}` } };
    if (legacy && file.length > 8 * 1024 * 1024) return { status: 413, body: { error: 'too_large' } };
    const range = /bytes=(\d+)-(\d+)/.exec(call.headers.Range ?? '');
    if (legacy || !range) return { status: 200, raw: file };
    const start = Number(range[1]);
    if (start >= file.length) return { status: 416, body: { error: 'the range starts past the end' } };
    const end = Math.min(Number(range[2]), file.length - 1);
    return { status: 206, raw: file.subarray(start, end + 1), headers: { 'content-range': `bytes ${start}-${end}/${file.length}` } };
  };
  return (call: Call) => {
    if (call.method === 'POST' && call.url === `${API}/v1/sandboxes`) return { status: 201, body: { sandbox: sandboxRow, ...(direct ? { direct } : {}) } };
    if (call.url === `${API}/v1/sandboxes/sbx_123/exec` || call.url === direct?.exec_url) {
      return { status: 200, body: { stdout: '', stderr: '', ...exec(call) } };
    }
    if (call.url.startsWith(`${HOST_FILES}?`)) return host(call) ?? serve(call, false);
    if (call.url.startsWith(`${API}/v1/sandboxes/sbx_123/files?`)) {
      if (api === 'none') return { status: 501, body: { error: 'not_available', message: 'Files are not available on this host' } };
      return serve(call, api === 'legacy');
    }
    return { status: 500, body: { error: 'unexpected', message: `${call.method} ${call.url}` } };
  };
}

const execs = (calls: Call[]) => calls.filter((c) => c.url.endsWith('/exec'));
const fileCalls = (calls: Call[], method: string, base = `${API}/v1/sandboxes/sbx_123/files`) =>
  calls.filter((c) => c.method === method && c.url.startsWith(`${base}?`));
const query = (c: Call, k: string) => new URL(c.url).searchParams.get(k);
const PART = 1024;

describe('kosa8 files', () => {
  const saved = { ...fileParts };
  beforeEach(() => {
    Object.assign(fileParts, { bytes: PART, concurrency: 4 });
  });
  afterEach(() => {
    Object.assign(fileParts, saved);
  });

  it('writes and reads any path straight on the host with the direct token', async () => {
    const store = new Map<string, Buffer>();
    const calls = mockFetch(filesRoute(store, { direct: directWithFiles() }));
    const sandbox = await provider().sandbox.create();
    await sandbox.filesystem.writeFile('/tmp/a/b.txt', 'hello ü');
    expect(store.get('/tmp/a/b.txt')!.toString('utf8')).toBe('hello ü');
    expect(await sandbox.filesystem.readFile('/tmp/a/b.txt')).toBe('hello ü');
    const host = calls.filter((c) => c.url.startsWith(HOST_FILES));
    expect(host.map((c) => c.method)).toEqual(['PUT', 'GET']);
    expect(host.every((c) => c.headers.Authorization === 'Bearer tok_direct')).toBe(true);
    expect(fileCalls(calls, 'PUT')).toHaveLength(0);
    expect(execs(calls)).toHaveLength(0);
  });

  it('writes a large file as parts: the first replaces it, the rest go at their offsets', async () => {
    const store = new Map([['/root/big', Buffer.from('x'.repeat(10 * PART))]]);
    const calls = mockFetch(filesRoute(store, { direct: directWithFiles() }));
    const sandbox = await provider().sandbox.create();
    const content = 'aü'.repeat(Math.ceil((3.5 * PART) / 3)); // multibyte characters across part boundaries
    await sandbox.filesystem.writeFile('/root/big', content);
    const puts = fileCalls(calls, 'PUT', HOST_FILES);
    expect(puts.map((c) => query(c, 'offset'))).toEqual([null, String(PART), String(2 * PART), String(3 * PART)]);
    expect(store.get('/root/big')!.toString('utf8')).toBe(content); // the old, longer content is gone
  });

  it('reads a large file in ranges, in parallel', async () => {
    const content = Buffer.from('bü'.repeat(2 * PART));
    const calls = mockFetch(filesRoute(new Map([['/tmp/big', content]]), { direct: directWithFiles() }));
    const sandbox = await provider().sandbox.create();
    expect(await sandbox.filesystem.readFile('/tmp/big')).toBe(content.toString('utf8'));
    const ranges = fileCalls(calls, 'GET', HOST_FILES).map((c) => c.headers.Range);
    expect(ranges).toEqual(['bytes=0-1023', 'bytes=1024-2047', 'bytes=2048-3071', 'bytes=3072-4095', 'bytes=4096-5119', 'bytes=5120-6143']);
  });

  it('reads an empty file (416 on the first range)', async () => {
    mockFetch(filesRoute(new Map([['/tmp/empty', Buffer.alloc(0)]]), { direct: directWithFiles() }));
    const sandbox = await provider().sandbox.create();
    expect(await sandbox.filesystem.readFile('/tmp/empty')).toBe('');
  });

  it('reports a missing file as ENOENT, and permission or a full disk as EACCES and ENOSPC', async () => {
    mockFetch(
      filesRoute(new Map(), {
        direct: directWithFiles(),
        host: (call) => {
          if (query(call, 'path') === '/proc/x') return { status: 403, body: { error: 'Operation not permitted' } };
          if (query(call, 'path') === '/full') return { status: 507, body: { error: 'disk full' } };
          return null;
        },
      }),
    );
    const sandbox = await provider().sandbox.create();
    await expect(sandbox.filesystem.readFile('/tmp/nope')).rejects.toThrow(/ENOENT: no such file or directory, open '\/tmp\/nope'/);
    await expect(sandbox.filesystem.writeFile('/proc/x', 'x')).rejects.toThrow(/EACCES: permission denied, write '\/proc\/x'/);
    await expect(sandbox.filesystem.writeFile('/full', 'x')).rejects.toThrow(/ENOSPC/);
  });

  it.each([401, 409, 501, 530])('goes through the API when the host refuses the direct token (%i)', async (status) => {
    const store = new Map<string, Buffer>();
    const calls = mockFetch(filesRoute(store, { direct: directWithFiles(), host: () => ({ status, body: { error: 'no' } }) }));
    const sandbox = await provider().sandbox.create();
    await sandbox.filesystem.writeFile('/tmp/a', 'via api');
    expect(store.get('/tmp/a')!.toString()).toBe('via api');
    expect(fileCalls(calls, 'PUT')[0].headers.Authorization).toBe('Bearer k8c_test_key');
    // A refused token (401) or a host without direct files (501) is not tried again.
    await sandbox.filesystem.readFile('/tmp/a');
    expect(fileCalls(calls, 'GET', HOST_FILES)).toHaveLength(status === 401 || status === 501 ? 0 : 1);
  });

  it('uses the API for files when the direct token does not cover them, or is about to expire', async () => {
    for (const direct of [{ ...directWithFiles(), files_url: undefined }, directWithFiles(5_000)]) {
      const store = new Map<string, Buffer>();
      const calls = mockFetch(filesRoute(store, { direct: direct as any }));
      const sandbox = await provider().sandbox.create();
      await sandbox.filesystem.writeFile('/tmp/a', 'x');
      expect(fileCalls(calls, 'PUT', HOST_FILES)).toHaveLength(0);
      expect(fileCalls(calls, 'PUT')).toHaveLength(1);
    }
  });

  it('retries a part that failed with a server error', async () => {
    const store = new Map<string, Buffer>();
    let failures = 0;
    const calls = mockFetch(
      filesRoute(store, { host: (c) => (query(c, 'offset') === String(PART) && failures++ < 2 ? { status: 503, body: { error: 'host_busy' } } : null), direct: directWithFiles() }),
    );
    const sandbox = await provider().sandbox.create();
    const content = 'z'.repeat(2 * PART);
    await sandbox.filesystem.writeFile('/tmp/r', content);
    expect(fileCalls(calls, 'PUT', HOST_FILES).filter((c) => query(c, 'offset') === String(PART))).toHaveLength(3);
    expect(store.get('/tmp/r')!.toString()).toBe(content);
  });

  it('starts no more parts after one fails', async () => {
    const calls = mockFetch(
      filesRoute(new Map(), { direct: directWithFiles(), host: (c) => (query(c, 'offset') === String(PART) ? { status: 400, body: { error: 'bad' } } : null) }),
    );
    const sandbox = await provider().sandbox.create();
    await expect(sandbox.filesystem.writeFile('/tmp/x', 'q'.repeat(20 * PART))).rejects.toThrow(/\(400\)/);
    expect(fileCalls(calls, 'PUT', HOST_FILES).length).toBeLessThanOrEqual(5);
  });

  it('on an older host, writes /workspace through its file API and other paths over exec', async () => {
    const store = new Map<string, Buffer>();
    const calls = mockFetch(filesRoute(store, { api: 'legacy' }));
    const sandbox = await provider().sandbox.create();
    await sandbox.filesystem.writeFile('/workspace/a.txt', 'in workspace');
    expect(store.get('/workspace/a.txt')!.toString()).toBe('in workspace');
    expect(execs(calls)).toHaveLength(0);
    await sandbox.filesystem.writeFile('/tmp/b.txt', 'hello\nü');
    const [e] = execs(calls);
    expect(e.body.cmd[2]).toMatch(/mkdir -p .* base64 -d > "\/tmp\/b\.txt\.computesdk-[0-9a-f]{12}" && mv -f /);
    expect(Buffer.from(e.body.env[0].replace(/^KOSA8_CHUNK=/, ''), 'base64').toString('utf8')).toBe('hello\nü');
  });

  it('on an older host, reads a file over 8 MiB over exec in 1 MiB chunks', async () => {
    Object.assign(fileParts, saved);
    const content = Buffer.from('c'.repeat(INLINE_READ_BYTES * 2 + 7));
    const calls = mockFetch(
      filesRoute(new Map([['/workspace/big', Buffer.alloc(9 * 1024 * 1024)]]), {
        api: 'legacy',
        exec: (call) => {
          const skip = /skip=(\d+) count=1/.exec(call.body.cmd[2]);
          if (skip) {
            const i = Number(skip[1]);
            return { exit: 0, stdout: content.subarray(i * INLINE_READ_BYTES, (i + 1) * INLINE_READ_BYTES).toString('base64') };
          }
          return { exit: 0, stdout: `${content.length}\n` };
        },
      }),
    );
    const sandbox = await provider().sandbox.create();
    expect(await sandbox.filesystem.readFile('/workspace/big')).toBe(content.toString('utf8'));
    expect(execs(calls)).toHaveLength(4);
  });

  it('on a host without any file API, uses exec and remembers it', async () => {
    const calls = mockFetch(filesRoute(new Map(), { api: 'none', exec: () => ({ exit: 0, stdout: `6\n${Buffer.from('hello\n').toString('base64')}\n` }) }));
    const sandbox = await provider().sandbox.create();
    expect(await sandbox.filesystem.readFile('/tmp/a.txt')).toBe('hello\n');
    expect(await sandbox.filesystem.readFile('/tmp/a.txt')).toBe('hello\n');
    expect(fileCalls(calls, 'GET')).toHaveLength(1);
    expect(execs(calls)).toHaveLength(2);
  });

  it('fails an exec read whose output the API cut off, rather than return part of the file', async () => {
    mockFetch(filesRoute(new Map(), { api: 'none', exec: () => ({ exit: 0, stdout: '5\naGVsbG8=', stdout_truncated: true }) }));
    const sandbox = await provider().sandbox.create();
    await expect(sandbox.filesystem.readFile('/tmp/a')).rejects.toThrow(/cut off/);
  });

  it('reports a failed exec write on an older host, and the command removes its temporary file', async () => {
    const calls = mockFetch(filesRoute(new Map(), { api: 'none', exec: () => ({ exit: 1, stderr: 'read-only' }) }));
    const sandbox = await provider().sandbox.create();
    await expect(sandbox.filesystem.writeFile('/ro/file', 'data')).rejects.toThrow(/write '\/ro\/file' failed \(exit 1\): read-only/);
    expect(execs(calls)[0].body.cmd[2]).toMatch(/\|\| \{ s=\$\?; rm -f "\/ro\/file\.computesdk-[0-9a-f]{12}"; exit \$s; \}$/);
  });

  it('checks existence', async () => {
    mockFetch(filesRoute(new Map(), { exec: () => ({ exit: 0, stdout: 'no\n' }) }));
    const sandbox = await provider().sandbox.create();
    expect(await sandbox.filesystem.exists('/tmp/missing')).toBe(false);
  });
});

describe('kosa8 exec output truncation', () => {
  it('reports the API cutting off a command output', async () => {
    mockFetch(
      filesRoute(new Map(), {
        exec: () => ({ exit: 0, stdout: 'abc', stdout_truncated: true, stderr_truncated: false, stdout_bytes: 5_000_000, stderr_bytes: 0 } as any),
      }),
    );
    const sandbox = await provider().sandbox.create();
    const r: any = await sandbox.runCommand('yes | head -c 5000000');
    expect(r).toMatchObject({ stdout: 'abc', truncated: true, stdoutTruncated: true, stderrTruncated: false, stdoutBytes: 5_000_000, stderrBytes: 0 });
  });

  it('adds nothing when the API does not report it', async () => {
    mockFetch(filesRoute(new Map(), { exec: () => ({ exit: 0, stdout: 'ok' }) }));
    const sandbox = await provider().sandbox.create();
    const r: any = await sandbox.runCommand('echo ok');
    expect(r.truncated).toBeUndefined();
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
