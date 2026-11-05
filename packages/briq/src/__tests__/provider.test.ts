import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { BriqOperationError, type Command } from '@briq-cloud/sdk';
import { daemonSeedScript } from 'daemond';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import * as launcher from '../launcher';
const state = vi.hoisted(() => ({
  guest: {} as Record<string, Record<string, string>>,
  rows: [] as Array<{
    id: string;
    labels: Record<string, string>;
    state: string;
    createdAt: number;
  }>,
  run: vi.fn(),
  creates: vi.fn(),
  destroys: vi.fn(),
  previews: vi.fn(),
  files: {
    mkdir: vi.fn(),
    read: vi.fn(),
    write: vi.fn(),
    stat: vi.fn(),
    remove: vi.fn(),
    list: vi.fn(),
  },
}));
vi.mock('@briq-cloud/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@briq-cloud/sdk')>()),
  nativeSandbox: () => ({
    create: async (input: { labels: Record<string, string>; env?: Record<string, string> }) => {
      state.creates(input);
      const row = { id: 'bq_owned', labels: input.labels, state: 'running', createdAt: Date.now() };
      state.rows.push(row);
      state.guest[row.id] = { PATH: process.env.PATH ?? '/usr/bin:/bin', ...input.env };
      return row;
    },
    connect: async (id: string) => {
      const row = state.rows.find((r) => r.id === id);
      if (!row) throw new BriqOperationError('not_found', 'not found');
      return row;
    },
    list: async () => state.rows,
    destroy: async (id: string) => {
      state.destroys(id);
      state.rows = state.rows.filter((r) => r.id !== id);
      delete state.guest[id];
    },
    native: (id: string) => ({
      status: async () => ({
        ...state.rows.find((r) => r.id === id),
        createdAt: new Date().toISOString(),
      }),
    }),
    previewUrl: async (id: string, port: number) => {
      state.previews(id, port);
      return { url: 'https://private.invalid/?briq_token=fixture' };
    },
    run: (...args: unknown[]) => state.run(...args),
    files: state.files,
  }),
}));
import { briq } from '../index';
let root: string;
let payload: string | undefined;
const daemonPids = new Set<number>();
const invoke = promisify(execFile);
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'briq-computesdk-test-'));
  await mkdir(join(root, 'tmp'));
  await mkdir(join(root, 'home'));
  const original = launcher.launch;
  vi.spyOn(launcher, 'launch').mockImplementation((id, request, hash) => {
    payload = request === '{}' ? undefined : request;
    return original(id, request, hash);
  });
  state.run.mockImplementation(async (id, input) => {
    if (input.cmd[0] === '/usr/local/bin/python3') {
      const result = await invoke('/usr/bin/python3', input.cmd.slice(1), {
        cwd: root,
        env: state.guest[id],
        timeout: 5000,
      });
      input.onChunk({ stream: 'stdout', text: result.stdout });
      return { exitCode: 0, timedOut: false };
    }
    const request = payload;
    payload = undefined;
    if (request === undefined) return { exitCode: 0, timedOut: false }; // Native image preparation is a separate boundary.
    expect(input.cmd).toContain('-i');
    expect(input.cmd).toContain('-s');
    expect(input.env).toEqual({});
    expect(input.stdin).toContain('umask 077');
    expect(input.cmd.join(' ')).not.toContain('DAEMOND_NODE_SKIP_SHA256');
    // Run the actual pinned official launcher/daemon locally; no fake process completion.
    const script = daemonSeedScript({ name: 'briq-local-contract-test', ssePort: 38989 });
    const result = await invoke(process.execPath, ['-e', script, request], {
      cwd: root,
      env: { PATH: process.env.PATH, HOME: join(root, 'home'), TMPDIR: join(root, 'tmp') },
      timeout: 20000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const answer = JSON.parse(result.stdout.trim().split('\n').at(-1)!);
    if (Number.isInteger(answer.daemon?.pid)) daemonPids.add(answer.daemon.pid);
    input.onChunk({ stream: 'stdout', text: result.stdout });
    return { exitCode: 0, timedOut: false };
  });
  state.files.mkdir.mockResolvedValue(undefined);
});
afterAll(async () => {
  // Only daemon PIDs from this private fixture's creation receipts/state are eligible.
  try {
    const dir = join(root, 'tmp', '.computesdk', 'seed-daemon');
    for (const name of await readdir(dir)) {
      try {
        const saved = JSON.parse(await readFile(join(dir, name, 'state.json'), 'utf8'));
        if (Number.isInteger(saved.pid)) daemonPids.add(saved.pid);
      } catch {
        // No state for this entry: nothing to stop.
      }
    }
  } catch {
    // The daemon never started in this run.
  }
  for (const pid of daemonPids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
  await rm(root, { recursive: true, force: true });
});
it('fails unsupported create policy before allocation', async () => {
  const provider = briq({ apiKey: 'fixture' });
  for (const options of [
    { timeout: 1000 },
    { image: 'other' },
    { resources: { vcpus: 2 } },
    { egress: {} },
    { volumes: [{ volume: 'x', mountPath: '/x' }] },
  ]) {
    await expect(provider.instances.create(options as never)).rejects.toBeDefined();
  }
  expect(state.creates).not.toHaveBeenCalled();
});
it('creates with no exec and runs a plain command as the first and only exec', async () => {
  const provider = briq({ apiKey: 'fixture' });
  state.run.mockClear();
  state.creates.mockClear();
  const launch = vi.mocked(launcher.launch);
  launch.mockClear();
  const instance = await provider.instances.create();
  expect(state.creates).toHaveBeenCalledTimes(1);
  expect(state.run).not.toHaveBeenCalled();
  expect(launch).not.toHaveBeenCalled();
  await instance.runCommand('node -v');
  expect(state.run).toHaveBeenCalledTimes(1);
  expect(state.run.mock.calls[0][1]).toMatchObject({
    cmd: ['/bin/sh', '-c', 'node -v'],
    cwd: '/workspace',
    // Nobody reads the output as it comes: the SDK may use the plain HTTP route.
    live: false,
  });
  expect(launch).not.toHaveBeenCalled();
  await instance.destroy();
});
it('keeps the stream for a command with output callbacks', async () => {
  const provider = briq({ apiKey: 'fixture' });
  const instance = await provider.instances.create();
  state.run.mockClear();
  await instance.runCommand('node -v', { onStdout: () => {} });
  expect(state.run.mock.calls[0][1]).toMatchObject({ live: true });
  await instance.destroy();
});
it('verifies the launcher in the first daemon job, once, before the daemon starts', async () => {
  const provider = briq({ apiKey: 'fixture' });
  const instance = await provider.instances.create({ directory: root });
  state.run.mockClear();
  const handle = await instance.startProcess('true');
  await handle.wait({ timeout: 5000 });
  const controls = state.run.mock.calls
    .map(([, input]) => input)
    .filter((input) => input.cmd[0] === '/usr/bin/env');
  expect(controls.length).toBeGreaterThan(0);
  // No separate verification exec: the guard is the head of each job's stdin, ahead of the daemon script.
  const first = controls[0].stdin as string;
  expect(first.startsWith('umask 077\npython3 -c')).toBe(true);
  expect(first.split('|| exit 126')).toHaveLength(2);
  expect(first).toContain(launcher.NODE_SHA256);
  // The only exec before it is the guest environment read of the same job.
  const order = state.run.mock.calls.map(([, input]) => input.cmd[0]);
  expect(order.slice(0, 2)).toEqual(['/usr/local/bin/python3', '/usr/bin/env']);
  await instance.destroy();
}, 20000);
it('rejects a bad launcher state on first daemon use and does not touch plain commands', async () => {
  const provider = briq({ apiKey: 'fixture' });
  const instance = await provider.instances.create({ directory: root });
  const run = state.run.getMockImplementation()!;
  state.run.mockImplementationOnce(run); // the job's guest environment read
  state.run.mockImplementationOnce(async () => {
    // The guard failed (`|| exit 126`) before the daemon script.
    return { exitCode: 126, timedOut: false };
  });
  await expect(instance.startProcess('true')).rejects.toMatchObject({ code: 'unsupported' });
  // A user command that exits 126 is the user's result, not a launcher failure.
  state.run.mockImplementationOnce(async () => ({ exitCode: 126, timedOut: false }));
  expect(await instance.runCommand('./not-executable')).toMatchObject({ exitCode: 126 });
  await instance.destroy();
});
it('uses real official process handles for UTF-8 stdin, status, wait and acknowledged exit', async () => {
  const provider = briq({ apiKey: 'fixture' });
  const instance = await provider.instances.create({
    metadata: { purpose: 'fixture' },
    directory: root,
  });
  expect(provider.instances).toBe(provider.sandbox);
  const handle = await instance.startProcess('cat', { stdin: true });
  await handle.write('雪\n');
  await handle.write(new Uint8Array([65, 10]));
  await handle.closeStdin();
  const result = await handle.wait({ timeout: 5000 });
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe('雪\nA\n');
  expect((await handle.status()).status).toBe('exited');
  expect((await instance.getInfo()).metadata).toEqual({ purpose: 'fixture' });
  expect(state.creates.mock.calls.at(-1)?.[0].labels).toEqual({
    'briq/computesdk-metadata': JSON.stringify({ purpose: 'fixture' }),
    'briq/computesdk-directory': root,
  });
  expect(state.files.mkdir).toHaveBeenCalledWith(instance.instanceId, root);
  const reconnected = await briq({ apiKey: 'fixture' }).instances.getById(instance.instanceId);
  expect((await reconnected!.getInfo()).metadata).toEqual({ purpose: 'fixture' });
  await reconnected!.runCommand('pwd');
  expect(state.run.mock.calls.at(-1)?.[1].cwd).toBe(root);
  const url = await instance.getUrl({ port: 3000 });
  expect(url).toContain('briq_token=fixture');
  expect(state.previews).toHaveBeenCalledTimes(1);
  const detached = await instance.runCommand('sleep 5; echo "a b"', {
    background: true,
    cwd: root,
    env: { K: 'v' },
  });
  expect(detached).toMatchObject({ stdout: '', stderr: '', exitCode: 0 });
  const launch = state.run.mock.calls.at(-1)?.[1];
  expect(launch.cmd).toEqual([
    '/bin/sh',
    '-c',
    'nohup sh -c "$1" </dev/null >/dev/null 2>&1 &',
    'sh',
    'sleep 5; echo "a b"',
  ]);
  expect(launch).toMatchObject({ cwd: root, env: { K: 'v' }, stdin: '' });
  await instance.destroy();
  expect(state.destroys).toHaveBeenCalledWith('bq_owned');
}, 20000);
it('polls official process callbacks without exposing any internal daemon port and keeps kill separate from wait', async () => {
  const provider = briq({ apiKey: 'fixture' });
  const instance = await provider.instances.create({ directory: root });
  state.previews.mockClear();
  let output = '';
  let exited = false;
  const handle = await instance.startProcess('printf ready; sleep 20', {
    onStdout: (chunk) => {
      output += chunk;
    },
    onExit: () => {
      exited = true;
    },
    pollIntervalMs: 20,
  });
  await vi.waitFor(() => expect(output).toBe('ready'), { timeout: 5000 });
  expect(state.previews).not.toHaveBeenCalled();
  await handle.kill('SIGTERM');
  const status = await handle.wait({ timeout: 5000 });
  expect(status.signal).toBe('SIGTERM');
  expect(status.exitCode).toBe(-1);
  expect(exited).toBe(true);
  await instance.destroy();
}, 20000);
it('keeps UTF-8 file bytes on the native API and refuses unrepresentable symlink metadata', async () => {
  const provider = briq({ apiKey: 'fixture' });
  const instance = await provider.instances.create({ directory: root });
  state.files.read.mockResolvedValue(new TextEncoder().encode('雪\0binary'));
  expect(await instance.filesystem.readFile('/workspace/雪')).toBe('雪\0binary');
  await instance.filesystem.writeFile('/workspace/雪', '雪\0binary');
  expect(state.files.write).toHaveBeenCalledWith(
    'bq_owned',
    '/workspace/雪',
    new TextEncoder().encode('雪\0binary'),
  );
  state.files.list.mockResolvedValue([
    { path: '/workspace/link', type: 'symlink', size: 3, modifiedAt: 0 },
  ]);
  await expect(instance.filesystem.readdir('/workspace')).rejects.toMatchObject({
    code: 'unsupported',
  });
  await instance.destroy();
});

it('preserves native loss and distinguishes launcher timeout from detached child cleanup', async () => {
  const provider = briq({ apiKey: 'fixture' });
  const instance = await provider.instances.create({ directory: root });
  state.run.mockImplementationOnce(async () => {
    throw new BriqOperationError('outcome_unknown', 'Native acknowledgement missing');
  });
  const count = state.run.mock.calls.length;
  await expect(instance.runCommand('true')).rejects.toMatchObject({ code: 'outcome_unknown' });
  expect(state.run.mock.calls.length).toBe(count + 1);
  state.run.mockImplementationOnce(async (_id, input) => {
    input.onChunk({ stream: 'stdout', text: '{}' });
    return { exitCode: 0, timedOut: false };
  });
  state.run.mockImplementationOnce(async () => ({ exitCode: null, timedOut: true }));
  await expect(instance.startProcess('sleep 5')).rejects.toMatchObject({
    code: 'timeout',
    message: 'Daemon control timed out; detached process state must be inspected separately',
  });
  await instance.destroy();
});

it('inherits exact persisted guest env after reconnect and applies per-call overrides only inside jobs', async () => {
  const initial = briq({ apiKey: 'fixture' });
  const envs = {
    TOKEN: 'creation-canary',
    EMPTY: '',
    TEMPLATE: '{{briq:missing}}\n{{self:host}} {{secret:missing}} 雪',
    OVERRIDE: 'creation',
    DAEMOND_NODE_SKIP_SHA256: '1',
  };
  const first = await initial.instances.create({ directory: root, envs });
  const reconnect = briq({ apiKey: 'fixture' });
  const instance = await reconnect.instances.getById(first.instanceId);
  expect(instance).not.toBeNull();
  const reads = state.run.mock.calls.filter(
    ([, input]) => input.cmd[0] === '/usr/local/bin/python3',
  ).length;
  const job = await instance!.startProcess(
    "node -e 'process.stdout.write(JSON.stringify({TOKEN:process.env.TOKEN,EMPTY:process.env.EMPTY,TEMPLATE:process.env.TEMPLATE,OVERRIDE:process.env.OVERRIDE,DAEMOND_NODE_SKIP_SHA256:process.env.DAEMOND_NODE_SKIP_SHA256}))'",
    { env: { OVERRIDE: 'per-call' } },
  );
  const result = await job.wait({ timeout: 5000 });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ ...envs, OVERRIDE: 'per-call' });
  expect(
    state.run.mock.calls.filter(([, input]) => input.cmd[0] === '/usr/local/bin/python3').length,
  ).toBeGreaterThan(reads);
  await instance!.destroy();
}, 20000);

