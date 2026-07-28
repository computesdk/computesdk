import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunCloudError } from '@run-cloud/sdk';
import { runCloud } from '../index';

const clientOptions: Array<Record<string, unknown>> = [];
const createMock = vi.fn();
const getMock = vi.fn();
const listMock = vi.fn();
const execMock = vi.fn();
const readFileMock = vi.fn();
const destroyMock = vi.fn();
const createSnapshotMock = vi.fn();
const listSnapshotsMock = vi.fn();
const deleteSnapshotMock = vi.fn();
const restoreSnapshotMock = vi.fn();

vi.mock('@run-cloud/sdk', () => {
  class MockRunCloudError extends Error {
    readonly status: number;
    readonly detail: string;

    constructor(status: number, detail: string) {
      super(`run.cloud API ${status}: ${detail}`);
      this.status = status;
      this.detail = detail;
    }
  }

  class MockClient {
    readonly sandboxes = {
      create: createMock,
      get: getMock,
      list: listMock,
      exec: execMock,
      readFile: readFileMock,
      destroy: destroyMock,
      snapshot: createSnapshotMock,
    };

    readonly snapshots = {
      list: listSnapshotsMock,
      delete: deleteSnapshotMock,
      restore: restoreSnapshotMock,
    };

    constructor(options: Record<string, unknown>) {
      clientOptions.push(options);
    }
  }

  return {
    Client: MockClient,
    RunCloudError: MockRunCloudError,
  };
});

function nativeSandbox(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sbx_123',
    state: 'running',
    name: 'compute-test',
    image: 'runcloud/agent-base',
    region: 'fsn1',
    sizeClass: 'custom',
    milliCpu: 2_000,
    memMb: 4_096,
    hostId: 'host_1',
    warmStart: false,
    idlePauseSeconds: 300,
    timeoutSeconds: 600,
    createdAt: '2026-07-28T10:00:00.000Z',
    lastActiveAt: '2026-07-28T10:01:00.000Z',
    stateChangedAt: '2026-07-28T10:00:05.000Z',
    ...overrides,
  };
}

