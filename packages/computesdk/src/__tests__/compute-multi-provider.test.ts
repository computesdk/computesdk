import { describe, it, expect, vi } from 'vitest';
import { compute, type DirectProvider } from '../compute';

function makeSandbox(id: string, provider: string) {
  return {
    sandboxId: id,
    provider,
    filesystem: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      mkdir: vi.fn(),
      readdir: vi.fn(),
      exists: vi.fn(),
      remove: vi.fn(),
    },
    runCode: vi.fn(),
    runCommand: vi.fn(),
    getInfo: vi.fn(),
    getUrl: vi.fn(),
    getProvider: vi.fn(),
    getInstance: vi.fn(),
    destroy: vi.fn(),
  } as any;
}

function makeProvider(
  name: string,
  handlers: Partial<DirectProvider['sandbox']> = {},
  snapshotHandlers?: Partial<NonNullable<DirectProvider['snapshot']>>
): DirectProvider {
  return {
    name,
    sandbox: {
      create: handlers.create || (async () => makeSandbox(`${name}-sandbox`, name)),
      getById: handlers.getById || (async () => null),
      destroy: handlers.destroy || (async () => {}),
      list: handlers.list,
      find: handlers.find,
      findOrCreate: handlers.findOrCreate,
      extendTimeout: handlers.extendTimeout,
    },
    snapshot: snapshotHandlers
      ? {
          create:
            snapshotHandlers.create ||
            (async (sandboxId: string) => ({
              id: `${name}-snapshot-${sandboxId}`,
              provider: name,
              createdAt: new Date().toISOString(),
            })),
          list: snapshotHandlers.list || (async () => []),
          delete: snapshotHandlers.delete || (async () => {}),
        }
      : undefined,
  };
}

