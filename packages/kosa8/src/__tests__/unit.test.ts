import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBody, execArgv, execBody, kosa8, WRITE_CHUNK_CHARS } from '../index';

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
}

/** Stubs global fetch with a router; records every call. Never reaches the network. */
function mockFetch(route: (call: Call) => { status: number; body?: unknown }) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const call: Call = {
      url,
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const { status, body } = route(call);
    const text = body === undefined ? '' : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, text: async () => text } as Response;
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

  it.each(['cpu', 'memory', 'image', 'snapshotId', 'envs'])('rejects %s before calling the API', async (key) => {
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

  it('reports info, mapping a sleeping sandbox to stopped', async () => {
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
    state = 'sleeping';
    expect((await sandbox.getInfo()).status).toBe('stopped');
    state = 'error';
    expect((await sandbox.getInfo()).status).toBe('error');
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

  it('enforces a timeout inside the sandbox, reporting exit 124', () => {
    const [, , script] = execArgv('sleep 60', { timeout: 1500 });
    expect(script).toContain('timeout -s KILL 2 sh -c "sleep 60"');
    expect(script).toContain('exit 124');
  });
});

describe('kosa8 filesystem over exec', () => {
  it('writes a file in env-carried base64 chunks that fit the exec argument limit, then renames it', async () => {
    const content = 'x'.repeat(WRITE_CHUNK_CHARS) + '\nü';
    const calls = mockFetch(execRoute(() => ({ exit: 0 })));
    const sandbox = await provider().sandbox.create();
    await sandbox.filesystem.writeFile('/tmp/dir/file.txt', content);

    const execs = calls.filter((c) => c.url.endsWith('/exec'));
    for (const e of execs) for (const arg of e.body.cmd) expect(arg.length).toBeLessThanOrEqual(8192);
    expect(execs[0].body.cmd[2]).toContain('mkdir -p');
    const chunks = execs.filter((e) => e.body.env.length > 0).map((e) => e.body.env[0].replace(/^KOSA8_CHUNK=/, ''));
    expect(chunks.length).toBeGreaterThan(1);
    expect(Buffer.from(chunks.join(''), 'base64').toString('utf8')).toBe(content);
    expect(execs.at(-1)!.body.cmd[2]).toMatch(/^mv -f "\/tmp\/dir\/file\.txt\.computesdk-[0-9a-f]{12}" "\/tmp\/dir\/file\.txt"$/);
  });

  it('removes the temporary file when a write fails', async () => {
    const calls = mockFetch(execRoute((call) => (call.body.cmd[2].startsWith('mv') ? { exit: 1, stderr: 'read-only' } : { exit: 0 })));
    const sandbox = await provider().sandbox.create();
    await expect(sandbox.filesystem.writeFile('/ro/file', 'data')).rejects.toThrow(/write '\/ro\/file' failed \(exit 1\): read-only/);
    expect(calls.filter((c) => c.url.endsWith('/exec')).at(-1)!.body.cmd[2]).toMatch(/^rm -f /);
  });

  it('reads a file through base64', async () => {
    mockFetch(execRoute(() => ({ exit: 0, stdout: Buffer.from('hello\n').toString('base64') + '\n' })));
    const sandbox = await provider().sandbox.create();
    expect(await sandbox.filesystem.readFile('/tmp/a.txt')).toBe('hello\n');
  });

  it('checks existence', async () => {
    mockFetch(execRoute(() => ({ exit: 0, stdout: 'no\n' })));
    const sandbox = await provider().sandbox.create();
    expect(await sandbox.filesystem.exists('/tmp/missing')).toBe(false);
  });
});