describe('run-cloud provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientOptions.length = 0;
    createMock.mockResolvedValue(nativeSandbox());
    getMock.mockResolvedValue(nativeSandbox());
    listMock.mockResolvedValue([nativeSandbox()]);
    execMock.mockResolvedValue({
      stdout: 'ok\n',
      stderr: '',
      exit_code: 0,
      exitCode: 0,
    });
    readFileMock.mockResolvedValue(new TextEncoder().encode('file-content'));
    destroyMock.mockResolvedValue(undefined);
    createSnapshotMock.mockResolvedValue({
      id: 'snap_123',
      created_at: '2026-07-28T10:02:00.000Z',
      label: 'checkpoint',
    });
    listSnapshotsMock.mockResolvedValue([
      {
        id: 'snap_123',
        created_at: '2026-07-28T10:02:00.000Z',
      },
    ]);
    deleteSnapshotMock.mockResolvedValue(undefined);
    restoreSnapshotMock.mockResolvedValue(
      nativeSandbox({ id: 'sbx_restored' }),
    );
  });

  it('requires an API key only when an API operation starts', async () => {
    const previousApiKey = process.env.RUN_CLOUD_API_KEY;
    const previousToken = process.env.RUN_CLOUD_API_TOKEN;
    delete process.env.RUN_CLOUD_API_KEY;
    delete process.env.RUN_CLOUD_API_TOKEN;
    try {
      const provider = runCloud();
      expect(provider.name).toBe('run-cloud');
      await expect(provider.sandbox.create()).rejects.toThrow(
        'Missing Run Cloud API key. Pass runCloud({ apiKey }) or set ' +
          'RUN_CLOUD_API_KEY (RUN_CLOUD_API_TOKEN is also supported).',
      );
    } finally {
      if (previousApiKey === undefined) delete process.env.RUN_CLOUD_API_KEY;
      else process.env.RUN_CLOUD_API_KEY = previousApiKey;
      if (previousToken === undefined) delete process.env.RUN_CLOUD_API_TOKEN;
      else process.env.RUN_CLOUD_API_TOKEN = previousToken;
    }
  });

  it('maps ComputeSDK create options to the official Run Cloud SDK', async () => {
    const customFetch = vi.fn() as unknown as typeof fetch;
    const provider = runCloud({
      apiKey: 'rc_test',
      apiUrl: 'https://api.example.test',
      fetch: customFetch,
      image: 'runcloud/default',
      cpu: 1,
      memory: 1_024,
      disk: 20,
      idlePauseSeconds: 600,
      timeout: 300_000,
      region: 'hel1',
      orgId: 'org_default',
    });

    const sandbox = await provider.sandbox.create({
      templateId: 'runcloud/custom',
      cpu: 2,
      memory: 4_096,
      disk: 40,
      idlePauseSeconds: 0,
      timeout: 600_000,
      region: 'fsn1',
      name: 'compute-test',
      orgId: 'org_call',
      idempotencyKey: 'job_123',
    });

    expect(clientOptions).toEqual([
      {
        apiKey: 'rc_test',
        apiUrl: 'https://api.example.test',
        fetch: customFetch,
      },
    ]);
    expect(createMock).toHaveBeenCalledWith({
      image: 'runcloud/custom',
      cpu: 2,
      memory: 4_096,
      disk: 40,
      idlePauseSeconds: 0,
      timeoutSeconds: 600,
      region: 'fsn1',
      name: 'compute-test',
      orgId: 'org_call',
      idempotencyKey: 'job_123',
    });
    expect(sandbox.sandboxId).toBe('sbx_123');
    expect(sandbox.getInstance().sandbox.id).toBe('sbx_123');
  });

  it('uses the agent base image and Run Cloud defaults by default', async () => {
    await runCloud({ apiKey: 'rc_test' }).sandbox.create();
    expect(createMock).toHaveBeenCalledWith({
      image: 'runcloud/agent-base',
      cpu: undefined,
      memory: undefined,
      disk: undefined,
      idlePauseSeconds: undefined,
      timeoutSeconds: undefined,
      region: undefined,
      name: undefined,
      orgId: undefined,
      idempotencyKey: undefined,
    });
  });

  it('restores a ComputeSDK snapshot instead of creating a fresh sandbox', async () => {
    const sandbox = await runCloud({
      apiKey: 'rc_test',
      region: 'hel1',
    }).sandbox.create({
      snapshotId: 'snap_123',
      name: 'restored',
    });

    expect(restoreSnapshotMock).toHaveBeenCalledWith('snap_123', {
      name: 'restored',
      region: 'hel1',
    });
    expect(createMock).not.toHaveBeenCalled();
    expect(sandbox.sandboxId).toBe('sbx_restored');
  });

  it('rejects sandbox-level envs with an actionable alternative', async () => {
    await expect(
      runCloud({ apiKey: 'rc_test' }).sandbox.create({
        envs: { TOKEN: 'secret' },
      }),
    ).rejects.toThrow(
      'Pass environment variables to sandbox.runCommand(..., { env }).',
    );
  });

  it('runs commands with cwd, env, and timeout', async () => {
    execMock.mockResolvedValueOnce({
      stdout: 'hello\n',
      stderr: 'warning\n',
      exit_code: 0,
      exitCode: 0,
    });
    const sandbox = await runCloud({
      apiKey: 'rc_test',
      commandTimeout: 5_000,
    }).sandbox.create();

    const result = await sandbox.runCommand('printf "$VALUE"', {
      cwd: '/workspace',
      env: { VALUE: 'hello' },
      timeout: 1_500,
    });

    expect(execMock).toHaveBeenCalledWith(
      'sbx_123',
      'printf "$VALUE"',
      {
        cwd: '/workspace',
        env: { VALUE: 'hello' },
        timeoutSeconds: 2,
      },
    );
    expect(result).toMatchObject({
      stdout: 'hello\n',
      stderr: 'warning\n',
      exitCode: 0,
    });
  });

  it('detaches background commands through nohup', async () => {
    const sandbox = await runCloud({ apiKey: 'rc_test' }).sandbox.create();
    const result = await sandbox.runCommand("printf 'ready'", {
      background: true,
    });

    expect(execMock).toHaveBeenCalledWith(
      'sbx_123',
      "nohup sh -c 'printf '\\''ready'\\''' >/dev/null 2>&1 &",
      {
        cwd: undefined,
        env: undefined,
        timeoutSeconds: 300,
      },
    );
    expect(result.exitCode).toBe(0);
  });

  it('gets and lists running sandboxes', async () => {
    listMock.mockResolvedValueOnce([
      nativeSandbox(),
      nativeSandbox({ id: 'sbx_456' }),
    ]);
    const provider = runCloud({ apiKey: 'rc_test' });

    const existing = await provider.sandbox.getById('sbx_123');
    const listed = await provider.sandbox.list();

    expect(getMock).toHaveBeenCalledWith('sbx_123');
    expect(listMock).toHaveBeenCalledWith({ state: 'running' });
    expect(existing?.sandboxId).toBe('sbx_123');
    expect(listed.map((sandbox) => sandbox.sandboxId)).toEqual([
      'sbx_123',
      'sbx_456',
    ]);
  });

  it('returns null for missing sandboxes and makes destroy idempotent', async () => {
    getMock.mockRejectedValueOnce(new RunCloudError(404, 'not found'));
    destroyMock.mockRejectedValueOnce(new RunCloudError(404, 'not found'));
    const provider = runCloud({ apiKey: 'rc_test' });

    await expect(provider.sandbox.getById('missing')).resolves.toBeNull();
    await expect(provider.sandbox.destroy('missing')).resolves.toBeUndefined();
  });

  it('refreshes native state in getInfo', async () => {
    getMock.mockResolvedValueOnce(
      nativeSandbox({ state: 'paused', warmStart: true }),
    );
    const sandbox = await runCloud({
      apiKey: 'rc_test',
      commandTimeout: 12_000,
    }).sandbox.create();

    const info = await sandbox.getInfo();

    expect(info).toEqual({
      id: 'sbx_123',
      provider: 'run-cloud',
      status: 'stopped',
      createdAt: new Date('2026-07-28T10:00:00.000Z'),
      timeout: 12_000,
      metadata: expect.objectContaining({
        state: 'paused',
        image: 'runcloud/agent-base',
        milliCpu: 2_000,
        memMb: 4_096,
        warmStart: true,
      }),
    });
  });

  it('maps native reads and shell-backed filesystem operations', async () => {
    execMock
      .mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        exit_code: 0,
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout:
          'app.ts\tf\t10\t1767225600.0000000000\n' +
          'src\td\t0\t1767225601.0000000000\n',
        stderr: '',
        exit_code: 0,
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        exit_code: 0,
        exitCode: 0,
      });
    const sandbox = await runCloud({ apiKey: 'rc_test' }).sandbox.create();

    expect(await sandbox.filesystem.readFile('/tmp/result.txt')).toBe(
      'file-content',
    );
    await sandbox.filesystem.writeFile('/tmp/a b/result.txt', 'hello');
    const entries = await sandbox.filesystem.readdir('/tmp/a b');
    expect(await sandbox.filesystem.exists('/tmp/a b/result.txt')).toBe(true);

    expect(readFileMock).toHaveBeenCalledWith('sbx_123', '/tmp/result.txt');
    expect(execMock.mock.calls[0][1]).toContain(
      'mkdir -p "$(dirname "/tmp/a b/result.txt")"',
    );
    expect(execMock.mock.calls[0][1]).toContain(
      'printf \'%s\' "aGVsbG8=" | base64 -d',
    );
    expect(entries).toEqual([
      {
        name: 'app.ts',
        type: 'file',
        size: 10,
        modified: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        name: 'src',
        type: 'directory',
        size: 0,
        modified: new Date('2026-01-01T00:00:01.000Z'),
      },
    ]);
  });

  it('creates, lists, limits, and idempotently deletes snapshots', async () => {
    deleteSnapshotMock.mockRejectedValueOnce(
      new RunCloudError(404, 'not found'),
    );
    listSnapshotsMock.mockResolvedValueOnce([
      { id: 'snap_1', created_at: '2026-07-28T10:02:00.000Z' },
      { id: 'snap_2', created_at: '2026-07-28T10:03:00.000Z' },
    ]);
    const provider = runCloud({ apiKey: 'rc_test' });

    const created = await provider.snapshot?.create('sbx_123', {
      name: 'checkpoint',
    });
    const listed = await provider.snapshot?.list({
      sandboxId: 'sbx_123',
      limit: 1,
    });
    await expect(
      provider.snapshot?.delete('missing'),
    ).resolves.toBeUndefined();

    expect(createSnapshotMock).toHaveBeenCalledWith('sbx_123', {
      label: 'checkpoint',
    });
    expect(listSnapshotsMock).toHaveBeenCalledWith({
      sandboxId: 'sbx_123',
    });
    expect(created).toEqual({
      id: 'snap_123',
      provider: 'run-cloud',
      createdAt: new Date('2026-07-28T10:02:00.000Z'),
      metadata: expect.objectContaining({ label: 'checkpoint' }),
    });
    expect(listed?.map((snapshot) => snapshot.id)).toEqual(['snap_1']);
  });

  it('cleans up a sandbox when cancellation wins after create', async () => {
    const controller = new AbortController();
    createMock.mockImplementationOnce(async () => {
      controller.abort();
      return nativeSandbox();
    });

    await expect(
      runCloud({ apiKey: 'rc_test' }).sandbox.create({
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(destroyMock).toHaveBeenCalledWith('sbx_123');
  });

  it('explains that public port URLs are not exposed yet', async () => {
    const sandbox = await runCloud({ apiKey: 'rc_test' }).sandbox.create();
    await expect(sandbox.getUrl({ port: 3000 })).rejects.toThrow(
      'Run Cloud public port URLs are not available in @run-cloud/sdk yet',
    );
  });
});
