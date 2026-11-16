import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModalConfig } from '../index';

const sdk = vi.hoisted(() => ({
  client: vi.fn(),
  app: vi.fn(),
  registry: vi.fn(),
  image: vi.fn(),
  build: vi.fn(),
  create: vi.fn(),
  deleteImage: vi.fn(),
}));

vi.mock('modal', () => ({
  NotFoundError: class extends Error {},
  SandboxFilesystemNotFoundError: class extends Error {},
  ModalClient: sdk.client,
}));

let modal: typeof import('../index').modal;
const credentials = { tokenId: 'test-token', tokenSecret: 'test-secret' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  let nextSandbox = 0;
  sdk.app.mockImplementation(async (name: string) => ({ appId: `ap-${name}` }));
  sdk.build.mockImplementation(async (source: string) => ({ imageId: source }));
  sdk.registry.mockImplementation((source: string) => ({ build: (app: unknown) => sdk.build(source, app) }));
  sdk.image.mockImplementation(async (source: string) => ({ build: (app: unknown) => sdk.build(source, app) }));
  sdk.create.mockImplementation(async () => ({ sandboxId: `sb-${++nextSandbox}` }));
  sdk.deleteImage.mockResolvedValue(undefined);
  sdk.client.mockImplementation(() => ({
    apps: { fromName: sdk.app },
    images: { fromRegistry: sdk.registry, fromId: sdk.image, delete: sdk.deleteImage },
    sandboxes: { create: sdk.create },
  }));
  ({ modal } = await import('../index'));
});

afterEach(() => { vi.unstubAllEnvs(); });

