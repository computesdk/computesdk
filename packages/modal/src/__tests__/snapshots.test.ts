import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  client: vi.fn(),
  app: vi.fn(),
  sandbox: vi.fn(),
  snapshotFilesystem: vi.fn(),
  image: vi.fn(),
  build: vi.fn(),
  create: vi.fn(),
  deleteImage: vi.fn(),
}));

vi.mock('modal', () => ({
  ModalClient: sdk.client,
  NotFoundError: class extends Error {},
  SandboxFilesystemNotFoundError: class extends Error {},
}));

let modal: typeof import('../index').modal;
const credentials = { tokenId: 'test-token', tokenSecret: 'test-secret' };

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  sdk.app.mockResolvedValue({ appId: 'ap-test' });
  sdk.sandbox.mockResolvedValue({ snapshotFilesystem: sdk.snapshotFilesystem });
  sdk.snapshotFilesystem.mockResolvedValue({ imageId: 'im-snapshot' });
  sdk.image.mockResolvedValue({ build: sdk.build });
  sdk.build.mockResolvedValue({ imageId: 'im-snapshot' });
  sdk.create.mockResolvedValue({ sandboxId: 'sb-restored' });
  sdk.deleteImage.mockResolvedValue(undefined);
  sdk.client.mockImplementation(() => ({
    apps: { fromName: sdk.app },
    images: { fromId: sdk.image, delete: sdk.deleteImage },
    sandboxes: { fromId: sdk.sandbox, create: sdk.create },
  }));
  ({ modal } = await import('../index'));
});

describe('Modal snapshot operations', () => {
  it('advertises real creation and deletion, but not listing', () => {
    const provider = modal(credentials);

    expect(provider.snapshot!.operations).toEqual({ create: true, list: false, delete: true });
    expect(provider.snapshot!.capabilities).toEqual({ scope: 'rootfs', memory: false, destroysSource: false });
  });

  it.each([
    undefined,
    {},
    { limit: 2 },
    { instanceId: 'sb-source', limit: 2 },
    { sandboxId: 'sb-source', limit: 2 },
  ])('rejects unsupported listing with options %j without invoking the native SDK', async (options) => {
    const { UnsupportedOperationError } = await import('@computesdk/provider');
    const provider = modal(credentials);
    const result = provider.snapshot!.list(options);

    await expect(result).rejects.toBeInstanceOf(UnsupportedOperationError);
    await expect(result).rejects.toMatchObject({
      name: 'UnsupportedOperationError', code: 'unsupported', provider: 'modal', operation: 'snapshot.list',
    });
    for (const [name, method] of Object.entries(sdk)) {
      if (name !== 'client') expect(method).not.toHaveBeenCalled();
    }
  });

  it('creates a filesystem snapshot of the requested source sandbox', async () => {
    const snapshot = await modal(credentials).snapshot!.create('sb-source');

    expect(sdk.sandbox).toHaveBeenCalledWith('sb-source');
    expect(sdk.snapshotFilesystem).toHaveBeenCalledTimes(1);
    expect(snapshot).toEqual({
      id: 'im-snapshot', image: { imageId: 'im-snapshot' }, provider: 'modal', createdAt: expect.any(Date),
    });
  });

  it('preserves native snapshot creation errors', async () => {
    sdk.snapshotFilesystem.mockRejectedValueOnce(new Error('snapshot failed'));

    await expect(modal(credentials).snapshot!.create('sb-source'))
      .rejects.toThrow('Failed to create Modal snapshot: snapshot failed');
  });

  it('deletes snapshot images through the native SDK', async () => {
    await modal(credentials).snapshot!.delete('im-snapshot');

    expect(sdk.deleteImage).toHaveBeenCalledOnce();
    expect(sdk.deleteImage).toHaveBeenCalledWith('im-snapshot');
  });

  it('restores snapshots by building their image and creating a new sandbox', async () => {
    const sandbox = await modal(credentials).sandbox.create({ snapshotId: 'im-snapshot' });

    expect(sdk.app).toHaveBeenCalledWith('computesdk-modal', { createIfMissing: true });
    expect(sdk.image).toHaveBeenCalledWith('im-snapshot');
    expect(sdk.build).toHaveBeenCalledWith({ appId: 'ap-test' });
    expect(sdk.create).toHaveBeenCalledWith(
      { appId: 'ap-test' }, { imageId: 'im-snapshot' }, { encryptedPorts: [38989] },
    );
    expect(sandbox.sandboxId).toBe('sb-restored');
  });
});
