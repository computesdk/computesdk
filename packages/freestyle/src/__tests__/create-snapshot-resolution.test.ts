import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `create` used to resolve the runtime snapshot by listing snapshots and
 * searching for its slug, on every cold start, before the first VM could boot.
 * The API resolves `snapshotId` from a slug itself, so the list is unnecessary
 * — and it was expensive in the worst place, blocking every concurrent create
 * behind one extra round trip.
 *
 * These tests pin both halves: the list must not happen on the common path, and
 * the bake must still happen when the snapshot genuinely is not there yet.
 */

const RUNTIME_SLUG = 'computesdk-freestyle-runtime';

class MockFreestyleApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.code = code;
    this.status = status;
  }
}

/**
 * What the API actually answers a create that names a snapshot it does not
 * have — a 400, not a 404. Verified live: `400 BAD_REQUEST bad request:
 * snapshot computesdk-freestyle-runtime does not exist`.
 */
function missingSnapshot(slug: string) {
  return new MockFreestyleApiError(
    400,
    'BAD_REQUEST',
    `bad request: snapshot ${slug} does not exist`,
  );
}

const snapshotsList = vi.fn();
const vmsCreate = vi.fn();
const vmsDelete = vi.fn();
const vmExec = vi.fn();
const vmSnapshot = vi.fn();

vi.mock('freestyle', () => ({
  FreestyleApiError: MockFreestyleApiError,
  Freestyle: class {
    vms = {
      create: vmsCreate,
      delete: vmsDelete,
      ref: (id: string) => ({ id }),
      snapshots: { list: snapshotsList },
    };
  },
}));

/** A booted VM, as `vms.create` resolves it. */
function booted(vmId: string) {
  return {
    vmId,
    vm: { id: vmId, exec: vmExec, snapshot: vmSnapshot },
  };
}

/**
 * A provider built from a freshly loaded module.
 *
 * The bake is memoized in module scope — deliberately, so a burst of sandboxes
 * bakes once — which would otherwise carry one test's snapshot into the next.
 */
async function freshProvider() {
  vi.resetModules();
  const { freestyle } = await import('../index');
  return freestyle({ apiKey: 'key' });
}

describe('create: snapshot resolution', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    snapshotsList.mockResolvedValue({ snapshots: [], totalCount: 0 });
    vmsDelete.mockResolvedValue(undefined);
    vmExec.mockResolvedValue({ statusCode: 0, stdout: '', stderr: '' });
    vmSnapshot.mockResolvedValue({ snapshotId: 'snap-baked' });
  });

  it('names the runtime snapshot by slug instead of looking it up', async () => {
    vmsCreate.mockResolvedValue(booted('vm-1'));

    const compute = await freshProvider();
    const sandbox = await compute.sandbox.create();

    expect(sandbox.sandboxId).toBe('vm-1');
    expect(snapshotsList).not.toHaveBeenCalled();
    expect(vmsCreate).toHaveBeenCalledTimes(1);
    expect(vmsCreate.mock.calls[0][0]).toMatchObject({ snapshotId: RUNTIME_SLUG });
  });

  it('bakes the runtime snapshot when the API says it does not exist', async () => {
    vmsCreate
      // The sandbox the caller asked for: no such snapshot, yet.
      .mockRejectedValueOnce(missingSnapshot(RUNTIME_SLUG))
      // The builder VM the bake runs in.
      .mockResolvedValueOnce(booted('vm-builder'))
      // The retry, now that the snapshot exists.
      .mockResolvedValueOnce(booted('vm-2'));

    const compute = await freshProvider();
    const sandbox = await compute.sandbox.create();

    expect(sandbox.sandboxId).toBe('vm-2');
    expect(vmSnapshot).toHaveBeenCalledTimes(1);
    expect(vmsDelete).toHaveBeenCalledWith('vm-builder');
    expect(vmsCreate.mock.calls[2][0]).toMatchObject({ snapshotId: 'snap-baked' });
  });

  it('bakes once when a burst of sandboxes all miss', async () => {
    vmsCreate.mockImplementation(async (options: { snapshotId?: string }) => {
      if (options.snapshotId === RUNTIME_SLUG) {
        throw missingSnapshot(RUNTIME_SLUG);
      }
      if (options.snapshotId === 'snap-baked') return booted('vm-from-baked');
      // No snapshot named: the bake's builder VM.
      return booted('vm-builder');
    });

    const compute = await freshProvider();
    const sandboxes = await Promise.all(
      Array.from({ length: 5 }, () => compute.sandbox.create()),
    );

    expect(sandboxes.map((s) => s.sandboxId)).toEqual(Array(5).fill('vm-from-baked'));
    expect(vmSnapshot).toHaveBeenCalledTimes(1);
  });

  it('does not bake in response to an unrelated bad request', async () => {
    // A 400 is also how a malformed create is refused. Baking a runtime image
    // because the metadata was wrong would be nonsense, and slow nonsense.
    vmsCreate.mockRejectedValue(
      new MockFreestyleApiError(400, 'BAD_REQUEST', 'bad request: metadata value too long'),
    );

    const compute = await freshProvider();

    await expect(compute.sandbox.create()).rejects.toThrow();
    expect(vmsCreate).toHaveBeenCalledTimes(1);
    expect(vmSnapshot).not.toHaveBeenCalled();
  });

  it('passes an explicit snapshot straight through and never bakes', async () => {
    vmsCreate.mockRejectedValue(missingSnapshot('snap-explicit'));

    const compute = await freshProvider();

    await expect(compute.sandbox.create({ snapshotId: 'snap-explicit' })).rejects.toThrow();
    expect(vmsCreate).toHaveBeenCalledTimes(1);
    expect(vmsCreate.mock.calls[0][0]).toMatchObject({ snapshotId: 'snap-explicit' });
    expect(vmSnapshot).not.toHaveBeenCalled();
  });
});
