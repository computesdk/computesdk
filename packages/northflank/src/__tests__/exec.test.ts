/**
 * Mocked-SDK tests that pin down the exact payloads sent to the Northflank
 * exec proxy and fileCopy API. The explicit `shell: 'none'` is load-bearing;
 * no `instanceName` should be sent — exec routes to any available instance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Resolves to the mocked class defined in the `vi.mock` factory below.
import { NorthflankApiCallError } from '@northflank/js-client';

const execMock = vi.fn();
const uploadMock = vi.fn();
const downloadMock = vi.fn();
const createMock = vi.fn();
const deleteMock = vi.fn();
const getServiceMock = vi.fn();
const getServicePortsMock = vi.fn();
const updateServicePortsMock = vi.fn();

vi.mock('@northflank/js-client', () => {
  class ApiClientInMemoryContextProvider {
    addContext() {}
    useContext() {}
  }
  // Matches the real SDK shape: constructor takes a single object
  // `{ status, message, id?, details? }`. See `node_modules/@northflank/
  // js-client/dist/.../api-client.d.ts` — `NorthflankApiCallError extends
  // Error implements ApiCallError` with `constructor(callError: ApiCallError)`.
  class NorthflankApiCallError extends Error {
    status: number;
    id?: unknown;
    details?: unknown;
    constructor(callError: { status: number; message: string; id?: unknown; details?: unknown }) {
      super(callError.message);
      this.name = 'NorthflankApiCallError';
      this.status = callError.status;
      this.id = callError.id;
      this.details = callError.details;
    }
  }
  class ApiClient {
    get = {
      service: Object.assign(getServiceMock, { ports: getServicePortsMock }),
    };
    create = { service: { deployment: createMock } };
    update = { service: { ports: updateServicePortsMock } };
    delete = { service: deleteMock };
    exec = { execServiceCommand: execMock };
    fileCopy = {
      uploadServiceFiles: uploadMock,
      downloadServiceFiles: downloadMock,
    };
  }
  return { ApiClient, ApiClientInMemoryContextProvider, NorthflankApiCallError };
});

const SERVICE_ID = 'computesdk-svc-mock';

async function buildSandbox() {
  const { northflank } = await import('../index');
  const provider = northflank({ token: 't', projectId: 'p' });
  return provider.sandbox.create({ ports: [3000] } as any);
}

beforeEach(() => {
  execMock.mockReset();
  uploadMock.mockReset();
  downloadMock.mockReset();
  createMock.mockReset();
  deleteMock.mockReset();
  getServiceMock.mockReset();
  getServicePortsMock.mockReset();
  updateServicePortsMock.mockReset();

  // Default happy-path responses for the create flow + post-create lookups.
  createMock.mockResolvedValue({ data: { id: SERVICE_ID } });
  getServiceMock.mockResolvedValue({
    data: {
      id: SERVICE_ID,
      name: SERVICE_ID,
      createdAt: new Date().toISOString(),
      status: { deployment: { status: 'COMPLETED' } },
      servicePaused: false,
    },
  });
  deleteMock.mockResolvedValue({});
});

afterEach(() => {
  vi.resetModules();
});

describe('runCommand payload', () => {
  it('forwards to execServiceCommand with command argv and shell:"none" (no instanceName)', async () => {
    execMock.mockResolvedValue({
      commandResult: { exitCode: 0, status: 'Success' },
      stdOut: 'hello\n',
      stdErr: '',
    });

    const sandbox = await buildSandbox();
    const result = await sandbox.runCommand('echo "hello"');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello\n');

    expect(execMock).toHaveBeenCalledTimes(1);
    const [params, data] = execMock.mock.calls[0];
    expect(params).toEqual({ projectId: 'p', serviceId: SERVICE_ID });
    expect(data).toEqual({
      command: ['sh', '-c', 'echo "hello"'],
      shell: 'none',
    });
    expect(data.instanceName).toBeUndefined();
  });

  it('passes the teamId when configured', async () => {
    execMock.mockResolvedValue({
      commandResult: { exitCode: 0, status: 'Success' },
      stdOut: '',
      stdErr: '',
    });

    const { northflank } = await import('../index');
    const provider = northflank({ token: 't', projectId: 'p', teamId: 'tm' });
    const sandbox = await provider.sandbox.create({ ports: [3000] } as any);
    await sandbox.runCommand('id');

    const [params] = execMock.mock.calls[0];
    expect(params).toEqual({ teamId: 'tm', projectId: 'p', serviceId: SERVICE_ID });
  });
});

describe('filesystem fileCopy payloads', () => {
  it('writeFile: creates parent dir via exec, then uploads via fileCopy (no instanceName)', async () => {
    execMock.mockResolvedValue({
      commandResult: { exitCode: 0, status: 'Success' },
      stdOut: '',
      stdErr: '',
    });
    uploadMock.mockResolvedValue({});

    const sandbox = await buildSandbox();
    await sandbox.filesystem.writeFile('/workspace/sub/file.txt', 'hello');

    // 1. parent mkdir must happen via execServiceCommand FIRST, with shell:'none'.
    expect(execMock).toHaveBeenCalledTimes(1);
    const [execParams, execData] = execMock.mock.calls[0];
    expect(execParams).toEqual({ projectId: 'p', serviceId: SERVICE_ID });
    expect(execData).toEqual({
      command: ['mkdir', '-p', '--', '/workspace/sub'],
      shell: 'none',
    });
    expect(execData.instanceName).toBeUndefined();

    // 2. then the actual upload.
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [upParams, upOpts] = uploadMock.mock.calls[0];
    expect(upParams).toEqual({ projectId: 'p', serviceId: SERVICE_ID });
    expect(upOpts.remotePath).toBe('/workspace/sub/file.txt');
    expect(upOpts.instanceName).toBeUndefined();
    // localPath is a tmp file ending in the remote basename.
    expect(upOpts.localPath).toMatch(/cs-nf-[^/]+\/file\.txt$/);

    // 3. order: mkdir invoked before upload.
    expect(execMock.mock.invocationCallOrder[0]).toBeLessThan(uploadMock.mock.invocationCallOrder[0]);
  });

  it('writeFile: skips parent mkdir when path is at the root', async () => {
    uploadMock.mockResolvedValue({});

    const sandbox = await buildSandbox();
    await sandbox.filesystem.writeFile('/file.txt', 'hello');

    expect(execMock).not.toHaveBeenCalled();
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [, upOpts] = uploadMock.mock.calls[0];
    expect(upOpts.remotePath).toBe('/file.txt');
    expect(upOpts.instanceName).toBeUndefined();
  });

  it('readFile: downloads via fileCopy with remotePath and tmp localPath (no instanceName)', async () => {
    // downloadServiceFiles writes a file under localPath named basename(remotePath).
    // Our implementation reads that file from disk afterwards, so we have to
    // actually create it for the read to succeed.
    const { promises: fsp } = await import('node:fs');
    const { posix } = await import('node:path');

    downloadMock.mockImplementation(async (_params: unknown, opts: any) => {
      const target = `${opts.localPath}/${posix.basename(opts.remotePath)}`;
      await fsp.writeFile(target, 'remote content', 'utf8');
      return {};
    });

    const sandbox = await buildSandbox();
    const content = await sandbox.filesystem.readFile('/etc/hosts');

    expect(content).toBe('remote content');
    expect(downloadMock).toHaveBeenCalledTimes(1);
    const [dlParams, dlOpts] = downloadMock.mock.calls[0];
    expect(dlParams).toEqual({ projectId: 'p', serviceId: SERVICE_ID });
    expect(dlOpts.remotePath).toBe('/etc/hosts');
    expect(dlOpts.instanceName).toBeUndefined();
    expect(dlOpts.localPath).toMatch(/cs-nf-[^/]+$/);
  });

});

describe('create deployment payload', () => {
  it('uses deployment.external (no internal) by default', async () => {
    const { northflank } = await import('../index');
    const provider = northflank({ token: 't', projectId: 'p' });
    await provider.sandbox.create({ ports: [3000] } as any);

    expect(createMock).toHaveBeenCalledTimes(1);
    const [{ data }] = createMock.mock.calls[0];
    expect(data.deployment.external).toEqual({ imagePath: 'node:20-slim' });
    expect(data.deployment.internal).toBeUndefined();
    expect(data.deployment.docker.customCommand).toBe('sleep infinity');
  });

  it('uses deployment.internal (no external) when internalDeployment is set', async () => {
    const { northflank } = await import('../index');
    const provider = northflank({
      token: 't',
      projectId: 'p',
      internalDeployment: { id: 'my-build-svc' },
    });
    await provider.sandbox.create({ ports: [3000] } as any);

    expect(createMock).toHaveBeenCalledTimes(1);
    const [{ data }] = createMock.mock.calls[0];
    expect(data.deployment.internal).toEqual({
      id: 'my-build-svc',
      branch: 'main',
      buildSHA: 'latest',
    });
    expect(data.deployment.external).toBeUndefined();
    expect(data.deployment.docker.customCommand).toBe('sleep infinity');
  });

  it('honors branch and buildSHA overrides on internalDeployment', async () => {
    const { northflank } = await import('../index');
    const provider = northflank({ token: 't', projectId: 'p' });
    await provider.sandbox.create({
      ports: [3000],
      internalDeployment: { id: 'svc-2', branch: 'release', buildSHA: 'abc1234' },
    } as any);

    const [{ data }] = createMock.mock.calls[0];
    expect(data.deployment.internal).toEqual({
      id: 'svc-2',
      branch: 'release',
      buildSHA: 'abc1234',
    });
  });

  it('create-options internalDeployment overrides config-level', async () => {
    const { northflank } = await import('../index');
    const provider = northflank({
      token: 't',
      projectId: 'p',
      internalDeployment: { id: 'config-svc' },
    });
    await provider.sandbox.create({
      ports: [3000],
      internalDeployment: { id: 'opts-svc' },
    } as any);

    const [{ data }] = createMock.mock.calls[0];
    expect(data.deployment.internal.id).toBe('opts-svc');
  });
});

describe('filesystem mkdir/exists/remove', () => {
  it('mkdir / exists / remove route through exec with bare argv (no instanceName)', async () => {
    execMock.mockResolvedValue({
      commandResult: { exitCode: 0, status: 'Success' },
      stdOut: '',
      stdErr: '',
    });

    const sandbox = await buildSandbox();
    await sandbox.filesystem.mkdir('/workspace/new');
    await sandbox.filesystem.exists('/workspace/new');
    await sandbox.filesystem.remove('/workspace/new');

    expect(execMock).toHaveBeenCalledTimes(3);
    const calls = execMock.mock.calls.map(([, data]) => data);
    expect(calls[0]).toEqual({
      command: ['mkdir', '-p', '--', '/workspace/new'],
      shell: 'none',
    });
    expect(calls[1]).toEqual({
      command: ['test', '-e', '/workspace/new'],
      shell: 'none',
    });
    expect(calls[2]).toEqual({
      command: ['rm', '-rf', '--', '/workspace/new'],
      shell: 'none',
    });
    expect(calls.every(c => c.instanceName === undefined)).toBe(true);
  });
});

/**
 * runCommand should re-throw fatal errors (auth, not-found, permanent
 * client errors) rather than swallow them into `{ exitCode: 1, stderr }`.
 * Transient exhaustion is still surfaced as exitCode 1.
 */
