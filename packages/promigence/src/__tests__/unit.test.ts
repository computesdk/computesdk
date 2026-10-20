/**
 * The provider through ComputeSDK's own front door (`compute({ provider })` and the instances it
 * returns), with Promigence faked at the SDK boundary: `FakeClient` replaces the client, and
 * the Promigence SDK's own `Sandbox` class runs for real on top of it. No test touches the network.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compute } from 'computesdk';
import { AuthError, EnvFailedError } from '@promigence/sdk';
import { promigence } from '../index';
import type { PromigenceConfig, PromigenceInstance } from '../index';
import { FakeClient } from './fake-client';
import type { FakeOptions } from './fake-client';

type Opts = Record<string, unknown>;

/** Every variable a key or an API address could be read from, cleared for each test and restored after. */
const CREDENTIAL_VAR = /^PROMIGENCE_|_API_KEY$|_API_URL$|_DOMAIN$|^XDG_CONFIG_HOME$/;
let savedEnv: NodeJS.ProcessEnv;
let configHome: string;

beforeEach(() => {
  savedEnv = { ...process.env };
  for (const k of Object.keys(process.env)) if (CREDENTIAL_VAR.test(k)) delete process.env[k];
  // No sign-in stored on this machine is ever read: only a file in an empty directory is looked at.
  configHome = mkdtempSync(join(tmpdir(), 'promigence-test-'));
  process.env.XDG_CONFIG_HOME = configHome;
  process.env.PROMIGENCE_CREDENTIAL_STORE = 'file';
});

afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
  rmSync(configHome, { recursive: true, force: true });
});

/** A provider over a fresh fake, as the one ComputeSDK provider. */
function setup(fake: FakeOptions = {}, config: Omit<PromigenceConfig, 'client'> = {}) {
  const client = new FakeClient(fake);
  const provider = promigence({ client: client.asClient(), ...config });
  const c = compute({ provider, fallbackOnError: false });
  return { client, provider, c };
}

const arg = (args: unknown[], i: number): Opts => args[i] as Opts;

