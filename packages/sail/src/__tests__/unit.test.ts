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
      run: vi.fn(async (command: string) =>
        command === 'pwd'
          ? { stdout: '/workspace\n', stderr: '', exitCode: 0 }
          : { stdout: 'out', stderr: 'err', exitCode: 0 },
      ),
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
      pause: vi.fn(async () => undefined),
      resume: vi.fn(async () => undefined),
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
      fromCheckpoint: vi.fn(async (options: Record<string, unknown>) => {
        h.state.createArgs.push(options);
        return makeBox('sb_restored', 'running');
      }),
      fromId: vi.fn((id: string) => ({
        checkpoint: vi.fn(async () => ({
          checkpointId: 'ckpt_1',
          sailboxId: id,
          checkpointGeneration: 3,
          status: 'running',
        })),
      })),
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
      compute.sandbox.create({ snapshotId: 'ckpt_1', size: 'm' }),
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

  it('resolves relative filesystem paths against the exec cwd', async () => {
    const sandbox = await provider().sandbox.create();
    const box = h.state.lastBox;

    await sandbox.filesystem.writeFile('src/a.txt', 'x');
    expect(box.fs.write).toHaveBeenCalledWith('/workspace/src/a.txt', 'x');
    await sandbox.filesystem.exists('a.txt');
    expect(box.fs.exists).toHaveBeenCalledWith('/workspace/a.txt');

    // Absolute paths pass through untouched and the `pwd` probe ran once.
    await sandbox.filesystem.readFile('/abs/b.txt');
    expect(box.fs.read).toHaveBeenCalledWith('/abs/b.txt');
    expect(box.run).toHaveBeenCalledTimes(1);
    expect(box.run).toHaveBeenCalledWith('pwd', expect.anything());
  });

  it('does not cache a failed workdir probe', async () => {
    const sandbox = await provider().sandbox.create();
    const box = h.state.lastBox;

    // Failed probe falls back to '/' for this op only — it is not cached.
    box.run.mockResolvedValueOnce({ stdout: '', stderr: 'boom', exitCode: 1 });
    await sandbox.filesystem.writeFile('x.txt', 'x');
    expect(box.fs.write).toHaveBeenCalledWith('/x.txt', 'x');

    await sandbox.filesystem.writeFile('y.txt', 'y');
    expect(box.fs.write).toHaveBeenCalledWith('/workspace/y.txt', 'y');
    expect(box.run).toHaveBeenCalledTimes(2);
  });

  it('rejects ambiguous paths in remove', async () => {
    const sandbox = await provider().sandbox.create();
    const box = h.state.lastBox;

    for (const p of ['', '.', './', './.']) {
      await expect(sandbox.filesystem.remove(p)).rejects.toThrow();
    }
    expect(box.fs.remove).not.toHaveBeenCalled();
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
  it('pauses and resumes the native Sailbox in memory', async () => {
    const compute = provider();
    expect(compute.sandbox.pause).toEqual({ memory: true });
    const sandbox = await compute.sandbox.create();
    const box = h.state.lastBox;
    await sandbox.pause!();
    expect(box.pause).toHaveBeenCalledTimes(1);
    await sandbox.resume!();
    expect(box.resume).toHaveBeenCalledTimes(1);
    expect(sandbox.getInstance()).toBe(box);
  });

  it('declares that checkpoints keep the rootfs and memory without stopping the source', () => {
    expect(provider().snapshot!.capabilities).toEqual({
      scope: 'rootfs',
      memory: true,
      destroysSource: false,
    });
  });

  it('checkpoints a Sailbox and restores a new one from the checkpoint', async () => {
    const compute = provider();
    const snapshot = await compute.snapshot!.create('sb_src', { name: 'snap' });
    expect(snapshot).toMatchObject({
      id: 'ckpt_1',
      provider: 'sail',
      metadata: { sailboxId: 'sb_src', checkpointGeneration: 3, name: 'snap' },
    });

    const restored = await compute.sandbox.create({ snapshotId: 'ckpt_1', name: 'copy' });
    expect(restored.sandboxId).toBe('sb_restored');
    expect(h.state.createArgs).toEqual([
      expect.objectContaining({ checkpointId: 'ckpt_1', name: 'copy' }),
    ]);
  });

  it('lists and deletes checkpoints through the Sailbox HTTPS API', async () => {
    const calls: Array<{ url: string; method?: string; auth?: string }> = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        method: init.method,
        auth: (init.headers as Record<string, string>).authorization,
      });
      if (init.method === 'DELETE') {
        return new Response('{"error":{"message":"gone"}}', { status: 404 });
      }
      const offset = Number(new URL(url).searchParams.get('offset'));
      return new Response(
        JSON.stringify({
          data: [
            {
              checkpoint_id: `ckpt_${offset}`,
              name: null,
              sailbox_id: 'sb_src',
              app_id: 'app_demo',
              checkpoint_generation: 1,
              created_at: '2026-01-01T00:00:00Z',
              expires_at: null,
            },
          ],
          limit: 100,
          offset,
          has_more: offset === 0,
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const compute = provider();
      const listed = await compute.snapshot!.list({ instanceId: 'sb_src' });
      expect(listed.map((s) => s.id)).toEqual(['ckpt_0', 'ckpt_100']);
      expect(calls[0].url).toBe(
        'https://sb-dev.example/v1/sailbox-checkpoints?limit=100&offset=0&sailbox_id=sb_src',
      );
      expect(calls[0].auth).toBe('Bearer key');
      await expect(compute.snapshot!.delete('ckpt_0')).resolves.toBeUndefined();
      expect(calls[2]).toMatchObject({
        url: 'https://sb-dev.example/v1/sailbox-checkpoints/ckpt_0',
        method: 'DELETE',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