describe('runCommand error propagation', () => {
  it('re-throws WS 401 auth errors instead of swallowing them', async () => {
    execMock.mockRejectedValue(
      new Error('Command execution failed: WebSocket error: Unexpected server response: 401'),
    );
    const sandbox = await buildSandbox();
    await expect(sandbox.runCommand('echo x')).rejects.toThrow(/Unexpected server response: 401/);
  });

  it('re-throws WS 404 not-found instead of swallowing them', async () => {
    execMock.mockRejectedValue(
      new Error('Command execution failed: WebSocket error: Unexpected server response: 404'),
    );
    const sandbox = await buildSandbox();
    await expect(sandbox.runCommand('echo x')).rejects.toThrow(/Unexpected server response: 404/);
  });

  it('re-throws WS 400 permanent client errors instead of swallowing them', async () => {
    execMock.mockRejectedValue(
      new Error('Command execution failed: WebSocket error: Unexpected server response: 400'),
    );
    const sandbox = await buildSandbox();
    await expect(sandbox.runCommand('echo x')).rejects.toThrow(/Unexpected server response: 400/);
  });

  it('returns exitCode 1 when transient 500 errors exhaust the retry budget', async () => {
    execMock.mockRejectedValue(
      new Error('Command execution failed: WebSocket error: Unexpected server response: 500'),
    );
    // Tight timeout so the retry loop exits in tens of ms, not the default 2 min.
    const { northflank } = await import('../index');
    const provider = northflank({ token: 't', projectId: 'p', timeout: 100 });
    const sandbox = await provider.sandbox.create({ ports: [3000] } as any);
    const result = await sandbox.runCommand('echo x');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Timeout running exec/);
  });
});

