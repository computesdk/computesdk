import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  class NotFoundError extends Error {}
  const state = {
    appMissing: false,
    createGate: undefined as Promise<void> | undefined,
    createArgs: [] as Array<Record<string, unknown>>,
    existsResult: true,
    fileContent: 'hello',
    getStatus: 'running',
    hasListener: false,
    lastBox: {} as any,
    listStatuses: ['running', 'running', 'running'],
    lsResult: [] as Array<{
      name: string;
      type: string;
      size: number;
      modifiedTime: number;
      mode: number;
    }>,
    notFoundOnGet: false,
    terminate: vi.fn(async () => undefined),
  };
  return { NotFoundError, state };
});

vi.mock('@sailresearch/sdk', () => {
  const makeBox = (id: string, status: string) => {
    const box = {
      sailboxId: id,
      status,
      createdAt: new Date('2020-01-02T03:04:05Z'),
      client: {},
      run: vi.fn(async () => ({ stdout: 'out', stderr: 'err', exitCode: 0 })),
      exec: vi.fn(async () => ({})),
      fs: {
        read: vi.fn(async () => Buffer.from(h.state.fileContent)),
        write: vi.fn(async () => undefined),
        mkdir: vi.fn(async () => undefined),
        ls: vi.fn(async () => h.state.lsResult),
        exists: vi.fn(async () => h.state.existsResult),
        remove: vi.fn(async () => undefined),
      },
      expose: vi.fn(async () => ({})),
      listener: vi.fn(async () => {
        if (!h.state.hasListener) throw new h.NotFoundError('no listener');
        return h.state.lastBox.listenerValue;
      }),
      waitForListener: vi.fn(async () => h.state.lastBox.listenerValue),
    };
    h.state.lastBox = {
      ...box,
      listenerValue: {
        protocol: 'http',
        endpoint: { kind: 'http', url: 'https://sb.example/8080' },
      },
    };
    return h.state.lastBox;
  };

  return {
    Image: { devbox: vi.fn(() => ({ base: 'devbox' })) },
    NotFoundError: h.NotFoundError,
    resolveConfig: vi.fn(() => ({
      mode: undefined,
      apiKey: 'env-key',
      apiUrl: 'https://dev.example',
      sailboxApiUrl: 'https://sb-dev.example',
      imagebuilderUrl: 'ib-dev:50051',
      ingressBase: 'ingress-dev.example',
      ingressScheme: 'path' as const,
    })),
    App: {
      find: vi.fn(async (name: string) => {
        if (h.state.appMissing) throw new h.NotFoundError('no app');
        return { id: `app_${name}`, name };
      }),
    },
    Client: {
      fromEnv: vi.fn(() => ({ terminateSailbox: h.state.terminate })),
      fromConfig: vi.fn(() => ({ terminateSailbox: h.state.terminate })),
    },
    Sailbox: {
      create: vi.fn(async (options: Record<string, unknown>) => {
        h.state.createArgs.push(options);
        await h.state.createGate;
        return makeBox('sb_new', 'running');
      }),
      get: vi.fn(async (id: string) => {
        if (h.state.notFoundOnGet) throw new h.NotFoundError('missing');
        return makeBox(id, h.state.getStatus);
      }),
      list: vi.fn(async () =>
        h.state.listStatuses.map((status, index) =>
          makeBox(`sb_${index + 1}`, status),
        ),
      ),
    },
  };
});

let sail: typeof import('../index').sail;

function provider() {
  return sail({ app: 'demo', apiKey: 'key' });
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  h.state.appMissing = false;
  h.state.createGate = undefined;
  h.state.createArgs = [];
  h.state.existsResult = true;
  h.state.fileContent = 'hello';
  h.state.getStatus = 'running';
  h.state.hasListener = false;
  h.state.listStatuses = ['running', 'running', 'running'];
  h.state.lsResult = [];
  h.state.notFoundOnGet = false;
  vi.clearAllMocks();
  vi.resetModules();
  ({ sail } = await import('../index'));
});

