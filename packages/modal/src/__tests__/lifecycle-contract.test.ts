import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  client: vi.fn(),
  fromId: vi.fn(),
  poll: vi.fn(),
  terminate: vi.fn(),
  readText: vi.fn(),
}));

// Only the public native SDK is replaced; use the real adapter/factory.
vi.mock('modal', () => ({
  SandboxFilesystemNotFoundError: class extends Error {},
  ModalClient: class {
    constructor(config: unknown) { native.client(config); }
    apps = { fromName: async () => ({}) };
    sandboxes = { fromId: native.fromId };
  },
}));

import { modal } from '../index';

const id = 'sb-opaque/id ?#%';
const config = { tokenId: 'mock-id', tokenSecret: 'mock-secret', environment: 'mock-env' };
const failures = [
  ['authentication', Object.assign(new Error('unauthenticated'), { code: 16 })],
  ['permission', Object.assign(new Error('permission denied'), { code: 7 })],
  ['rate limit', Object.assign(new Error('resource exhausted'), { code: 8 })],
  ['network', new TypeError('connection failed')],
  ['misleading message', new Error('upstream 404, not an absence contract')],
  ['misleading name', Object.assign(new Error('denied'), { name: 'NotFoundError' })],
  // modal@0.11.0 poll forwards raw gRPC errors. A numeric gRPC code is
  // not public numeric HTTP status metadata or a native 404 error class.
  ['raw gRPC absence (nullable contract remains blocked)', Object.assign(new Error('missing'), { code: 5 })],
] as const;

beforeEach(() => {
  vi.resetAllMocks();
  native.poll.mockResolvedValue(null);
  native.terminate.mockResolvedValue(undefined);
  native.readText.mockResolvedValue('');
  // Installed fromId constructs a handle without an existence query.
  native.fromId.mockResolvedValue({
    sandboxId: id,
    poll: native.poll,
    terminate: native.terminate,
    filesystem: { readText: native.readText },
  });
});

describe('Modal lifecycle contract (public native SDK mocks)', () => {
  it.each([null, 0, 23])('queries native existence before returning an opaque ID (poll=%s)', async status => {
    native.poll.mockResolvedValue(status);
    const instance = await modal(config).instances.getById(id);
    expect(instance?.sandboxId).toBe(id);
    expect(native.fromId).toHaveBeenCalledOnce();
    expect(native.fromId).toHaveBeenCalledWith(id);
    expect(native.poll).toHaveBeenCalledOnce();
    expect(native.poll).toHaveBeenCalledWith();
    expect(native.client).toHaveBeenCalledWith(config);
  });

  it.each(failures)('lookup propagates %s from the actual existence query', async (_kind, error) => {
    native.poll.mockRejectedValue(error);
    await expect(modal(config).instances.getById(id)).rejects.toBe(error);
    expect(native.poll).toHaveBeenCalledOnce();
    expect(native.readText).not.toHaveBeenCalled();
  });

  it.each(failures)('lookup propagates rejected handle acquisition: %s', async (_kind, error) => {
    native.fromId.mockRejectedValue(error);
    await expect(modal(config).instances.getById(id)).rejects.toBe(error);
    expect(native.poll).not.toHaveBeenCalled();
  });

  it('rejects a native handle exposing a different identity', async () => {
    native.fromId.mockResolvedValue({ sandboxId: 'different-id', poll: native.poll });
    await expect(modal(config).instances.getById(id)).rejects.toThrow('identity');
  });

  it('terminates the native handle once, without interpreting a void response', async () => {
    await expect(modal(config).instances.destroy(id)).resolves.toBeUndefined();
    expect(native.fromId).toHaveBeenCalledOnce();
    expect(native.fromId).toHaveBeenCalledWith(id);
    expect(native.terminate).toHaveBeenCalledOnce();
    expect(native.terminate).toHaveBeenCalledWith();
  });

  it.each(failures)('destroy propagates native termination failure: %s', async (_kind, error) => {
    native.terminate.mockRejectedValue(error);
    await expect(modal(config).instances.destroy(id)).rejects.toBe(error);
  });

  it.each(failures)('destroy propagates rejected handle acquisition: %s', async (_kind, error) => {
    native.fromId.mockRejectedValue(error);
    await expect(modal(config).instances.destroy(id)).rejects.toBe(error);
    expect(native.terminate).not.toHaveBeenCalled();
  });
});