it('sanitizes malformed factory output and every rejected process-handle operation', async () => {
  const provider = briq({ apiKey: 'fixture' });
  const instance = await provider.instances.create({ directory: root });
  const run = state.run.getMockImplementation()!;
  const sentinel = 'PRIVATE_FACTORY_TOKEN_SENTINEL';
  const malformed = async (id: string, input: Command) => {
    if (input.cmd[0] === '/usr/local/bin/python3') return run(id, input);
    payload = undefined;
    input.onChunk({ stream: 'stdout', text: sentinel });
    input.onChunk({ stream: 'stderr', text: sentinel });
    return { exitCode: 0, timedOut: false };
  };
  const rejected = async (operation: () => Promise<unknown>) => {
    let failure: unknown;
    try {
      await operation();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(BriqOperationError);
    if (!(failure instanceof BriqOperationError)) throw new Error('Expected sanitized rejection');
    expect(JSON.stringify(failure, Object.getOwnPropertyNames(failure))).not.toContain(sentinel);
  };
  try {
    state.run.mockImplementation(malformed);
    await rejected(() => instance.startProcess('true'));
  } finally {
    state.run.mockImplementation(run);
  }
  const handle = await instance.startProcess('cat', { stdin: true });
  try {
    state.run.mockImplementation(malformed);
    for (const operation of [
      () => handle.write('x'),
      () => handle.closeStdin(),
      () => handle.status(),
      () => handle.wait({ timeout: 5000 }),
      () => handle.kill(),
    ])
      await rejected(operation);
  } finally {
    state.run.mockImplementation(run);
  }
  await handle.closeStdin();
  await handle.wait({ timeout: 5000 });
  await instance.destroy();
}, 20000);
