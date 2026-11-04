import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoxdError, ConflictError, MachineFileNotFoundError, NotFoundError } from '@boxd-sh/sdk';
import { boxd } from '../index';

const clientOptions: Array<Record<string, unknown>> = [];
const m = {
  create: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  delete: vi.fn(),
  start: vi.fn(),
  waitUntilReady: vi.fn(),
  exec: vi.fn(),
  streamExec: vi.fn(),
};
const proxies = { list: vi.fn(), create: vi.fn() };
const fs = { read: vi.fn(), write: vi.fn(), mkdir: vi.fn(), stat: vi.fn(), list: vi.fn(), exists: vi.fn(), remove: vi.fn() };
const snapshots = { create: vi.fn(), get: vi.fn(), list: vi.fn(), delete: vi.fn() };

vi.mock('@boxd-sh/sdk', () => {
  class BoxdError extends Error {
    constructor(message: string, readonly grpcCode?: number) {
      super(message);
    }
  }
  class NotFoundError extends BoxdError {}
  class ConflictError extends BoxdError {}
  class AuthenticationError extends BoxdError {}
  class FilesystemError extends BoxdError {}
  class MachineFileNotFoundError extends FilesystemError {}
  class MachineFileExistsError extends FilesystemError {}
  class Boxd {
    readonly machines = { ...m, proxies, fs };
    readonly snapshots = snapshots;
    constructor(options: Record<string, unknown>) {
      clientOptions.push(options);
    }
  }
  return { Boxd, BoxdError, NotFoundError, ConflictError, AuthenticationError, MachineFileNotFoundError, MachineFileExistsError };
});

function machine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm-1',
    name: 'computesdk-test',
    status: 'running',
    createdAt: new Date('2026-11-04T10:00:00Z'),
    region: 'fra',
    resources: { vcpu: 2 },
    org: { name: 'acme' },
    labels: { computesdk: 'true' },
    deleteAt: null,
    bootTimeMs: 6,
    ...overrides,
  };
}

/** An exec stream that plays the given chunks, hangs until closed, or fails. */
function fakeStream(opts: { stdout?: string[]; stderr?: string[]; exitCode?: number; hang?: boolean; fail?: Error }) {
  const enc = new TextEncoder();
  let release!: () => void;
  const closed = new Promise<void>((resolve) => (release = resolve));
  const cancelled = () => new BoxdError('Cancelled on client', 1);
  async function* play(chunks: string[] = []) {
    for (const chunk of chunks) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      yield enc.encode(chunk);
    }
    if (opts.hang) {
      await closed;
      throw cancelled();
    }
  }
  return {
    stdout: play(opts.stdout),
    stderr: play(opts.stderr),
    wait: () =>
      opts.fail
        ? Promise.reject(opts.fail)
        : opts.hang
          ? closed.then(() => Promise.reject(cancelled()))
          : Promise.resolve(opts.exitCode ?? 0),
    close: vi.fn(() => release()),
  };
}

const provider = () => boxd({ apiKey: 'bxd_test', org: 'acme' });

async function created(options: Record<string, unknown> = {}) {
  m.create.mockResolvedValueOnce(machine());
  m.waitUntilReady.mockResolvedValueOnce(machine());
  return provider().instances.create(options);
}