/**
 * withCommandOptions wrap order (tested via runCommand → execMock payload).
 * The order must be: background → env → cwd, producing
 *   `cd "/dir" && KEY="value" nohup cmd >/tmp/computesdk-bg.log 2>&1 &`
 * for the all-three case. Env outside nohup so the assignment binds to cmd,
 * not the nohup binary.
 */
describe('withCommandOptions wrap order (via runCommand)', () => {
  it('background+env+cwd → cd && env nohup cmd >log 2>&1 &', async () => {
    execMock.mockResolvedValue({ commandResult: { exitCode: 0 }, stdOut: '', stdErr: '' });
    const sandbox = await buildSandbox();
    await sandbox.runCommand('cmd', { background: true, env: { KEY: 'value' }, cwd: '/dir' });
    const [, data] = execMock.mock.calls[0];
    expect(data.command).toEqual([
      'sh',
      '-c',
      'cd "/dir" && KEY="value" nohup cmd >/tmp/computesdk-bg.log 2>&1 &',
    ]);
  });

  it('background+env (no cwd) → env nohup cmd >log 2>&1 &', async () => {
    execMock.mockResolvedValue({ commandResult: { exitCode: 0 }, stdOut: '', stdErr: '' });
    const sandbox = await buildSandbox();
    await sandbox.runCommand('cmd', { background: true, env: { KEY: 'value' } });
    const [, data] = execMock.mock.calls[0];
    expect(data.command).toEqual([
      'sh',
      '-c',
      'KEY="value" nohup cmd >/tmp/computesdk-bg.log 2>&1 &',
    ]);
  });

  it('env+cwd (no background) → cd && env cmd', async () => {
    execMock.mockResolvedValue({ commandResult: { exitCode: 0 }, stdOut: '', stdErr: '' });
    const sandbox = await buildSandbox();
    await sandbox.runCommand('cmd', { env: { KEY: 'value' }, cwd: '/dir' });
    const [, data] = execMock.mock.calls[0];
    expect(data.command).toEqual(['sh', '-c', 'cd "/dir" && KEY="value" cmd']);
  });
});

