import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  get: vi.fn(),
  sandboxLookup: vi.fn(),
  toolboxLookup: vi.fn(),
  delete: vi.fn(),
  construct: vi.fn(),
}));

// Only the native boundary is replaced: exercise the real provider factory.
// SDK 0.224.0: public get can fail on a SECONDARY toolbox lookup after a
// positive sandbox lookup. Use actual exported error classes, never names or
// locally invented classes. Importing the module does not call a provider API.
vi.mock('@daytonaio/sdk', async () => {
  const actual = await vi.importActual<typeof import('@daytonaio/sdk')>('@daytonaio/sdk');
  return {
    ...actual,
    Daytona: class {
      constructor(options: unknown) { native.construct(options); }
      get = native.get;
    },
  };
});

import { DaytonaError, DaytonaNotFoundError } from '@daytonaio/sdk';
import { daytona } from '../index';

const provider = () => daytona({ apiKey: 'native-mock-only' });

beforeEach(() => {
  vi.clearAllMocks();
  native.get.mockReset().mockResolvedValue({ id: 'canonical-id', delete: native.delete });
  native.sandboxLookup.mockReset();
  native.toolboxLookup.mockReset();
  native.delete.mockReset().mockResolvedValue(undefined);
});

describe('Daytona native lifecycle contract', () => {
  it('queries existence and returns the native identity rather than a lookup alias', async () => {
    const sandbox = await provider().instances.getById('lookup-name');
    expect(native.get).toHaveBeenCalledOnce();
    expect(native.get).toHaveBeenCalledWith('lookup-name');
    expect(sandbox?.instanceId).toBe('canonical-id');
    expect(sandbox?.getInstance()).toMatchObject({ id: 'canonical-id' });
    expect(native.delete).not.toHaveBeenCalled();
  });

  it.each([
    new DaytonaNotFoundError('opaque native 404', 404),
    new DaytonaError('opaque HTTP 404', 404),
  ])('propagates ambiguous public-get 404s rather than inventing absence %#', async error => {
    native.get.mockRejectedValueOnce(error);
    await expect(provider().instances.getById('missing')).rejects.toBe(error);
  });

  it.each(['getById', 'destroy'] as const)(
    '%s propagates the actual native 404 from a secondary lookup after sandbox existence was proven',
    async operation => {
      const error = new DaytonaNotFoundError('auxiliary resource unavailable', 404);
      const sandbox = { id: 'canonical-id', delete: native.delete };
      native.sandboxLookup.mockResolvedValueOnce(sandbox);
      native.toolboxLookup.mockRejectedValueOnce(error);
      // Model the documented public get sequence (Daytona.js:460-463,
      // 528-536), not private SDK entry points or an invented endpoint API.
      native.get.mockImplementationOnce(async (id: string) => {
        const existing = await native.sandboxLookup(id);
        await native.toolboxLookup(existing.id);
        return existing;
      });
      await expect(provider().instances[operation]('lookup-name')).rejects.toBe(error);
      expect(native.sandboxLookup).toHaveBeenCalledWith('lookup-name');
      expect(native.toolboxLookup).toHaveBeenCalledWith('canonical-id');
      expect(native.sandboxLookup.mock.invocationCallOrder[0])
        .toBeLessThan(native.toolboxLookup.mock.invocationCallOrder[0]);
      expect(native.delete).not.toHaveBeenCalled();
    },
  );

  it.each([
    new Error('sandbox not found in proxy configuration'),
    new Error('request token 404 rejected'),
    Object.assign(new Error('not found'), { statusCode: 401 }),
    Object.assign(new Error('not found'), { statusCode: 403 }),
    Object.assign(new Error('404'), { statusCode: 429 }),
    Object.assign(new Error('not found'), { statusCode: 503 }),
    Object.assign(new Error('opaque'), { statusCode: '404' }),
    Object.assign(new Error('opaque'), { status: 404 }),
    Object.assign(new Error('opaque'), { name: 'DaytonaNotFoundError' }),
    new Error('ECONNRESET'),
  ])('preserves non-absence lookup errors %#', async error => {
    native.get.mockRejectedValueOnce(error);
    await expect(provider().instances.getById('existing')).rejects.toBe(error);
  });

  it.each([undefined, null, {}, { id: '' }, { id: 7 }])(
    'rejects a malformed successful native lookup %# without inventing an instance',
    async result => {
      native.get.mockResolvedValueOnce(result);
      await expect(provider().instances.getById('existing')).rejects.toThrow();
    },
  );

  it('accepts native void deletion, awaiting it exactly once', async () => {
    await expect(provider().instances.destroy('existing')).resolves.toBeUndefined();
    expect(native.get).toHaveBeenCalledOnce();
    expect(native.get).toHaveBeenCalledWith('existing');
    expect(native.delete).toHaveBeenCalledOnce();
    expect(native.delete).toHaveBeenCalledWith();
  });

  it.each([
    new DaytonaNotFoundError('opaque native 404', 404),
    new DaytonaError('opaque HTTP 404', 404),
  ])('does not silently no-op destroy for ambiguous public-get 404s %#', async error => {
    native.get.mockRejectedValueOnce(error);
    await expect(provider().instances.destroy('missing')).rejects.toBe(error);
    expect(native.delete).not.toHaveBeenCalled();
  });

  it.each([
    new Error('not found in proxy configuration'),
    Object.assign(new Error('request 404 failed'), { statusCode: 503 }),
    new Error('ECONNRESET'),
  ])('preserves destroy lookup errors %#', async error => {
    native.get.mockRejectedValueOnce(error);
    await expect(provider().instances.destroy('existing')).rejects.toBe(error);
    expect(native.delete).not.toHaveBeenCalled();
  });

  it.each([
    new Error('request 404 failed'),
    Object.assign(new Error('not found'), { statusCode: 503 }),
    new DaytonaNotFoundError('deletion raced'),
    new Error('ECONNRESET'),
  ])('does not suppress native deletion errors after a positive lookup %#', async error => {
    native.delete.mockRejectedValueOnce(error);
    await expect(provider().instances.destroy('existing')).rejects.toBe(error);
    expect(native.delete).toHaveBeenCalledOnce();
  });
});