describe('sail provider', () => {
  it('creates named Sailboxes and shares one client and app lookup across providers', async () => {
    const sdk = await import('@sailresearch/sdk');
    const [first, second] = await Promise.all([
      provider().sandbox.create({ name: 'first', size: 'l', memoryGib: 64 }),
      provider().sandbox.create(),
    ]);

    expect(first.sandboxId).toBe('sb_new');
    expect(second.sandboxId).toBe('sb_new');
    expect(sdk.Client.fromConfig).toHaveBeenCalledTimes(1);
    expect(sdk.App.find).toHaveBeenCalledTimes(1);
    expect(h.state.createArgs[0]).toMatchObject({
      app: { id: 'app_demo', name: 'demo' },
      image: { base: 'devbox' },
      name: 'first',
      size: 'l',
      memoryGib: 64,
    });
    expect(h.state.createArgs[1]).toMatchObject({
      image: { base: 'devbox' },
      size: 's',
    });
    expect(String(h.state.createArgs[1].name)).toMatch(/^csdk-/);
    expect(sdk.Image.devbox).toHaveBeenCalledTimes(2);
    expect(sdk.Image.devbox).toHaveBeenCalledWith('arm64');
  });

  it('retries a failed app lookup', async () => {
    const sdk = await import('@sailresearch/sdk');
    const compute = provider();
    h.state.appMissing = true;
    await expect(compute.sandbox.create()).rejects.toThrow('no app');
    h.state.appMissing = false;
    await expect(compute.sandbox.create()).resolves.toMatchObject({
      sandboxId: 'sb_new',
    });
    expect(sdk.App.find).toHaveBeenCalledTimes(2);
  });

  it('preserves SDK connection settings with an explicit API key', async () => {
    const sdk = await import('@sailresearch/sdk');
    await provider().sandbox.create();
    expect(sdk.Client.fromConfig).toHaveBeenCalledWith({
      apiKey: 'key',
      mode: undefined,
      apiUrl: 'https://dev.example',
      sailboxApiUrl: 'https://sb-dev.example',
      imagebuilderUrl: 'ib-dev:50051',
      ingressUrl: 'ingress-dev.example',
    });
  });

  it('fails early when no API key is configured', async () => {
    const sdk = await import('@sailresearch/sdk');
    vi.mocked(sdk.resolveConfig).mockReturnValueOnce({
      mode: undefined,
      apiKey: undefined,
      apiUrl: 'https://api.sailresearch.com',
      sailboxApiUrl: 'https://api.sailresearch.com',
      imagebuilderUrl: 'api.sailresearch.com:443',
      ingressBase: 'api.sailresearch.com',
      ingressScheme: 'subdomain',
    } as never);
    await expect(sail({ app: 'demo' }).sandbox.create()).rejects.toThrow(
      /Missing Sail API key/,
    );
  });

  it('rejects unsupported or misleading create options', async () => {
    const compute = provider();
    await expect(
      compute.sandbox.create({ snapshotId: 'snap_1' }),
    ).rejects.toThrow(/snapshotId/);
    await expect(
      compute.sandbox.create({ envs: { A: '1' } }),
    ).rejects.toThrow(/envs/);
    await expect(compute.sandbox.create({ timeout: 5_000 })).rejects.toThrow(
      /hard sandbox lifetime/,
    );
    await expect(
      compute.sandbox.create({ size: 'extra-large' }),
    ).rejects.toThrow(/use s, m, or l/);
    expect(h.state.createArgs).toHaveLength(0);
  });

  it('cleans up a Sailbox that finishes creating after cancellation', async () => {
    const gate = deferred();
    h.state.createGate = gate.promise;
    const controller = new AbortController();
    const creation = provider().sandbox.create({ signal: controller.signal });
    await vi.waitFor(() => expect(h.state.createArgs).toHaveLength(1));
    controller.abort(new Error('caller stopped'));

    await expect(creation).rejects.toMatchObject({ name: 'AbortError' });
    gate.resolve();
    await vi.waitFor(() =>
      expect(h.state.terminate).toHaveBeenCalledWith('sb_new'),
    );
  });

  it('maps command options and background execution', async () => {
    const sandbox = await provider().sandbox.create();
    const result = await sandbox.runCommand('echo hi', {
      cwd: '/work',
      env: { A: '1' },
      timeout: 5_000,
    });
    expect(result).toMatchObject({ stdout: 'out', stderr: 'err', exitCode: 0 });
    expect(h.state.lastBox.run).toHaveBeenCalledWith('echo hi', {
      cwd: '/work',
      env: { A: '1' },
      background: undefined,
      timeoutSeconds: 5,
    });

    const background = await sandbox.runCommand('sleep 60', {
      background: true,
    });
    expect(background).toMatchObject({ stdout: '', stderr: '', exitCode: 0 });
    expect(h.state.lastBox.exec).toHaveBeenCalledWith('sleep 60', {
      cwd: undefined,
      env: undefined,
      background: true,
      timeoutSeconds: undefined,
    });
  });

  it('maps native filesystem entries and file contents', async () => {
    h.state.fileContent = 'file body';
    h.state.lsResult = [
      {
        name: 'sub',
        type: 'directory',
        size: 4_096,
        modifiedTime: 1_700_000_000,
        mode: 0o755,
      },
      {
        name: 'link',
        type: 'symlink',
        size: 7,
        modifiedTime: 1_700_000_001.5,
        mode: 0o777,
      },
    ];
    const sandbox = await provider().sandbox.create();
    expect(await sandbox.filesystem.readFile('/tmp/x')).toBe('file body');
    expect(await sandbox.filesystem.readdir('/tmp')).toEqual([
      {
        name: 'sub',
        type: 'directory',
        size: 4_096,
        modified: new Date(1_700_000_000_000),
      },
      {
        name: 'link',
        type: 'file',
        size: 7,
        modified: new Date(1_700_000_001_500),
      },
    ]);
  });

  it('maps lifecycle states and filters gone Sailboxes', async () => {
    const sandbox = await provider().sandbox.create();
    for (const [status, expected] of [
      ['running', 'running'],
      ['sleeping', 'stopped'],
      ['create_failed', 'error'],
    ] as const) {
      h.state.getStatus = status;
      await expect(sandbox.getInfo()).resolves.toMatchObject({ status: expected });
    }

    h.state.listStatuses = ['running', 'terminated', 'paused', 'failed'];
    const listed = await provider().sandbox.list();
    expect(listed.map((item) => item.sandboxId)).toEqual([
      'sb_1',
      'sb_3',
      'sb_4',
    ]);

    h.state.getStatus = 'terminated';
    await expect(provider().sandbox.getById('sb_dead')).resolves.toBeNull();
  });

  it('returns null for missing Sailboxes and an empty list for a missing app', async () => {
    h.state.notFoundOnGet = true;
    await expect(provider().sandbox.getById('sb_missing')).resolves.toBeNull();
    h.state.appMissing = true;
    await expect(provider().sandbox.list()).resolves.toEqual([]);
  });

  it('exposes HTTP ports once and preserves existing listener policy', async () => {
    const sandbox = await provider().sandbox.create();
    await expect(sandbox.getUrl({ port: 8080 })).resolves.toBe(
      'https://sb.example/8080',
    );
    expect(h.state.lastBox.expose).toHaveBeenCalledWith(8080, {
      protocol: 'http',
    });

    h.state.hasListener = true;
    await expect(sandbox.getUrl({ port: 8080, protocol: 'https' })).resolves.toBe(
      'https://sb.example/8080',
    );
    expect(h.state.lastBox.expose).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported and mismatched listener protocols', async () => {
    const sandbox = await provider().sandbox.create();
    await expect(sandbox.getUrl({ port: 53, protocol: 'udp' })).rejects.toThrow(
      /protocol udp/,
    );

    h.state.hasListener = true;
    h.state.lastBox.listenerValue = {
      protocol: 'tcp',
      endpoint: { kind: 'tcp', host: 'tcp.example', port: 40_000 },
    };
    await expect(sandbox.getUrl({ port: 8080 })).rejects.toThrow(
      /already exposed as tcp/,
    );

    await expect(
      sandbox.getUrl({ port: 8080, protocol: 'tcp' }),
    ).resolves.toBe('tcp://tcp.example:40000');
  });

  it('destroys through the configured client and exposes the native instance', async () => {
    const compute = provider();
    const sandbox = await compute.sandbox.create();
    expect(sandbox.getInstance()).toBe(h.state.lastBox);
    await compute.sandbox.destroy('sb_x');
    expect(h.state.terminate).toHaveBeenCalledWith('sb_x');
  });
});