describe('Modal initialization across provider instances', () => {
  it('shares lazy initialization for a burst of 100 independent providers and creates 100 fresh sandboxes', async () => {
    const providers = Array.from({ length: 100 }, (_, i) => modal({
      ...credentials,
      timeout: 1000 + i,
      ports: [8000 + i],
      daemonSsePort: false,
    }));
    expect(sdk.app).not.toHaveBeenCalled();
    expect(sdk.build).not.toHaveBeenCalled();

    const sandboxes = await Promise.all(providers.map((provider, i) => provider.sandbox.create({ name: `sandbox-${i}` })));

    expect(new Set(sandboxes.map((sandbox) => sandbox.sandboxId)).size).toBe(100);
    expect(sdk.client).toHaveBeenCalledTimes(1);
    expect(sdk.app).toHaveBeenCalledTimes(1);
    expect(sdk.registry).toHaveBeenCalledTimes(1);
    expect(sdk.build).toHaveBeenCalledTimes(1);
    expect(sdk.create).toHaveBeenCalledTimes(100);
    for (let i = 0; i < 100; i++) {
      expect(sdk.create).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
        name: `sandbox-${i}`, timeoutMs: 1000 + i, encryptedPorts: [8000 + i],
      });
    }
    await modal({ ...credentials }).sandbox.create();
    expect(sdk.app).toHaveBeenCalledTimes(1);
    expect(sdk.build).toHaveBeenCalledTimes(1);
  });

  it.each([
    { tokenId: 'another-token' },
    { tokenSecret: 'rotated-secret' },
    { environment: 'another-environment' },
    { appName: 'another-app' },
  ] satisfies Partial<ModalConfig>[])('isolates configuration %j', async (override) => {
    await Promise.all([
      modal(credentials).sandbox.create(),
      modal({ ...credentials, ...override }).sandbox.create(),
    ]);
    expect(sdk.client).toHaveBeenCalledTimes(2);
    expect(sdk.app).toHaveBeenCalledTimes(2);
    expect(sdk.build).toHaveBeenCalledTimes(2);
  });

  it.each([
    'MODAL_TOKEN_ID', 'MODAL_TOKEN_SECRET', 'MODAL_PROFILE', 'MODAL_CONFIG_PATH',
    'MODAL_ENVIRONMENT', 'MODAL_SERVER_URL', 'MODAL_IMAGE_BUILDER_VERSION',
    'MODAL_OAUTH_REFRESH_TOKEN', 'MODAL_OAUTH_CLIENT_ID', 'MODAL_OAUTH_CLIENT_SECRET', 'MODAL_OAUTH_JWT_KEY',
  ])('isolates changes to %s', async (name) => {
    vi.stubEnv(name, 'first');
    await modal().sandbox.create();
    vi.stubEnv(name, 'second');
    await modal().sandbox.create();
    expect(sdk.client).toHaveBeenCalledTimes(2);
    expect(sdk.app).toHaveBeenCalledTimes(2);
    expect(sdk.build).toHaveBeenCalledTimes(2);
  });

  it('coalesces failed app lookups and lets another provider retry', async () => {
    sdk.app.mockRejectedValueOnce(new Error('temporary app lookup failure'));
    const failed = await Promise.allSettled(Array.from({ length: 3 }, () => modal(credentials).sandbox.create()));
    expect(failed.every((result) => result.status === 'rejected')).toBe(true);
    expect(sdk.app).toHaveBeenCalledTimes(1);
    expect(sdk.build).not.toHaveBeenCalled();

    await expect(modal(credentials).sandbox.create()).resolves.toMatchObject({ sandboxId: 'sb-1' });
    expect(sdk.app).toHaveBeenCalledTimes(2);
  });

  it('coalesces failed image builds and lets another provider retry', async () => {
    sdk.build.mockRejectedValueOnce(new Error('temporary image build failure'));
    const failed = await Promise.allSettled(Array.from({ length: 3 }, () => modal(credentials).sandbox.create()));
    expect(failed.every((result) => result.status === 'rejected')).toBe(true);
    expect(sdk.build).toHaveBeenCalledTimes(1);

    await expect(modal(credentials).sandbox.create()).resolves.toMatchObject({ sandboxId: 'sb-1' });
    expect(sdk.build).toHaveBeenCalledTimes(2);
    expect(sdk.app).toHaveBeenCalledTimes(1);
  });

  it('resolves distinct images separately and shares snapshot invalidation', async () => {
    await modal(credentials).sandbox.create();
    await modal(credentials).sandbox.create({ snapshotId: 'im-snapshot' });
    await modal(credentials).sandbox.create({ snapshotId: 'im-snapshot' });
    expect(sdk.build).toHaveBeenCalledTimes(2);
    expect(sdk.image).toHaveBeenCalledTimes(1);

    await modal(credentials).snapshot!.delete('im-snapshot');
    await modal(credentials).sandbox.create({ snapshotId: 'im-snapshot' });
    expect(sdk.deleteImage).toHaveBeenCalledWith('im-snapshot');
    expect(sdk.image).toHaveBeenCalledTimes(2);
  });

  it('does not let an invalidated image failure evict a replacement load', async () => {
    const first = deferred<{ imageId: string }>();
    const replacement = deferred<{ imageId: string }>();
    sdk.build.mockReturnValueOnce(first.promise).mockReturnValueOnce(replacement.promise);
    const failed = modal(credentials).sandbox.create({ snapshotId: 'im-snapshot' }).catch((error: Error) => error);
    await vi.waitFor(() => expect(sdk.build).toHaveBeenCalledTimes(1));
    await modal(credentials).snapshot!.delete('im-snapshot');
    const second = modal(credentials).sandbox.create({ snapshotId: 'im-snapshot' });
    await vi.waitFor(() => expect(sdk.build).toHaveBeenCalledTimes(2));
    first.reject(new Error('old load failed'));
    expect(await failed).toBeInstanceOf(Error);

    const third = modal(credentials).sandbox.create({ snapshotId: 'im-snapshot' });
    replacement.resolve({ imageId: 'im-snapshot' });
    const sandboxes = await Promise.all([second, third]);
    expect(sandboxes[0].sandboxId).not.toBe(sandboxes[1].sandboxId);
    expect(sdk.build).toHaveBeenCalledTimes(2);
  });

  it('bounds configuration retention without invalidating providers still in use', async () => {
    const original = modal(credentials);
    await original.sandbox.create();
    for (let i = 0; i < 32; i++) {
      await modal({ ...credentials, appName: `app-${i}` }).sandbox.create();
    }
    await original.sandbox.create();
    expect(sdk.app).toHaveBeenCalledTimes(33);
    await modal(credentials).sandbox.create();
    expect(sdk.app).toHaveBeenCalledTimes(34);
  });

  it('bounds image retention and resolves an evicted image again', async () => {
    for (let i = 0; i < 129; i++) {
      await modal(credentials).sandbox.create({ snapshotId: `im-${i}` });
    }
    await modal(credentials).sandbox.create({ snapshotId: 'im-0' });
    expect(sdk.build).toHaveBeenCalledTimes(130);
    expect(sdk.app).toHaveBeenCalledTimes(1);
  });
});
