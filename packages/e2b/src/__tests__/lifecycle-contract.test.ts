import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError, FileNotFoundError, NotFoundError, RateLimitError, SandboxNotFoundError } from 'e2b';
import type { SandboxInfo } from 'e2b';

const native = vi.hoisted(() => ({
  kill: vi.fn(),
  connect: vi.fn(),
  getInfo: vi.fn(),
  list: vi.fn(),
}));

// Only the native package is mocked. Keep its actual exported error classes:
// an error message resembling absence is not a native absence indication.
vi.mock('e2b', async importOriginal => {
  const actual = await importOriginal<typeof import('e2b')>();
  return { ...actual, Sandbox: native };
});

import { e2b } from '../index';

describe('E2B native instance destruction contract', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('E2B_API_KEY', '');
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it.each([true, false])('uses static native kill without connecting (native killed=%s)', async killed => {
    // Native 2.30.1 documents false as not found; both booleans complete
    // unified void destruction, without connecting/resuming a paused sandbox.
    native.kill.mockResolvedValue(killed);
    await expect(e2b({ apiKey: 'e2b_aabb' }).instances.destroy('opaque-sandbox')).resolves.toBeUndefined();
    expect(native.kill).toHaveBeenCalledOnce();
    expect(native.kill).toHaveBeenCalledWith('opaque-sandbox', { apiKey: 'e2b_aabb' });
    expect(native.connect).not.toHaveBeenCalled();
    expect(native.getInfo).not.toHaveBeenCalled();
  });

  it.each([
    ['auth', () => new AuthenticationError('Unauthorized')],
    ['rate limit', () => new RateLimitError('Rate limit exceeded')],
    ['network', () => new Error('Network unavailable')],
    ['absence-like message', () => new Error('Sandbox already destroyed: 404 not found')],
    ['unexpected typed not-found rejection', () => new SandboxNotFoundError('Native rejected instead of returning false')],
  ])('propagates native kill failures (%s) rather than claiming cleanup', async (_label, makeError) => {
    const failure = makeError();
    native.kill.mockRejectedValue(failure);
    await expect(e2b({}).instances.destroy('opaque-sandbox')).rejects.toBe(failure);
    expect(native.connect).not.toHaveBeenCalled();
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['string', 'private-provider-payload'],
    ['object', { deleted: true, secret: 'private-provider-payload' }],
    ['number', 0],
  ])('rejects malformed native kill results (%s) with a safe error', async (_label, result) => {
    native.kill.mockResolvedValue(result);
    await expect(e2b({}).instances.destroy('opaque-sandbox')).rejects.toMatchObject({
      message: 'Invalid E2B sandbox kill response.',
    });
    expect(native.kill).toHaveBeenCalledOnce();
    expect(native.connect).not.toHaveBeenCalled();
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty', ''],
    ['blank', ' \t\n'],
    ['number', 123],
    ['object', { secret: 'private-caller-payload' }],
  ])('rejects invalid caller sandbox IDs (%s) before native I/O', async (_label, id) => {
    native.kill.mockResolvedValue(true);
    await expect(e2b({}).instances.destroy(id as unknown as string)).rejects.toMatchObject({
      message: 'E2B sandbox ID must be a non-empty string.',
    });
    expect(native.kill).not.toHaveBeenCalled();
    expect(native.connect).not.toHaveBeenCalled();
  });

  it('keeps opaque IDs and per-provider auth unchanged without mutating config or environment', async () => {
    vi.stubEnv('E2B_API_KEY', 'e2b_ccdd');
    native.kill.mockResolvedValue(true);
    const config = Object.freeze({ apiKey: 'e2b_aabb' });
    const configured = e2b(config);
    const fallback = e2b({});
    await configured.instances.destroy(' opaque/id:tag?value=%2F#ü ');
    await fallback.instances.destroy('another-sandbox');
    expect(native.kill.mock.calls).toEqual([
      [' opaque/id:tag?value=%2F#ü ', { apiKey: 'e2b_aabb' }],
      ['another-sandbox', { apiKey: 'e2b_ccdd' }],
    ]);
    expect(native.connect).not.toHaveBeenCalled();
    expect(config).toEqual({ apiKey: 'e2b_aabb' });
    expect(process.env.E2B_API_KEY).toBe('e2b_ccdd');
  });
});

