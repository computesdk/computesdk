/**
 * Mocked-SDK tests that pin down the exact payloads sent to the Northflank
 * exec proxy and fileCopy API. The explicit `shell: 'none'` is load-bearing;
 * no `instanceName` should be sent — exec routes to any available instance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execMock = vi.fn();
const uploadMock = vi.fn();
const downloadMock = vi.fn();
const createMock = vi.fn();
const deleteMock = vi.fn();
const getServiceMock = vi.fn();

vi.mock('@northflank/js-client', () => {
  class ApiClientInMemoryContextProvider {
    addContext() {}
    useContext() {}
  }
  class NorthflankApiCallError extends Error {
    status: number;
    constructor(status: number, msg: string) {
      super(msg);
      this.status = status;
    }
  }
  class ApiClient {
    get = { service: getServiceMock };
    create = { service: { deployment: createMock } };
    delete = { service: deleteMock };
    exec = { execServiceCommand: execMock };
    fileCopy = {
      uploadServiceFiles: uploadMock,
      downloadServiceFiles: downloadMock,
    };
  }
  return { ApiClient, ApiClientInMemoryContextProvider, NorthflankApiCallError };
});

const SERVICE_ID = 'svc-mock';

async function buildSandbox() {
  const { northflank } = await import('../index');
  const provider = northflank({ token: 't', projectId: 'p' });
  // create() now uses exec-based readiness — it will fire one exec call
  // (`['true']`) for waitForRunningInstance before returning the sandbox.
  // The default `execMock` return value (set by tests) satisfies it; we
  // then clear call history so per-test assertions start from a clean slate.
  const sandbox = await provider.sandbox.create({ ports: [3000] } as any);
  execMock.mockClear();
  return sandbox;
}

beforeEach(() => {
  execMock.mockReset();
  uploadMock.mockReset();
  downloadMock.mockReset();
  createMock.mockReset();
  deleteMock.mockReset();
  getServiceMock.mockReset();

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
    // Clear readiness probe history (same trick as buildSandbox) so the
    // assertion below sees the actual runCommand call, not the probe.
    execMock.mockClear();
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