describe('promigence provider (unit, fake client)', () => {
  it('create, run a command and destroy through compute.instances', async () => {
    const { client, provider, c } = setup();
    expect(provider.name).toBe('promigence');

    const sandbox = await c.instances.create();
    expect(sandbox.provider).toBe('promigence');
    expect(sandbox.instanceId).toMatch(/^sbx_\d+$/);

    // One sandbox of the built-in base, handed over when ready.
    const start = arg(client.last('runs.start'), 0);
    expect(start.snapshot).toBe('promigence/base');
    expect(start.count).toBe(1);
    expect(client.names()).not.toContain('runs.waitReady');

    const r = await sandbox.runCommand('node -v');
    expect(r).toMatchObject({ exitCode: 0, stdout: 'v22.12.0\n', stderr: '' });
    expect(typeof r.durationMs).toBe('number');
    const exec = client.last('sandboxes.exec');
    expect(exec[0]).toBe(sandbox.instanceId);
    expect(arg(exec, 1).sh).toBe('node -v');

    await sandbox.destroy();
    expect(client.last('sandboxes.kill')[0]).toBe(sandbox.instanceId);
    // Destroy is one request.
    expect(client.names().slice(-2)).toEqual(['sandboxes.exec', 'sandboxes.kill']);
  });

  it('hands over a sandbox that starts queued once it is ready', async () => {
    const { client, c } = setup({ readyLater: true });
    const sandbox = await c.instances.create();
    expect(sandbox.instanceId).toMatch(/^sbx_/);
    expect(client.names()).toContain('runs.waitReady');
  });

  it('filesystem: write, read, exists, mkdir, readdir, remove', async () => {
    const { client, c } = setup();
    const sandbox = await c.instances.create();
    const fs = sandbox.filesystem;

    await fs.writeFile('/work/hello.txt', 'Hello, ComputeSDK filesystem!');
    expect(client.last('files.put')[2]).toBe('Hello, ComputeSDK filesystem!');
    expect(await fs.readFile('/work/hello.txt')).toBe('Hello, ComputeSDK filesystem!');
    expect(await fs.exists('/work/hello.txt')).toBe(true);
    expect(await fs.exists('/work/nope')).toBe(false);

    await fs.mkdir('/work/dir with space');
    expect(arg(client.last('sandboxes.exec'), 1).sh).toBe('mkdir -p -- "/work/dir with space"');
    expect(await fs.exists('/work/dir with space')).toBe(true);

    await fs.writeFile('/work/dir with space/a.txt', 'a');
    const entries = await fs.readdir('/work');
    expect(entries.map((e) => [e.name, e.type, e.size]).sort()).toEqual([
      ['dir with space', 'directory', 4096],
      ['hello.txt', 'file', 29],
    ]);
    expect(entries[0].modified).toBeInstanceOf(Date);

    await fs.remove('/work/dir with space');
    expect(arg(client.last('sandboxes.exec'), 1).sh).toBe('rm -rf -- "/work/dir with space"');
    expect(await fs.exists('/work/dir with space')).toBe(false);
    expect(await fs.exists('/work/dir with space/a.txt')).toBe(false);

    await expect(fs.readFile('/nonexistent/file.txt')).rejects.toMatchObject({
      name: 'NotFoundError',
      code: 'not_found',
      message: expect.stringMatching(/^Promigence read of \/nonexistent\/file\.txt failed \(not_found\)/),
    });
  });

  it('filesystem: a path is quoted with escapeShellArg inside double quotes', async () => {
    const { client, c } = setup();
    const sandbox = await c.instances.create();
    const path = '/work/a "b" $HOME `id` \\ c';

    await sandbox.filesystem.mkdir(path);
    expect(arg(client.last('sandboxes.exec'), 1).sh).toBe('mkdir -p -- "/work/a \\"b\\" \\$HOME \\`id\\` \\\\ c"');
    // The shell reads the quoted text back as the same path.
    expect(client.fs.has(path)).toBe(true);

    await sandbox.filesystem.remove(path);
    expect(arg(client.last('sandboxes.exec'), 1).sh).toBe('rm -rf -- "/work/a \\"b\\" \\$HOME \\`id\\` \\\\ c"');
    expect(client.fs.has(path)).toBe(false);
  });

  it('filesystem: a failed mkdir is an error naming the operation', async () => {
    const { client, c } = setup();
    const sandbox = await c.instances.create();
    client.sandboxes.exec = async () => ({ exec_id: 'exec_x', exit_code: 1, stdout: '', stderr: 'mkdir: Permission denied\n' });
    await expect(sandbox.filesystem.mkdir('/root/x')).rejects.toThrow('Promigence mkdir of /root/x failed (exit 1): mkdir: Permission denied');
  });

  it('getUrl: throws a clear error and sends nothing', async () => {
    const { client, c } = setup();
    const sandbox = await c.instances.create();
    const before = client.calls.length;
    await expect(sandbox.getUrl({ port: 3000 })).rejects.toMatchObject({
      name: 'UnsupportedError',
      code: 'unsupported',
      message: expect.stringContaining('Promigence does not offer preview URLs yet'),
    });
    await expect(sandbox.getUrl({ port: 8080, protocol: 'wss' })).rejects.toThrow(/port 8080/);
    expect(client.calls.length).toBe(before);
  });

  it("getInfo: the sandbox's state folds into running | stopped", async () => {
    const { client, c } = setup();
    const sandbox = await c.instances.create({ timeout: 600_000 });
    const info = await sandbox.getInfo();
    expect(info).toMatchObject({ id: sandbox.instanceId, provider: 'promigence', status: 'running', timeout: 600_000 });
    expect(info.createdAt.toISOString()).toBe('2030-01-02T03:04:05.000Z');
    expect(info.metadata).toMatchObject({ state: 'ready', snapshot: 'promigence/base' });
    expect(info.metadata?.runId).toMatch(/^run_/);

    await sandbox.destroy();
    client.sandboxes.get = async (id: string) => ({ sandbox_id: id, state: 'ended', outcome: 'completed' }) as never;
    const after = await sandbox.getInfo();
    expect(after.status).toBe('stopped');
    expect(after.metadata?.outcome).toBe('completed');
  });

  it('create options: templateId / snapshotId pick the snapshot; timeout, envs, metadata and network are passed on', async () => {
    const { client, c } = setup();
    await c.instances.create({
      templateId: 'myapp@0123abc',
      timeout: 600_000,
      envs: { A: '1' },
      metadata: { run: 'nightly', n: 3 },
      allowInternetAccess: false,
    });
    let start = arg(client.last('runs.start'), 0);
    expect(start).toMatchObject({ snapshot: 'myapp@0123abc', timeoutMs: 600_000, labels: { run: 'nightly', n: '3' }, network: 'none' });

    await c.instances.create({ snapshotId: 'snap_abc', allowHosts: ['example.com'] });
    start = arg(client.last('runs.start'), 0);
    expect(start).toMatchObject({ snapshot: 'snap_abc', network: { allow: ['example.com'] } });

    // envs ride along on every command of that sandbox.
    const sandbox = await c.instances.create({ envs: { A: '1' } });
    await sandbox.runCommand('env', { env: { B: '2' } });
    expect(arg(client.last('sandboxes.exec'), 1).env).toEqual({ A: '1', B: '2' });
  });

  it('create options: an image is built on first use or reused; image with a snapshot is refused', async () => {
    const { client, c } = setup();
    const digest = `registry.example.com/team/app@sha256:${'a'.repeat(64)}`;
    const sandbox = await c.instances.create({ image: digest, tier: 'medium' });
    expect(arg(client.last('snapshots.create'), 0)).toMatchObject({ image: digest, tier: 'medium' });
    expect(arg(client.last('runs.start'), 0).snapshot).toBe('snap_img1');
    expect(sandbox.instanceId).toMatch(/^sbx_/);

    const calls = client.calls.length;
    await expect(c.instances.create({ image: digest, templateId: 'x' })).rejects.toMatchObject({
      name: 'InvalidArgumentError',
      message: expect.stringContaining("takes 'image' or a snapshot"),
    });
    expect(client.calls.length).toBe(calls);

    // A tag is sent as written.
    await c.instances.create({ image: 'node:22' });
    expect(arg(client.last('snapshots.create'), 0).image).toBe('node:22');
    // A malformed reference is refused before any request, with the SDK's code kept.
    await expect(c.instances.create({ image: 'Node:22' })).rejects.toMatchObject({
      name: 'InvalidArgumentError',
      code: 'invalid_argument',
      message: expect.stringMatching(/^Promigence sandbox create failed \(invalid_argument\)/),
    });
  });

  it('provider config: default snapshot, timeout and spendCap; create options override it', async () => {
    const { client, c } = setup({}, { snapshot: 'myorg/base', timeout: 120_000, spendCap: 0.5 });
    const sandbox = await c.instances.create();
    let start = arg(client.last('runs.start'), 0);
    expect(start).toMatchObject({ snapshot: 'myorg/base', timeoutMs: 120_000, spendCap: 0.5 });

    await sandbox.runCommand('node -v');
    expect(arg(client.last('sandboxes.exec'), 1).timeoutMs).toBe(120_000);
    await sandbox.runCommand('node -v', { timeout: 5000 });
    expect(arg(client.last('sandboxes.exec'), 1).timeoutMs).toBe(5000);

    await c.instances.create({ templateId: 'other', timeout: 1000, spendCap: 3 });
    start = arg(client.last('runs.start'), 0);
    expect(start).toMatchObject({ snapshot: 'other', timeoutMs: 1000, spendCap: 3 });
  });

  it('create options: optimizeFor reaches the start request, with the config as the default', async () => {
    const { client, c } = setup({}, { optimizeFor: 'compute' });
    await c.instances.create();
    expect(arg(client.last('runs.start'), 0).optimizeFor).toBe('compute');
    await c.instances.create({ optimizeFor: 'start' });
    expect(arg(client.last('runs.start'), 0).optimizeFor).toBe('start');

    const plain = setup();
    await plain.c.instances.create();
    expect('optimizeFor' in arg(plain.client.last('runs.start'), 0)).toBe(false);
  });

  it('spend cap: PROMIGENCE_SPEND_CAP applies when neither the config nor the options name one', async () => {
    const { client, c } = setup();
    process.env.PROMIGENCE_SPEND_CAP = '0.25';
    await c.instances.create();
    expect(arg(client.last('runs.start'), 0).spendCap).toBe(0.25);

    delete process.env.PROMIGENCE_SPEND_CAP;
    await c.instances.create();
    // None named: the organization's default applies.
    expect(arg(client.last('runs.start'), 0).spendCap).toBeUndefined();

    process.env.PROMIGENCE_SPEND_CAP = 'lots';
    const calls = client.calls.length;
    await expect(c.instances.create()).rejects.toThrow(/PROMIGENCE_SPEND_CAP \("lots"\) must be a number of US dollars/);
    await expect(c.instances.create({ spendCap: -1 })).rejects.toThrow(/'spendCap' must be a number of US dollars/);
    expect(client.calls.length).toBe(calls);
  });

  it('runCommand: a non-zero exit is a result, not an error; cwd, env and timeout reach the command', async () => {
    const { client, c } = setup();
    const sandbox = await c.instances.create();

    const bad = await sandbox.runCommand('nonexistent-command-12345');
    expect(bad.exitCode).toBe(127);
    expect(bad.stderr).toMatch(/not found/);

    const r = await sandbox.runCommand('exit 3', { cwd: '/work', env: { X: 'y' }, timeout: 9000 });
    expect(r.exitCode).toBe(3);
    expect(arg(client.last('sandboxes.exec'), 1)).toMatchObject({ cwd: '/work', env: { X: 'y' }, timeoutMs: 9000 });
  });

  it('runCommand background: started and answered at once with exit 0', async () => {
    const { client, c } = setup();
    const sandbox = await c.instances.create();
    const r = await sandbox.runCommand('sleep 1', { background: true });
    expect(r.exitCode).toBe(0);
    expect(arg(client.last('sandboxes.execBackground'), 1).sh).toBe('sleep 1');
    expect(client.names()).not.toContain('sandboxes.exec');
  });

  it('streaming: onStdout fires while the command runs, stderr is separate, the exit code is kept', async () => {
    const { client, c } = setup({ tickMs: 60 });
    const sandbox = await c.instances.create();

    const chunks: string[] = [];
    const startedAt = Date.now();
    let firstChunkAt: number | undefined;
    const r = await sandbox.runCommand(`sh -c 'for i in 1 2 3 4 5; do echo tick $i; sleep 1; done'`, {
      onStdout: (t: string) => {
        firstChunkAt ??= Date.now();
        chunks.push(t);
      },
    });
    expect(r.exitCode).toBe(0);
    expect(firstChunkAt).toBeDefined();
    expect((firstChunkAt as number) - startedAt).toBeLessThan(r.durationMs / 2);
    expect(chunks.join('')).toBe(r.stdout);
    for (let i = 1; i <= 5; i++) expect(r.stdout).toContain(`tick ${i}`);
    // Served by the provider: no command was run to start anything else first.
    expect(client.names()).toContain('execs.read');
    expect(client.names()).not.toContain('sandboxes.exec');

    const out: string[] = [];
    const err: string[] = [];
    const r2 = await sandbox.runCommand(`sh -c 'echo out; echo err 1>&2; exit 3'`, {
      onStdout: (t: string) => out.push(t),
      onStderr: (t: string) => err.push(t),
    });
    expect(r2.exitCode).toBe(3);
    expect(out.join('')).toContain('out');
    expect(err.join('')).toContain('err');
    expect(out.join('')).not.toContain('err');
  });

  it('streaming: a command that outruns its timeout is stopped and reported as exit 124', async () => {
    const { client, c } = setup();
    const sandbox = await c.instances.create();
    const r = await sandbox.runCommand(`sh -c 'echo starting; sleep 60'`, { timeout: 300, onStdout: () => {} });
    expect(r.exitCode).toBe(124);
    expect(r.durationMs).toBeLessThan(5000);
    expect(arg(client.last('sandboxes.execBackground'), 1).timeoutMs).toBe(300);
  });

  it("streaming: a command stopped at the config's timeout is reported as exit 124 too", async () => {
    const { client, c } = setup({}, { timeout: 300 });
    const sandbox = await c.instances.create();
    const r = await sandbox.runCommand(`sh -c 'echo starting; sleep 60'`, { onStdout: () => {} });
    expect(r.exitCode).toBe(124);
    expect(r.stdout).toBe('starting\n');
    expect(client.names()).not.toContain('execs.signal');
  });

  it('errors: a Promigence error keeps its name, code and fix; the original is its cause', async () => {
    const failure = new EnvFailedError('env_failed', 'the sandbox stopped answering', 'Run the command again.');
    const { client, c } = setup({ fail: { exec: failure } });
    const sandbox = await c.instances.create();
    await expect(sandbox.runCommand('node -v')).rejects.toMatchObject({
      name: 'EnvFailedError',
      code: 'env_failed',
      fix: 'Run the command again.',
      message: 'Promigence command failed (env_failed): the sandbox stopped answering. Run the command again.',
      cause: failure,
    });
    client.cfg.fail = {};

    const denied = setup({ fail: { create: new AuthError() } });
    await expect(denied.c.instances.create()).rejects.toMatchObject({
      name: 'AuthError',
      code: 'auth',
      message: expect.stringMatching(/^Promigence sandbox create failed \(auth\)/),
    });
    expect(denied.client.names().slice(-1)).toEqual(['runs.start']);
  });

  it('getById: a live sandbox connects, an unknown id is null; destroy of an unknown id is quiet', async () => {
    const { client, c } = setup();
    const created = await c.instances.create();
    const found = await c.instances.getById(created.instanceId);
    expect(found?.instanceId).toBe(created.instanceId);
    expect(client.last('sandboxes.get')[0]).toBe(created.instanceId);
    expect((await found!.runCommand('node -v')).exitCode).toBe(0);
    const info = await found!.getInfo();
    expect(info.metadata?.snapshot).toBe('promigence/base');
    expect(info.createdAt.toISOString()).toBe('2030-01-02T03:04:05.000Z');

    expect(await c.instances.getById('sbx_nope')).toBeNull();
    await expect(c.instances.destroy('sbx_nope')).resolves.toBeUndefined();
  });

  it('list: every sandbox that has not ended, each as a handle', async () => {
    const { client, c } = setup();
    const a = await c.instances.create();
    const b = await c.instances.create();
    await b.destroy();
    const all = await c.instances.list();
    expect(all.map((s) => s.instanceId)).toEqual([a.instanceId]);
    expect(arg(client.last('sandboxes.listPage'), 0)).toEqual({ limit: 50, state: ['queued', 'ready', 'running', 'paused'] });
  });

  it('list: sandboxes past the first page are listed too', async () => {
    const { c } = setup();
    const live: string[] = [];
    for (let i = 0; i < 3; i++) live.push((await c.instances.create()).instanceId);
    for (let i = 0; i < 55; i++) await (await c.instances.create()).destroy();
    for (let i = 0; i < 60; i++) live.push((await c.instances.create()).instanceId);
    const all = await c.instances.list();
    expect(all.length).toBe(63);
    expect(new Set(all.map((s) => s.instanceId))).toEqual(new Set(live));
  });

  it('getInstance(): the Promigence SDK sandbox, its client and the provider config', async () => {
    const client = new FakeClient();
    const provider = promigence({ client: client.asClient(), timeout: 42_000 });
    const sandbox = await provider.instances.create();
    const inst: PromigenceInstance = sandbox.getInstance();
    expect(inst.client).toBe(client);
    expect(inst.config.timeout).toBe(42_000);
    expect(inst.sandbox.sandboxId).toBe(sandbox.instanceId);
    expect(typeof inst.sandbox.fork).toBe('function');
  });

  it('snapshots: create from a sandbox is refused with the alternative named; list and delete map', async () => {
    const { client, provider, c } = setup({
      snapshots: [{ snapshot_id: 'snap_1', alias: 'myapp', commit: '0123abc4567', tier: 'medium', verified: true, created_at: '2030-02-03T00:00:00Z' }],
    });
    const sandbox = await c.instances.create();
    await expect(provider.snapshot!.create(sandbox.instanceId)).rejects.toMatchObject({
      name: 'UnsupportedError',
      code: 'unsupported',
      fix: expect.stringContaining('promigence snapshot create --image'),
    });
    await expect(c.snapshot.create(sandbox.instanceId)).rejects.toThrow(/does not create a snapshot from a running sandbox/);

    const list = await c.snapshot.list();
    expect(list.map((s) => [s.id, s.provider, s.metadata?.alias, s.metadata?.verified])).toEqual([['snap_1', 'promigence', 'myapp', true]]);
    expect(list[0].createdAt.toISOString()).toBe('2030-02-03T00:00:00.000Z');

    await c.snapshot.delete('snap_1');
    expect(client.last('snapshots.delete')[0]).toBe('snap_1');
    await expect(provider.snapshot!.delete('snap_unknown')).resolves.toBeUndefined();
  });

  it('templates: every template method throws, naming snapshots as the alternative', async () => {
    const { client, provider } = setup();
    for (const call of [
      () => provider.template!.create({ name: 'x' }),
      () => provider.template!.list(),
      () => provider.template!.delete('x'),
    ]) {
      await expect(call()).rejects.toMatchObject({ name: 'UnsupportedError', message: expect.stringContaining('a template is a snapshot') });
    }
    expect(client.calls).toEqual([]);
  });

  it('config: no key anywhere is a clear error before any request', async () => {
    const { client, c } = setup({ apiKey: '' });
    await expect(c.instances.create()).rejects.toMatchObject({
      name: 'AuthError',
      message: expect.stringContaining('Missing Promigence API key.'),
    });
    await expect(c.instances.create()).rejects.toThrow(/PROMIGENCE_API_KEY/);
    expect(client.calls).toEqual([]);
  });

  it('config: a bad value is refused before any request', async () => {
    const client = new FakeClient();
    const cases: Array<[PromigenceConfig, RegExp]> = [
      [{ apiUrl: 'not a url' }, /'apiUrl' must be an http\(s\) URL/],
      [{ timeout: 0 }, /'timeout' must be a number of milliseconds above 0/],
      [{ spendCap: Number.NaN }, /'spendCap' must be a number of US dollars/],
      [{ apiKey: 42 as unknown as string }, /'apiKey' must be a string/],
    ];
    for (const [config, message] of cases) {
      const provider = promigence({ client: client.asClient(), ...config });
      await expect(provider.instances.create()).rejects.toThrow(message);
    }
    process.env.PROMIGENCE_API_URL = 'ftp://example.com';
    await expect(promigence({ client: client.asClient() }).instances.create()).rejects.toThrow(/PROMIGENCE_API_URL must be an http\(s\) URL/);
    expect(client.calls).toEqual([]);
  });

  it('config: with no client, PROMIGENCE_API_KEY and PROMIGENCE_API_URL are read, and that API is called', async () => {
    const calls: Array<{ method: string; path: string; auth: string | undefined }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
      const u = new URL(String(url));
      const headers = new Headers(init.headers);
      calls.push({ method: init.method ?? 'GET', path: u.pathname, auth: headers.get('authorization') ?? undefined });
      const json = (status: number, v: unknown) =>
        new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
      if (init.method === 'POST' && u.pathname === '/v1/runs') {
        return json(201, { run_id: 'run_9', state: 'running', sandboxes: [{ sandbox_id: 'sbx_9', state: 'ready' }] });
      }
      if (init.method === 'POST' && u.pathname === '/v1/sandboxes/sbx_9/execs') {
        return json(200, { exec_id: 'exec_1', exit_code: 0, stdout: 'v22.12.0\n', stderr: '' });
      }
      if (init.method === 'DELETE' && u.pathname === '/v1/sandboxes/sbx_9') return json(200, { ok: true });
      return json(404, { error: { code: 'not_found', message: `no route ${init.method} ${u.pathname}`, fix: 'Check the route.' } });
    }) as typeof fetch;
    process.env.PROMIGENCE_API_KEY = 'prom_api_env';
    process.env.PROMIGENCE_API_URL = 'http://api.test/v1';
    process.env.PROMIGENCE_HTTP2 = '0';
    try {
      const sandbox = await compute({ provider: promigence({}) }).instances.create({ timeout: 60_000 });
      expect(sandbox.instanceId).toBe('sbx_9');
      expect((await sandbox.runCommand('node -v')).stdout).toBe('v22.12.0\n');
      await sandbox.destroy();
      expect(calls.map((x) => [x.method, x.path, x.auth])).toEqual([
        ['POST', '/v1/runs', 'Bearer prom_api_env'],
        ['POST', '/v1/sandboxes/sbx_9/execs', 'Bearer prom_api_env'],
        ['DELETE', '/v1/sandboxes/sbx_9', 'Bearer prom_api_env'],
      ]);

      // No key in the environment either: refused before any request.
      delete process.env.PROMIGENCE_API_KEY;
      await expect(compute({ provider: promigence({}), fallbackOnError: false }).instances.create()).rejects.toThrow(
        /Missing Promigence API key/
      );
      expect(calls.length).toBe(3);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('a multi-line heredoc command is sent as written', async () => {
    const { client, c } = setup();
    const sandbox = await c.instances.create();
    const script = '#!/usr/bin/env bash\necho $HOME `date`\n';
    const cmd = `cat > /tmp/job.sh <<'__END_OF_JOB__'\n${script}\n__END_OF_JOB__\nJOB=1 bash /tmp/job.sh`;
    const r = await sandbox.runCommand(cmd, { timeout: 600_000 });
    expect(r.exitCode).toBe(0);
    expect(arg(client.last('sandboxes.exec'), 1).sh).toBe(cmd);
    expect(new TextDecoder().decode(client.fs.get('/tmp/job.sh')?.data)).toBe(script);
  });
});