const sandboxInfo: SandboxInfo = {
  sandboxId: 'opaque-sandbox',
  templateId: 'template-id',
  metadata: { owner: 'test' },
  startedAt: new Date('2026-01-01T00:00:00Z'),
  endAt: new Date('2026-01-01T00:05:00Z'),
  state: 'running',
  cpuCount: 2,
  memoryMB: 512,
  envdVersion: '0.2.0',
  sandboxDomain: 'e2b.app',
  volumeMounts: [],
};

function connectedHandle(sandboxId = sandboxInfo.sandboxId) {
  return {
    sandboxId,
    sandboxDomain: 'e2b.app',
    envdAccessToken: 'private-envd-token',
    trafficAccessToken: 'private-traffic-token',
    files: { read: vi.fn().mockRejectedValue(new Error('No egress router')) },
    commands: { run: vi.fn().mockResolvedValue({ stdout: 'ready', stderr: '', exitCode: 0 }) },
  };
}

describe('E2B native getById existence precheck contract', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('E2B_API_KEY', '');
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('returns null only for genuine typed native sandbox-not-found from the read-only precheck', async () => {
    native.getInfo.mockRejectedValue(new SandboxNotFoundError('A genuine native absence'));
    expect(await e2b({ apiKey: 'e2b_aabb' }).instances.getById(sandboxInfo.sandboxId)).toBeNull();
    expect(native.getInfo).toHaveBeenCalledOnce();
    expect(native.getInfo).toHaveBeenCalledWith(sandboxInfo.sandboxId, { apiKey: 'e2b_aabb' });
    expect(native.connect).not.toHaveBeenCalled();
  });

  it.each([
    ['auth', () => new AuthenticationError('Unauthorized')],
    ['rate limit', () => new RateLimitError('Rate limit exceeded')],
    ['network', () => new Error('Network unavailable')],
    ['absence-like message', () => new Error('Sandbox 404 not found')],
    ['base not-found class', () => new NotFoundError('Not a typed sandbox absence')],
    ['file not-found class', () => new FileNotFoundError('Not a sandbox absence')],
    ['spoofed class name', () => Object.assign(new Error('Missing'), { name: 'SandboxNotFoundError' })],
  ])('propagates precheck failures (%s) without connecting or claiming absence', async (_label, makeError) => {
    const failure = makeError();
    native.getInfo.mockRejectedValue(failure);
    await expect(e2b({}).instances.getById(sandboxInfo.sandboxId)).rejects.toBe(failure);
    expect(native.connect).not.toHaveBeenCalled();
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['array', []],
    ['string', 'private-provider-payload'],
    ['missing ID', { metadata: { secret: 'private-provider-payload' } }],
    ['undefined ID', { ...sandboxInfo, sandboxId: undefined }],
    ['null ID', { ...sandboxInfo, sandboxId: null }],
    ['blank ID', { ...sandboxInfo, sandboxId: ' \t' }],
    ['number ID', { ...sandboxInfo, sandboxId: 123 }],
    ['mismatched ID', { ...sandboxInfo, sandboxId: 'another-sandbox' }],
  ])('rejects malformed native getInfo identity (%s) before connecting', async (_label, info) => {
    native.getInfo.mockResolvedValue(info);
    await expect(e2b({}).instances.getById(sandboxInfo.sandboxId)).rejects.toMatchObject({
      message: 'Invalid E2B sandbox getInfo response.',
    });
    expect(native.connect).not.toHaveBeenCalled();
  });

  it.each(['running', 'paused'] as const)(
    'preserves the exact secure native handle after positive %s metadata and public connect',
    async state => {
      // Positive lookup deliberately retains native connect's existing ability
      // to resume a paused sandbox / renew timeout; it is not pure inspection.
      native.getInfo.mockResolvedValue({ ...sandboxInfo, state });
      const handle = connectedHandle();
      native.connect.mockResolvedValue(handle);
      const instance = await e2b({ apiKey: 'e2b_aabb' }).instances.getById(sandboxInfo.sandboxId);
      expect(native.getInfo).toHaveBeenCalledOnce();
      expect(native.connect).toHaveBeenCalledOnce();
      expect(native.connect).toHaveBeenCalledWith(sandboxInfo.sandboxId, { apiKey: 'e2b_aabb' });
      expect(native.getInfo.mock.invocationCallOrder[0]).toBeLessThan(native.connect.mock.invocationCallOrder[0]);
      expect(instance!.getInstance()).toBe(handle);
      expect(instance!.getInstance().trafficAccessToken).toBe('private-traffic-token');
      expect(await instance!.runCommand('echo ready')).toMatchObject({ stdout: 'ready', exitCode: 0 });
      expect(handle.commands.run).toHaveBeenCalledWith('echo ready', { timeoutMs: undefined });
    },
  );

  it.each([
    ['auth', () => new AuthenticationError('Unauthorized')],
    ['rate limit', () => new RateLimitError('Rate limit exceeded')],
    ['network', () => new Error('Network unavailable')],
    ['typed absence race', () => new SandboxNotFoundError('Disappeared between GET and connect')],
  ])('propagates positive-path connect failures (%s), never converting them to null', async (_label, makeError) => {
    native.getInfo.mockResolvedValue(sandboxInfo);
    const failure = makeError();
    native.connect.mockRejectedValue(failure);
    await expect(e2b({}).instances.getById(sandboxInfo.sandboxId)).rejects.toBe(failure);
    expect(native.getInfo).toHaveBeenCalledOnce();
    expect(native.connect).toHaveBeenCalledOnce();
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty', ''],
    ['blank', ' \t\n'],
    ['number', 123],
    ['object', { secret: 'private-caller-payload' }],
  ])('rejects invalid caller lookup IDs (%s) before native I/O', async (_label, id) => {
    await expect(e2b({}).instances.getById(id as unknown as string)).rejects.toMatchObject({
      message: 'E2B sandbox ID must be a non-empty string.',
    });
    expect(native.getInfo).not.toHaveBeenCalled();
    expect(native.connect).not.toHaveBeenCalled();
  });

  it('keeps configured/env auth and opaque identity unchanged across precheck and connection', async () => {
    vi.stubEnv('E2B_API_KEY', 'e2b_ccdd');
    const id = ' opaque/id:tag?value=%2F#ü ';
    native.getInfo.mockResolvedValue({ ...sandboxInfo, sandboxId: id });
    native.connect.mockResolvedValue(connectedHandle(id));
    const config = Object.freeze({ apiKey: 'e2b_aabb' });
    await e2b(config).instances.getById(id);
    await e2b({}).instances.getById(id);
    for (const method of [native.getInfo, native.connect]) {
      expect(method.mock.calls).toEqual([
        [id, { apiKey: 'e2b_aabb' }],
        [id, { apiKey: 'e2b_ccdd' }],
      ]);
    }
    expect(config).toEqual({ apiKey: 'e2b_aabb' });
    expect(process.env.E2B_API_KEY).toBe('e2b_ccdd');
  });

  it('confirms typed absence after cleanup without reconnecting or resurrecting the sandbox', async () => {
    native.getInfo.mockResolvedValueOnce(sandboxInfo)
      .mockRejectedValueOnce(new SandboxNotFoundError('Deleted sandbox'));
    const handle = connectedHandle();
    native.connect.mockResolvedValue(handle);
    native.kill.mockResolvedValue(true);
    const provider = e2b({ apiKey: 'e2b_aabb' });
    expect((await provider.instances.getById(sandboxInfo.sandboxId))!.getInstance()).toBe(handle);
    await provider.instances.destroy(sandboxInfo.sandboxId);
    expect(await provider.instances.getById(sandboxInfo.sandboxId)).toBeNull();
    expect(native.getInfo).toHaveBeenCalledTimes(2);
    expect(native.kill).toHaveBeenCalledWith(sandboxInfo.sandboxId, { apiKey: 'e2b_aabb' });
    // Only the initial positive lookup materializes a secure native handle.
    expect(native.connect).toHaveBeenCalledOnce();
  });
});
