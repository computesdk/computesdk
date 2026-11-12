import { beforeEach, describe, expect, it, vi } from 'vitest';

// Failure cases: restoring a full snapshot drops size; another create path
// regresses; omitting size accidentally forces a tier instead of the SDK default.
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  restore: vi.fn(),
  ephemeralCreate: vi.fn(),
  ephemeralRestore: vi.fn(),
}));

vi.mock('@upstash/box', () => ({
  Box: class {
    static create = mocks.create;
    static fromSnapshot = mocks.restore;
  },
  EphemeralBox: class {
    static create = mocks.ephemeralCreate;
    static fromSnapshot = mocks.ephemeralRestore;
  },
}));

import { upstash } from '../index';

describe('create: native Box sizes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    for (const mock of Object.values(mocks)) mock.mockResolvedValue({ id: 'box-test' });
  });

  it.each(['small', 'medium', 'large'] as const)('passes %s to full snapshot restores', async size => {
    const provider = upstash({ apiKey: 'test-key' });
    await provider.sandbox.create({ snapshotId: 'snap-test', size });
    expect(mocks.restore).toHaveBeenCalledWith('snap-test', expect.objectContaining({ size }));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([
    [{}, 'create'],
    [{ ephemeral: true }, 'ephemeralCreate'],
    [{ ephemeral: true, snapshotId: 'snap-test' }, 'ephemeralRestore'],
  ] as const)('preserves size on the other create paths (%j)', async (options, method) => {
    const provider = upstash({ apiKey: 'test-key' });
    await provider.sandbox.create({ ...options, size: 'large' });
    const args = mocks[method].mock.calls[0];
    expect(args[args.length - 1]).toMatchObject({ size: 'large' });
  });

  it('leaves the default size to Upstash when none was requested', async () => {
    await upstash({ apiKey: 'test-key' }).sandbox.create({ snapshotId: 'snap-test' });
    expect(mocks.restore.mock.calls[0][1].size).toBeUndefined();
  });
});
