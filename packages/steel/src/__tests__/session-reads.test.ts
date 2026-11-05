import { describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => {
  class APIError extends Error {
    constructor(public status: number) {
      super(`${status}`);
    }
  }
  class NotFoundError extends APIError {
    constructor() {
      super(404);
    }
  }
  return {
    APIError,
    NotFoundError,
    create: vi.fn(async () => ({ id: 'fresh', websocketUrl: 'wss://steel.example', status: 'live' })),
    retrieve: vi.fn(),
    release: vi.fn(),
  };
});

vi.mock('steel-sdk', () => ({
  default: class Steel {
    static APIError = sdk.APIError;
    static NotFoundError = sdk.NotFoundError;
    sessions = { create: sdk.create, retrieve: sdk.retrieve, release: sdk.release };
  },
  toFile: vi.fn(),
}));

import { steel } from '../index';

describe('steel session reads', () => {
  it('retries a just-created session through the 404 propagation window', async () => {
    const provider = steel({ apiKey: 'test' });
    await provider.session.create();
    sdk.retrieve
      .mockRejectedValueOnce(new sdk.NotFoundError())
      .mockResolvedValueOnce({ id: 'fresh', websocketUrl: 'wss://steel.example', status: 'live' });
    sdk.release.mockRejectedValueOnce(new sdk.NotFoundError()).mockResolvedValueOnce({});

    const found = await provider.session.getById('fresh');
    expect(found?.sessionId).toBe('fresh');
    await provider.session.destroy('fresh');
    expect(sdk.release).toHaveBeenCalledTimes(2);
  });

  it('returns null for unknown ids without retrying, and surfaces other errors', async () => {
    const provider = steel({ apiKey: 'test' });
    sdk.retrieve.mockReset().mockRejectedValueOnce(new sdk.NotFoundError());
    expect(await provider.session.getById('unknown')).toBeNull();
    expect(sdk.retrieve).toHaveBeenCalledTimes(1);

    sdk.retrieve.mockRejectedValueOnce(new sdk.APIError(500));
    await expect(provider.session.getById('unknown')).rejects.toThrow('500');
  });
});