/**
 * getUrl must reject TCP/UDP ports — public DNS only works for HTTP /
 * HTTP/2. HTTP ports patch successfully and return the resolved URL.
 */
describe('getUrl protocol gating', () => {
  it('throws when patching a TCP port', async () => {
    getServicePortsMock.mockResolvedValueOnce({
      data: { ports: [{ id: 'p1', name: 'tcp1', internalPort: 3000, protocol: 'TCP', public: false, domains: [] }] },
    });
    const sandbox = await buildSandbox();
    await expect(sandbox.getUrl({ port: 3000 })).rejects.toThrow(/Cannot expose TCP port 3000/);
    expect(updateServicePortsMock).not.toHaveBeenCalled();
  });

  it('throws when patching a UDP port', async () => {
    getServicePortsMock.mockResolvedValueOnce({
      data: { ports: [{ id: 'p2', name: 'udp1', internalPort: 3000, protocol: 'UDP', public: false, domains: [] }] },
    });
    const sandbox = await buildSandbox();
    await expect(sandbox.getUrl({ port: 3000 })).rejects.toThrow(/Cannot expose UDP port 3000/);
    expect(updateServicePortsMock).not.toHaveBeenCalled();
  });

  it('patches HTTP ports successfully and returns the resolved URL', async () => {
    // First call: HTTP port, not yet public, no dns
    getServicePortsMock.mockResolvedValueOnce({
      data: { ports: [{ id: 'p3', name: 'app', internalPort: 3000, protocol: 'HTTP', public: false, domains: [] }] },
    });
    updateServicePortsMock.mockResolvedValueOnce({});
    // Refresh loop returns the same port with a DNS hostname populated.
    getServicePortsMock.mockResolvedValueOnce({
      data: { ports: [{ id: 'p3', name: 'app', internalPort: 3000, protocol: 'HTTP', public: true, dns: 'svc-host.code.run', domains: [] }] },
    });
    const sandbox = await buildSandbox();
    const url = await sandbox.getUrl({ port: 3000 });
    expect(url).toBe('https://svc-host.code.run');
    expect(updateServicePortsMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * `execWithReadiness` is a private helper inside index.ts; we exercise it
 * through the public runCommand and filesystem ops. The `ready` flag lives
 * on the underlying handle, reachable via `sandbox.getInstance()`.
 */
describe('execWithReadiness / ready flag (via runCommand & filesystem)', () => {
  it('first runCommand retries transient errors and flips handle.ready to true', async () => {
    let n = 0;
    execMock.mockImplementation(async () => {
      n++;
      if (n < 3) throw new Error('Unexpected server response: 500');
      return { commandResult: { exitCode: 0 }, stdOut: 'ok', stdErr: '' };
    });
    const sandbox = await buildSandbox();
    const handle: any = (sandbox as any).getInstance();
    expect(handle.ready).toBe(false);
    const result = await sandbox.runCommand('echo hi');
    expect(result.exitCode).toBe(0);
    expect(execMock).toHaveBeenCalledTimes(3);
    expect(handle.ready).toBe(true);
  });

  it('subsequent calls are direct — no retry — after ready flips', async () => {
    execMock.mockResolvedValue({ commandResult: { exitCode: 0 }, stdOut: 'ok', stdErr: '' });
    const sandbox = await buildSandbox();
    await sandbox.runCommand('warmup'); // sets ready=true
    expect(execMock).toHaveBeenCalledTimes(1);
    expect((sandbox as any).getInstance().ready).toBe(true);

    // From now on, transient errors should NOT be retried — they surface
    // immediately as exitCode 1 (or throw if fatal). Single attempt only.
    execMock.mockReset();
    execMock.mockRejectedValue(new Error('Unexpected server response: 500'));
    const result = await sandbox.runCommand('echo x');
    expect(execMock).toHaveBeenCalledTimes(1);
    expect(result.exitCode).toBe(1);
  });

  it('failure during readiness does NOT flip ready', async () => {
    execMock.mockRejectedValue(new Error('Unexpected server response: 500'));
    const { northflank } = await import('../index');
    const provider = northflank({ token: 't', projectId: 'p', timeout: 100 });
    const sandbox = await provider.sandbox.create({ ports: [3000] } as any);
    const handle: any = (sandbox as any).getInstance();
    await sandbox.runCommand('x'); // exhausts → exitCode 1 → no throw
    expect(handle.ready).toBe(false);
  });

  it('filesystem readFile also participates in readiness', async () => {
    let n = 0;
    downloadMock.mockImplementation(async (_params: unknown, opts: any) => {
      n++;
      if (n < 3) throw new Error('Unexpected server response: 500');
      const { promises: fsp } = await import('node:fs');
      const { posix } = await import('node:path');
      await fsp.writeFile(`${opts.localPath}/${posix.basename(opts.remotePath)}`, 'hello', 'utf8');
      return {};
    });
    const sandbox = await buildSandbox();
    const handle: any = (sandbox as any).getInstance();
    expect(handle.ready).toBe(false);
    const content = await sandbox.filesystem.readFile('/x.txt');
    expect(content).toBe('hello');
    expect(downloadMock).toHaveBeenCalledTimes(3);
    expect(handle.ready).toBe(true);
  });
});

/**
 * `destroy(sandboxId)` guards: silent on 404, throws on non-prefixed
 * services (so you can't delete arbitrary unrelated services by ID), and
 * deletes on the happy path.
 */
describe('destroy() guards', () => {
  it('returns without throwing when the service is already gone (404)', async () => {
    // REST `get.service` 404 → NorthflankApiCallError, not a plain WS-style Error.
    getServiceMock.mockRejectedValueOnce(
      new NorthflankApiCallError({ status: 404, message: 'Service not found' }),
    );
    const { northflank } = await import('../index');
    const provider = northflank({ token: 't', projectId: 'p' });
    await expect(provider.sandbox.destroy('computesdk-gone')).resolves.toBeUndefined();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("throws when the service name doesn't start with the prefix", async () => {
    getServiceMock.mockResolvedValueOnce({
      data: {
        id: 'other',
        name: 'my-other-service',
        createdAt: new Date().toISOString(),
        status: { deployment: { status: 'COMPLETED' } },
        servicePaused: false,
      },
    });
    const { northflank } = await import('../index');
    const provider = northflank({ token: 't', projectId: 'p' });
    await expect(provider.sandbox.destroy('other')).rejects.toThrow(/not managed by ComputeSDK/);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('happy path: prefixed service → calls delete.service', async () => {
    // The default mock already returns a service with a prefixed name
    // (SERVICE_ID = "computesdk-svc-mock"), so no override needed.
    const { northflank } = await import('../index');
    const provider = northflank({ token: 't', projectId: 'p' });
    await expect(provider.sandbox.destroy(SERVICE_ID)).resolves.toBeUndefined();
    expect(getServiceMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * `getById(sandboxId)` guards: 404 → null, non-prefixed → throws,
 * happy path returns a handle with the expected defaults.
 */
describe('getById() guards', () => {
  it('returns null when the service is 404', async () => {
    getServiceMock.mockRejectedValueOnce(
      new NorthflankApiCallError({ status: 404, message: 'Service not found' }),
    );
    const { northflank } = await import('../index');
    const provider = northflank({ token: 't', projectId: 'p' });
    const result = await provider.sandbox.getById('computesdk-gone');
    expect(result).toBeNull();
  });

  it("throws when the service name doesn't start with the prefix", async () => {
    getServiceMock.mockResolvedValueOnce({
      data: {
        id: 'other',
        name: 'my-other-service',
        createdAt: new Date().toISOString(),
        status: { deployment: { status: 'COMPLETED' } },
        servicePaused: false,
      },
    });
    const { northflank } = await import('../index');
    const provider = northflank({ token: 't', projectId: 'p' });
    await expect(provider.sandbox.getById('other')).rejects.toThrow(/not managed by ComputeSDK/);
  });

  it('returned handle has the expected defaults (ready=false, runtime="node", timeout=120_000)', async () => {
    // Default mock has the prefixed name — no override needed.
    const { northflank } = await import('../index');
    const provider = northflank({ token: 't', projectId: 'p' }); // no runtime/timeout overrides
    const result = await provider.sandbox.getById(SERVICE_ID);
    expect(result).not.toBeNull();
    const handle: any = (result as any).getInstance();
    expect(handle.ready).toBe(false);
    expect(handle.runtime).toBe('node');
    expect(handle.timeout).toBe(120_000);
  });
});