beforeEach(() => {
  for (const fn of [...Object.values(m), ...Object.values(proxies), ...Object.values(fs), ...Object.values(snapshots)]) fn.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('config', () => {
  it('throws a helpful error without an API key', async () => {
    vi.stubEnv('BOXD_API_KEY', '');
    vi.stubEnv('BOXD_TOKEN', '');
    await expect(boxd({}).instances.create()).rejects.toThrow(/BOXD_API_KEY/);
  });

  it('reads the key and org from the environment', async () => {
    vi.stubEnv('BOXD_API_KEY', 'bxd_env');
    vi.stubEnv('BOXD_ORG', 'env-org');
    m.create.mockResolvedValueOnce(machine());
    m.waitUntilReady.mockResolvedValueOnce(machine());
    await boxd({}).instances.create();
    expect(clientOptions.at(-1)).toMatchObject({ apiKey: 'bxd_env' });
    expect(m.create.mock.calls[0][0]).toMatchObject({ org: 'env-org' });
  });
});

describe('create', () => {
  it('creates an isolated, labelled computer and waits until it is ready', async () => {
    const sandbox = await created();
    const params = m.create.mock.calls[0][0];
    expect(params).toMatchObject({ org: 'acme', isolated: true, labels: { computesdk: 'true' } });
    expect(params.name).toMatch(/^computesdk-[0-9a-f]{8}$/);
    expect(m.waitUntilReady).toHaveBeenCalledWith('m-1', { region: 'fra' });
    expect(sandbox.instanceId).toBe('m-1');
    expect(sandbox.provider).toBe('boxd');
  });

  it('maps timeout to a delete-after timer in seconds', async () => {
    await created({ timeout: 90_500 });
    expect(m.create.mock.calls[0][0].deleteAfter).toBe(91);
  });

  it('maps vcpus or memory onto a boxd size', async () => {
    await created({ vcpus: 4 });
    expect(m.create.mock.calls[0][0].config).toEqual({ vcpu: 4, memory: '16G' });
    await created({ memoryMiB: 8192 });
    expect(m.create.mock.calls[1][0].config).toEqual({ vcpu: 2, memory: '8G' });
  });

  it('refuses a size boxd does not have', async () => {
    await expect(provider().instances.create({ vcpus: 2, memoryMiB: 4096 })).rejects.toThrow(/1 vCPU \/ 4 GiB, 2 vCPU \/ 8 GiB/);
    expect(m.create).not.toHaveBeenCalled();
  });

  it('creates from a snapshot', async () => {
    await created({ snapshotId: 'snap-1' });
    expect(m.create.mock.calls[0][0]).toMatchObject({ fromSnapshot: 'snap-1', isolated: true });
  });

  it('refuses an image', async () => {
    await expect(provider().instances.create({ image: 'node:22' })).rejects.toThrow(/snapshotId/);
  });

  it('deletes the computer when it never becomes ready', async () => {
    m.create.mockResolvedValueOnce(machine());
    m.waitUntilReady.mockRejectedValueOnce(new Error('not ready after 90s'));
    m.delete.mockResolvedValueOnce(undefined);
    await expect(provider().instances.create()).rejects.toThrow('not ready');
    expect(m.delete).toHaveBeenCalledWith('m-1', { region: 'fra' });
  });

  it('reports standard size classes as unsupported', async () => {
    const resolution = provider().sizes.resolve('md');
    expect(resolution.status).toBe('unsupported');
    await expect(provider().instances.create({ sizeClass: 'md' })).rejects.toThrow(/none equals a standard size class/);
  });
});

describe('lookup', () => {
  it('returns null for a computer that does not exist', async () => {
    m.get.mockRejectedValueOnce(new NotFoundError('machine not found', 5));
    m.list.mockResolvedValueOnce([]);
    expect(await provider().instances.getById('gone')).toBeNull();
  });

  it('lists only computers with the computesdk label, in every region', async () => {
    m.list.mockResolvedValueOnce([machine(), machine({ id: 'm-2', region: 'nyc' })]);
    const all = await provider().instances.list();
    expect(m.list).toHaveBeenCalledWith({ org: 'acme', region: 'all', labels: { computesdk: 'true' } });
    expect(all.map((s) => s.instanceId)).toEqual(['m-1', 'm-2']);
  });

  it('ignores a computer that is already gone on destroy', async () => {
    m.delete.mockRejectedValueOnce(new NotFoundError('machine not found', 5));
    m.list.mockResolvedValueOnce([]);
    await expect(provider().instances.destroy('gone')).resolves.toBeUndefined();
    expect(m.delete).toHaveBeenCalledTimes(1);
  });
});

// boxd answers "not found" for a computer in another region than the one asked, and for a
// moment about one it has just created. A listing of every region decides.
describe('regions and "not found"', () => {
  const notFound = () => new NotFoundError('VM not found (region fra)', 5);
  const ok = { stdout: 'ok\n', stderr: '', exitCode: 0, success: true };

  it('destroys a computer in another region, found by id', async () => {
    m.delete.mockRejectedValueOnce(notFound()).mockResolvedValueOnce(undefined);
    m.list.mockResolvedValueOnce([machine({ id: 'nyc-1', region: 'nyc' })]);
    await provider().instances.destroy('nyc-1');
    expect(m.list).toHaveBeenCalledWith({ org: 'acme', region: 'all' });
    expect(m.delete).toHaveBeenNthCalledWith(1, 'nyc-1', {});
    expect(m.delete).toHaveBeenNthCalledWith(2, 'nyc-1', { region: 'nyc' });
  });

  it('gets a computer in another region, found by id', async () => {
    m.get.mockRejectedValueOnce(notFound()).mockResolvedValueOnce(machine({ id: 'nyc-2', region: 'nyc' }));
    m.list.mockResolvedValueOnce([machine({ id: 'nyc-2', region: 'nyc' })]);
    const found = await provider().instances.getById('nyc-2');
    expect(found?.getInstance().region).toBe('nyc');
    expect(m.get).toHaveBeenLastCalledWith('nyc-2', { region: 'nyc' });
  });

  it('retries a call while the listing still shows the computer', async () => {
    m.get.mockResolvedValueOnce(machine({ id: 'old-1' }));
    const sandbox = await provider().instances.getById('old-1');
    m.exec.mockRejectedValueOnce(notFound()).mockResolvedValueOnce(ok);
    m.list.mockResolvedValueOnce([machine({ id: 'old-1' })]);
    expect((await sandbox!.runCommand('echo ok')).stdout).toBe('ok\n');
    expect(m.exec).toHaveBeenCalledTimes(2);
  });

  it('believes "not found" once the listing agrees', async () => {
    m.get.mockResolvedValueOnce(machine({ id: 'old-2' }));
    const sandbox = await provider().instances.getById('old-2');
    m.exec.mockRejectedValueOnce(notFound());
    m.list.mockResolvedValueOnce([]);
    await expect(sandbox!.runCommand('echo ok')).rejects.toThrow('VM not found');
    expect(m.exec).toHaveBeenCalledTimes(1);
  });

  it('retries a computer it just created, even before the listing shows it', async () => {
    const sandbox = await created();
    m.exec.mockRejectedValueOnce(notFound()).mockResolvedValueOnce(ok);
    m.list.mockResolvedValueOnce([]);
    expect((await sandbox.runCommand('echo ok')).stdout).toBe('ok\n');
  });

  it('waits out a "not found" while a new computer becomes ready', async () => {
    m.create.mockResolvedValueOnce(machine({ id: 'new-1' }));
    m.waitUntilReady.mockRejectedValueOnce(notFound()).mockResolvedValueOnce(machine({ id: 'new-1' }));
    m.list.mockResolvedValueOnce([]);
    const sandbox = await provider().instances.create();
    expect(sandbox.instanceId).toBe('new-1');
    expect(m.delete).not.toHaveBeenCalled();
  });

  it('names the computer it could not clean up after a failed create', async () => {
    m.create.mockResolvedValueOnce(machine({ id: 'stuck-1', name: 'computesdk-stuck' }));
    m.waitUntilReady.mockRejectedValueOnce(new Error('not ready after 90s'));
    m.delete.mockRejectedValueOnce(new Error('region unavailable'));
    await expect(provider().instances.create()).rejects.toThrow(
      /computesdk-stuck \(stuck-1\) did not become ready .* could not be deleted .*`boxd machine destroy computesdk-stuck`/,
    );
  });

  it('opens the stream again when nothing was delivered yet', async () => {
    const sandbox = await created();
    m.streamExec.mockReturnValueOnce(fakeStream({ fail: notFound() })).mockReturnValueOnce(fakeStream({ stdout: ['hi\n'] }));
    m.list.mockResolvedValueOnce([]);
    const out: string[] = [];
    const result = await sandbox.runCommand('echo hi', { onStdout: (d) => out.push(d) });
    expect(out).toEqual(['hi\n']);
    expect(result.exitCode).toBe(0);
    expect(m.streamExec).toHaveBeenCalledTimes(2);
  });

  it('creates from a snapshot kept in another region', async () => {
    m.create.mockRejectedValueOnce(new NotFoundError('snapshot not found', 5)).mockResolvedValueOnce(machine({ id: 'r-1', region: 'nyc' }));
    snapshots.list.mockResolvedValueOnce([{ id: 'snap-nyc', name: 'golden', region: 'nyc' }]);
    m.waitUntilReady.mockResolvedValueOnce(machine({ id: 'r-1', region: 'nyc' }));
    await provider().instances.create({ snapshotId: 'snap-nyc' });
    expect(snapshots.list).toHaveBeenCalledWith({ org: 'acme', region: 'all' });
    expect(m.create.mock.calls[1][0]).toMatchObject({ fromSnapshot: 'snap-nyc', region: 'nyc' });
  });

  it('deletes a snapshot kept in another region', async () => {
    snapshots.delete.mockRejectedValueOnce(new NotFoundError('snapshot not found', 5)).mockResolvedValueOnce(undefined);
    snapshots.list.mockResolvedValueOnce([{ id: 'snap-nyc', name: 'golden', region: 'nyc' }]);
    await provider().snapshot!.delete('snap-nyc');
    expect(snapshots.delete).toHaveBeenLastCalledWith('snap-nyc', { org: 'acme', region: 'nyc' });
  });
});

describe('runCommand', () => {
  it('exports create and call env vars in the command and passes cwd', async () => {
    const sandbox = await created({ envs: { A: 'one' } });
    m.exec.mockResolvedValueOnce({ stdout: 'ok\n', stderr: '', exitCode: 0, success: true });
    const result = await sandbox.runCommand('echo $A $B', { env: { B: 'two "q"' }, cwd: '/tmp' });
    expect(m.exec).toHaveBeenCalledWith('m-1', {
      command: 'export A="one" && export B="two \\"q\\"" && echo $A $B',
      cwd: '/tmp',
      region: 'fra',
    });
    expect(result).toMatchObject({ stdout: 'ok\n', exitCode: 0 });
  });

  it('runs background commands under nohup', async () => {
    const sandbox = await created();
    m.exec.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0, success: true });
    await sandbox.runCommand('node server.js', { background: true });
    expect(m.exec.mock.calls[0][1].command).toBe('nohup sh -c "node server.js" >/dev/null 2>&1 &');
  });

  it('returns exit code 124 when the command outruns its timeout', async () => {
    const sandbox = await created();
    m.exec.mockRejectedValueOnce(new BoxdError('exec timed out after 3000ms'));
    const result = await sandbox.runCommand('sleep 60', { timeout: 3000 });
    expect(result.exitCode).toBe(124);
    expect(m.exec.mock.calls[0][1].timeout).toBe(3000);
  });

  it('starts a stopped computer and runs the command again', async () => {
    const sandbox = await created();
    m.exec
      .mockRejectedValueOnce(new ConflictError('VM computesdk-test is stopped, so it won\'t be resumed automatically', 9))
      .mockResolvedValueOnce({ stdout: 'back\n', stderr: '', exitCode: 0, success: true });
    m.waitUntilReady.mockResolvedValueOnce(machine());
    const result = await sandbox.runCommand('echo back');
    expect(m.start).toHaveBeenCalledWith('m-1', { region: 'fra' });
    expect(result.stdout).toBe('back\n');
  });
});

