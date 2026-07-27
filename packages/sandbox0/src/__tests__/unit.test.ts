import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APIError } from 'sandbox0';
import { sandbox0 } from '../index';

const clientOptions: Array<Record<string, unknown>> = [];
const claimMock = vi.fn();
const getMock = vi.fn();
const listMock = vi.fn();
const deleteMock = vi.fn();
const sandboxMock = vi.fn();

vi.mock('sandbox0', () => {
  class MockAPIError extends Error {
    statusCode: number;
    retryAfter?: number;

    constructor(params: { statusCode: number; message: string; retryAfter?: number }) {
      super(params.message);
      this.statusCode = params.statusCode;
      this.retryAfter = params.retryAfter;
    }
  }

  class MockClient {
    readonly sandboxes = {
      claim: claimMock,
      get: getMock,
      list: listMock,
      delete: deleteMock,
    };

    constructor(options: Record<string, unknown>) {
      clientOptions.push(options);
    }

    sandbox(id: string) {
      return sandboxMock(id);
    }
  }

  return {
    APIError: MockAPIError,
    Client: MockClient,
  };
});

function makeSandbox() {
  return {
    id: 'sb_123',
    status: 'running',
    template: 'default',
    clusterId: 'cluster_1',
    cmd: vi.fn().mockResolvedValue({
      stdout: 'ok\n',
      stderr: '',
      exitCode: 0,
    }),
    readFile: vi.fn().mockResolvedValue(new TextEncoder().encode('file-content')),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    listFiles: vi.fn().mockResolvedValue([
      {
        name: 'app.ts',
        path: '/workspace/app.ts',
        type: 'file',
        size: 10,
        modTime: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        name: 'src',
        path: '/workspace/src',
        type: 'dir',
        size: 0,
        modTime: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]),
    statFile: vi.fn().mockResolvedValue({ path: '/workspace/app.ts' }),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    getServices: vi.fn().mockResolvedValue({
      sandboxId: 'sb_123',
      services: [
        {
          id: 'web',
          port: 3000,
          publicUrl: 'https://sb-123.sandbox0.app',
        },
      ],
    }),
  };
}

let nativeSandbox: ReturnType<typeof makeSandbox>;

describe('sandbox0 provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientOptions.length = 0;
    nativeSandbox = makeSandbox();
    claimMock.mockResolvedValue(nativeSandbox);
    getMock.mockResolvedValue({
      id: 'sb_123',
      status: 'running',
      templateId: 'default',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: new Date('2026-01-01T01:00:00.000Z'),
      hardExpiresAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    listMock.mockResolvedValue({ sandboxes: [], count: 0, hasMore: false });
    deleteMock.mockResolvedValue(undefined);
    sandboxMock.mockReturnValue(nativeSandbox);
  });

  it('requires a token only when an API operation starts', async () => {
    const previousToken = process.env.SANDBOX0_TOKEN;
    const previousApiKey = process.env.SANDBOX0_API_KEY;
    delete process.env.SANDBOX0_TOKEN;
    delete process.env.SANDBOX0_API_KEY;
    try {
      const provider = sandbox0();
      expect(provider.name).toBe('sandbox0');
      await expect(provider.sandbox.create()).rejects.toThrow(
        'Missing Sandbox0 token. Pass sandbox0({ token }) or set SANDBOX0_TOKEN or SANDBOX0_API_KEY.',
      );
    } finally {
      if (previousToken === undefined) delete process.env.SANDBOX0_TOKEN;
      else process.env.SANDBOX0_TOKEN = previousToken;
      if (previousApiKey === undefined) delete process.env.SANDBOX0_API_KEY;
      else process.env.SANDBOX0_API_KEY = previousApiKey;
    }
  });

  it('maps create options to the official Sandbox0 SDK', async () => {
    const provider = sandbox0({
      token: 's0_test',
      teamId: 'team_123',
      baseUrl: 'https://api.example.test',
      templateId: 'base',
      hardTtl: 300,
      envs: { BASE: '1' },
    });

    const sandbox = await provider.sandbox.create({
      templateId: 'node',
      snapshotId: 'snapshot_1',
      memory: 256,
      envs: { CALL: '2' },
      ttl: 60,
      hardTtl: 600,
      autoResume: false,
    });

    expect(clientOptions).toEqual([
      {
        token: 's0_test',
        baseUrl: 'https://api.example.test',
        userAgent: '@computesdk/sandbox0',
        headers: { 'X-Team-ID': 'team_123' },
      },
    ]);
    expect(claimMock).toHaveBeenCalledWith('node', {
      config: {
        envVars: { BASE: '1', CALL: '2' },
        ttl: 60,
        hardTtl: 600,
        autoResume: false,
      },
      snapshotId: 'snapshot_1',
      memory: '256Mi',
    });
    expect(sandbox.sandboxId).toBe('sb_123');
    expect(sandbox.getInstance()).toBe(nativeSandbox);
  });

  it('runs shell commands with cwd, env, and timeout', async () => {
    const sandbox = await sandbox0({
      token: 's0_test',
      commandTimeout: 5_000,
    }).sandbox.create();

    const result = await sandbox.runCommand('printf "$VALUE"', {
      cwd: '/workspace',
      env: { VALUE: 'hello' },
    });

    expect(nativeSandbox.cmd).toHaveBeenCalledWith('printf "$VALUE"', {
      command: ['sh', '-lc', 'printf "$VALUE"'],
      wait: true,
      cwd: '/workspace',
      envVars: { VALUE: 'hello' },
      ttlSec: 5,
    });
    expect(result).toMatchObject({ stdout: 'ok\n', stderr: '', exitCode: 0 });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('starts background commands without waiting for an exit code', async () => {
    nativeSandbox.cmd.mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: undefined,
    });
    const sandbox = await sandbox0({ token: 's0_test' }).sandbox.create();

    const result = await sandbox.runCommand('node server.js', {
      background: true,
      timeout: 1_500,
    });

    expect(nativeSandbox.cmd).toHaveBeenCalledWith(
      'node server.js',
      expect.objectContaining({ wait: false, ttlSec: 2 }),
    );
    expect(result.exitCode).toBe(0);
  });

  it('gets and paginates team sandboxes', async () => {
    const secondSandbox = { ...makeSandbox(), id: 'sb_456' };
    sandboxMock.mockImplementation((id: string) =>
      id === 'sb_456' ? secondSandbox : nativeSandbox,
    );
    listMock
      .mockResolvedValueOnce({
        sandboxes: [
          {
            id: 'sb_123',
            status: 'running',
            templateId: 'default',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            expiresAt: new Date('2026-01-01T01:00:00.000Z'),
            hardExpiresAt: new Date('2026-01-02T00:00:00.000Z'),
            clusterId: 'cluster_1',
          },
        ],
        count: 2,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        sandboxes: [
          {
            id: 'sb_456',
            status: 'paused',
            templateId: 'default',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            expiresAt: new Date('2026-01-01T01:00:00.000Z'),
            hardExpiresAt: new Date('2026-01-02T00:00:00.000Z'),
          },
        ],
        count: 2,
        hasMore: false,
      });
    const provider = sandbox0({ token: 's0_test' });

    const existing = await provider.sandbox.getById('sb_123');
    const listed = await provider.sandbox.list();

    expect(existing?.sandboxId).toBe('sb_123');
    expect(listed.map((sandbox) => sandbox.sandboxId)).toEqual(['sb_123', 'sb_456']);
    expect(listMock).toHaveBeenNthCalledWith(1, { limit: 100, offset: 0 });
    expect(listMock).toHaveBeenNthCalledWith(2, { limit: 100, offset: 1 });
    expect((await listed[1].getInfo()).status).toBe('stopped');
  });

  it('returns null for a missing sandbox', async () => {
    getMock.mockRejectedValueOnce(
      new APIError({ statusCode: 404, message: 'not found' }),
    );
    await expect(
      sandbox0({ token: 's0_test' }).sandbox.getById('missing'),
    ).resolves.toBeNull();
  });

  it('retries transient destroy failures and treats not found as success', async () => {
    vi.useFakeTimers();
    try {
      deleteMock
        .mockRejectedValueOnce(
          new APIError({ statusCode: 503, message: 'unavailable' }),
        )
        .mockResolvedValueOnce(undefined);
      const provider = sandbox0({ token: 's0_test' });

      const pending = provider.sandbox.destroy('sb_123');
      await vi.advanceTimersByTimeAsync(250);
      await pending;
      expect(deleteMock).toHaveBeenCalledTimes(2);

      deleteMock.mockReset();
      deleteMock.mockRejectedValueOnce(
        new APIError({ statusCode: 404, message: 'not found' }),
      );
      await expect(provider.sandbox.destroy('missing')).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cleans up a claim that finishes after cancellation', async () => {
    const controller = new AbortController();
    claimMock.mockImplementationOnce(async () => {
      controller.abort();
      return nativeSandbox;
    });

    await expect(
      sandbox0({ token: 's0_test' }).sandbox.create({ signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(deleteMock).toHaveBeenCalledWith('sb_123');
  });

  it('maps native filesystem operations and existing public services', async () => {
    const sandbox = await sandbox0({ token: 's0_test' }).sandbox.create();

    await sandbox.filesystem.writeFile('/workspace/app.ts', 'console.log(1)');
    expect(await sandbox.filesystem.readFile('/workspace/app.ts')).toBe('file-content');
    await sandbox.filesystem.mkdir('/workspace/src');
    const entries = await sandbox.filesystem.readdir('/workspace');
    const url = await sandbox.getUrl({ port: 3000, protocol: 'wss' });

    expect(nativeSandbox.writeFile).toHaveBeenCalledWith(
      '/workspace/app.ts',
      'console.log(1)',
    );
    expect(nativeSandbox.mkdir).toHaveBeenCalledWith('/workspace/src', true);
    expect(entries).toEqual([
      expect.objectContaining({ name: 'app.ts', type: 'file', size: 10 }),
      expect.objectContaining({ name: 'src', type: 'directory', size: 0 }),
    ]);
    expect(url).toBe('wss://sb-123.sandbox0.app/');
  });

  it('handles filesystem existence and idempotent removal', async () => {
    const sandbox = await sandbox0({ token: 's0_test' }).sandbox.create();
    expect(await sandbox.filesystem.exists('/workspace/app.ts')).toBe(true);

    nativeSandbox.statFile.mockRejectedValueOnce(
      new APIError({ statusCode: 404, message: 'not found' }),
    );
    expect(await sandbox.filesystem.exists('/workspace/missing')).toBe(false);

    nativeSandbox.deleteFile.mockRejectedValueOnce(
      new APIError({ statusCode: 404, message: 'not found' }),
    );
    await expect(
      sandbox.filesystem.remove('/workspace/missing'),
    ).resolves.toBeUndefined();
  });
});