describe('compute multi-provider', () => {
  it('falls back to next provider on create failure', async () => {
    const failing = makeProvider('e2b', {
      create: async () => {
        throw new Error('e2b unavailable');
      },
    });
    const modal = makeProvider('modal', {
      create: async () => makeSandbox('modal-1', 'modal'),
    });

    const sdk = compute({ providers: [failing, modal] });
    const sandbox = await sdk.sandbox.create();

    expect(sandbox.sandboxId).toBe('modal-1');
    expect(sandbox.provider).toBe('modal');
  });

  it('supports round-robin provider selection', async () => {
    const e2b = makeProvider('e2b', {
      create: async () => makeSandbox('e2b-sbx', 'e2b'),
    });
    const modal = makeProvider('modal', {
      create: async () => makeSandbox('modal-sbx', 'modal'),
    });

    const sdk = compute({
      providers: [e2b, modal],
      providerStrategy: 'round-robin',
    });

    const first = await sdk.sandbox.create();
    const second = await sdk.sandbox.create();
    const third = await sdk.sandbox.create();

    expect(first.provider).toBe('e2b');
    expect(second.provider).toBe('modal');
    expect(third.provider).toBe('e2b');
  });

  it('uses provider override for targeted create', async () => {
    const e2b = makeProvider('e2b', {
      create: async () => makeSandbox('e2b-sbx', 'e2b'),
    });
    const modal = makeProvider('modal', {
      create: async () => makeSandbox('modal-sbx', 'modal'),
    });

    const sdk = compute({ providers: [e2b, modal] });
    const sandbox = await sdk.sandbox.create({ provider: 'modal' });

    expect(sandbox.provider).toBe('modal');
  });

  it('aggregates list() across providers that support it', async () => {
    const e2b = makeProvider('e2b', {
      list: async () => [makeSandbox('e2b-1', 'e2b')],
    });
    const modal = makeProvider('modal', {
      list: async () => [makeSandbox('modal-1', 'modal')],
    });

    const sdk = compute({ providers: [e2b, modal] });
    const sandboxes = await sdk.sandbox.list();

    expect(sandboxes.map((s: any) => s.sandboxId).sort()).toEqual(['e2b-1', 'modal-1']);
  });

  it('supports both provider and providers with provider as primary', async () => {
    const modal = makeProvider('modal', {
      create: async () => makeSandbox('modal-sbx', 'modal'),
    });
    const e2b = makeProvider('e2b', {
      create: async () => makeSandbox('e2b-sbx', 'e2b'),
    });

    const sdk = compute({
      provider: modal,
      providers: [e2b],
      providerStrategy: 'priority',
    });

    const sandbox = await sdk.sandbox.create();
    expect(sandbox.provider).toBe('modal');
  });

  it('dedupes providers by name when both provider and providers include same provider', async () => {
    const createSpy = vi.fn(async () => makeSandbox('e2b-sbx', 'e2b'));
    const e2bPrimary = makeProvider('e2b', { create: createSpy });
    const e2bDuplicate = makeProvider('e2b', { create: createSpy });

    const sdk = compute({
      provider: e2bPrimary,
      providers: [e2bDuplicate],
      fallbackOnError: false,
    });

    await sdk.sandbox.create();
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('throws when configured without provider or providers', () => {
    expect(() => compute({} as any)).toThrow(/No provider instance configured/);
  });

  it('fails fast when fallbackOnError is false', async () => {
    const first = makeProvider('e2b', {
      create: async () => {
        throw new Error('first failed');
      },
    });
    const secondCreate = vi.fn(async () => makeSandbox('modal-1', 'modal'));
    const second = makeProvider('modal', { create: secondCreate });

    const sdk = compute({ providers: [first, second], fallbackOnError: false });

    await expect(sdk.sandbox.create()).rejects.toThrow('first failed');
    expect(secondCreate).not.toHaveBeenCalled();
  });

  it('falls through when first provider does not support findOrCreate', async () => {
    const first = makeProvider('e2b');
    const second = makeProvider('modal', {
      findOrCreate: async () => makeSandbox('modal-foc', 'modal'),
    });

    const sdk = compute({ providers: [first, second] });
    const sandbox = await sdk.sandbox.findOrCreate({ name: 'my-sandbox' });

    expect(sandbox.provider).toBe('modal');
  });

  it('uses sandbox provider affinity for destroy', async () => {
    const firstDestroy = vi.fn(async () => {});
    const secondDestroy = vi.fn(async () => {});

    const first = makeProvider('e2b', {
      create: async () => {
        throw new Error('e2b unavailable');
      },
      destroy: firstDestroy,
    });

    const second = makeProvider('modal', {
      create: async () => makeSandbox('modal-affinity', 'modal'),
      destroy: secondDestroy,
    });

    const sdk = compute({ providers: [first, second] });
    const sandbox = await sdk.sandbox.create();
    await sdk.sandbox.destroy(sandbox.sandboxId);

    expect(secondDestroy).toHaveBeenCalledWith('modal-affinity');
    expect(firstDestroy).not.toHaveBeenCalled();
  });

  it('uses sandbox provider affinity for extendTimeout', async () => {
    const firstExtend = vi.fn(async () => {});
    const secondExtend = vi.fn(async () => {});

    const first = makeProvider('e2b', {
      create: async () => {
        throw new Error('e2b unavailable');
      },
      extendTimeout: firstExtend,
    });

    const second = makeProvider('modal', {
      create: async () => makeSandbox('modal-timeout', 'modal'),
      extendTimeout: secondExtend,
    });

    const sdk = compute({ providers: [first, second] });
    const sandbox = await sdk.sandbox.create();
    await sdk.sandbox.extendTimeout(sandbox.sandboxId, { duration: 30000 });

    expect(secondExtend).toHaveBeenCalledWith('modal-timeout', { duration: 30000 });
    expect(firstExtend).not.toHaveBeenCalled();
  });

  it('routes snapshot create and delete to sandbox-affine provider', async () => {
    const e2bSnapshotDelete = vi.fn(async () => {});
    const modalSnapshotCreate = vi.fn(async () => ({
      id: 'modal-snap-1',
      provider: 'modal',
      createdAt: new Date().toISOString(),
    }));
    const modalSnapshotDelete = vi.fn(async () => {});

    const e2b = makeProvider(
      'e2b',
      {
        create: async () => {
          throw new Error('e2b unavailable');
        },
      },
      {
        delete: e2bSnapshotDelete,
      }
    );

    const modal = makeProvider(
      'modal',
      {
        create: async () => makeSandbox('modal-with-snapshot', 'modal'),
      },
      {
        create: modalSnapshotCreate,
        delete: modalSnapshotDelete,
      }
    );

    const sdk = compute({ providers: [e2b, modal] });
    const sandbox = await sdk.sandbox.create();
    const snapshot = await sdk.snapshot.create(sandbox.sandboxId);
    await sdk.snapshot.delete(snapshot.id);

    expect(modalSnapshotCreate).toHaveBeenCalledWith('modal-with-snapshot', {});
    expect(modalSnapshotDelete).toHaveBeenCalledWith('modal-snap-1');
    expect(e2bSnapshotDelete).not.toHaveBeenCalled();
  });

  it('throws clear error for provider override that is not configured', async () => {
    const e2b = makeProvider('e2b');
    const sdk = compute({ provider: e2b });

    await expect(sdk.sandbox.create({ provider: 'modal' })).rejects.toThrow(/is not configured/);
  });

  it('creates snapshots using snapshot-capable providers without mutating round-robin create order', async () => {
    const e2bCreate = vi.fn(async () => makeSandbox('e2b-sbx', 'e2b'));
    const e2b = makeProvider('e2b', { create: e2bCreate });

    const modalSnapshotCreate = vi.fn(async () => ({
      id: 'modal-snap',
      provider: 'modal',
      createdAt: new Date().toISOString(),
    }));
    const modal = makeProvider('modal', {}, { create: modalSnapshotCreate });

    const sdk = compute({
      providers: [e2b, modal],
      providerStrategy: 'round-robin',
    });

    const snapshot = await sdk.snapshot.create('unknown-sandbox-id');
    expect(snapshot.id).toBe('modal-snap');
    expect(modalSnapshotCreate).toHaveBeenCalledWith('unknown-sandbox-id', {});

    const sandbox = await sdk.sandbox.create();
    expect(sandbox.provider).toBe('e2b');
    expect(e2bCreate).toHaveBeenCalledTimes(1);
  });
});