describe('streaming', () => {
  it('delivers stdout and stderr as they arrive and returns the exit code', async () => {
    const sandbox = await created();
    m.streamExec.mockReturnValueOnce(fakeStream({ stdout: ['tick 1\n', 'tick 2\n'], stderr: ['warn\n'], exitCode: 3 }));
    const out: string[] = [];
    const err: string[] = [];
    const result = await sandbox.runCommand('run', { onStdout: (d) => out.push(d), onStderr: (d) => err.push(d) });
    expect(out).toEqual(['tick 1\n', 'tick 2\n']);
    expect(err).toEqual(['warn\n']);
    expect(result).toMatchObject({ stdout: 'tick 1\ntick 2\n', stderr: 'warn\n', exitCode: 3 });
    expect(m.streamExec.mock.calls[0][1]).toMatchObject({ command: 'run', closeStdin: true });
  });

  it('closes the stream and returns 124 on timeout', async () => {
    const sandbox = await created();
    const stream = fakeStream({ stdout: ['starting\n'], hang: true });
    m.streamExec.mockReturnValueOnce(stream);
    const result = await sandbox.runCommand('sleep 60', { timeout: 50, onStdout: () => {} });
    expect(stream.close).toHaveBeenCalled();
    expect(result).toMatchObject({ stdout: 'starting\n', exitCode: 124 });
  });
});

describe('getUrl', () => {
  it('reuses a named proxy on the port', async () => {
    const sandbox = await created();
    proxies.list.mockResolvedValueOnce([
      { name: null, isDefault: true, port: 3000, domain: 'computesdk-test.boxd.sh' },
      { name: 'web', isDefault: false, port: 3000, domain: 'web.computesdk-test.boxd.sh' },
    ]);
    expect(await sandbox.getUrl({ port: 3000 })).toBe('https://web.computesdk-test.boxd.sh');
    expect(proxies.create).not.toHaveBeenCalled();
  });

  it('creates a proxy for a new port', async () => {
    const sandbox = await created();
    proxies.list
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ name: 'p8080', isDefault: false, port: 8080, domain: 'p8080.computesdk-test.boxd.sh' }]);
    proxies.create.mockResolvedValueOnce({ name: 'p8080', port: 8080 });
    expect(await sandbox.getUrl({ port: 8080, protocol: 'wss' })).toBe('wss://p8080.computesdk-test.boxd.sh');
    expect(proxies.create).toHaveBeenCalledWith('m-1', 'p8080', 8080, { region: 'fra' });
  });
});

describe('filesystem', () => {
  it('lists a directory', async () => {
    const sandbox = await created();
    fs.list.mockResolvedValueOnce([
      { name: 'a.txt', isDir: false, size: 3, mtime: new Date(0) },
      { name: 'sub', isDir: true, size: 0, mtime: new Date(0) },
    ]);
    const entries = await sandbox.filesystem.readdir('/tmp');
    expect(entries.map((e) => [e.name, e.type])).toEqual([['a.txt', 'file'], ['sub', 'directory']]);
  });

  it('reads and writes text', async () => {
    const sandbox = await created();
    fs.read.mockResolvedValueOnce(new TextEncoder().encode('héllo'));
    expect(await sandbox.filesystem.readFile('/tmp/x')).toBe('héllo');
    await sandbox.filesystem.writeFile('/tmp/y', 'data');
    expect(fs.write).toHaveBeenCalledWith('m-1', '/tmp/y', 'data', { region: 'fra' });
  });

  it('ignores removing a path that does not exist', async () => {
    const sandbox = await created();
    fs.remove.mockRejectedValueOnce(new MachineFileNotFoundError('not found'));
    await expect(sandbox.filesystem.remove('/tmp/gone')).resolves.toBeUndefined();
  });
});

describe('snapshots', () => {
  it('waits until the snapshot is ready', async () => {
    snapshots.create.mockResolvedValueOnce({ id: 'snap-1', name: 'golden', version: 1, status: 'pending' });
    snapshots.get
      .mockResolvedValueOnce({ id: 'snap-1', name: 'golden', status: 'pending' })
      .mockResolvedValueOnce({ id: 'snap-1', name: 'golden', status: 'ready', createdAt: new Date(0), sizeBytes: 10 });
    const snapshot = await provider().snapshot!.create('m-snap', { name: 'golden' });
    expect(snapshots.create).toHaveBeenCalledWith('m-snap', 'golden', {});
    expect(snapshot).toMatchObject({ id: 'snap-1', provider: 'boxd' });
  });
});
