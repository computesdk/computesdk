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
    },
    snapshot: snapshotHandlers
      ? {
          listScope: snapshotHandlers.listScope,
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

  it('passes AbortSignal through to provider sandbox.create', async () => {
    const createSpy = vi.fn(async (options?: any) => {
      if (options?.signal?.aborted) {
        const err = new Error('The operation was aborted.') as any;
        err.name = 'AbortError';
        throw err;
      }
      return makeSandbox('e2b-signal', 'e2b');
    });
    const e2b = makeProvider('e2b', { create: createSpy });
    const sdk = compute({ provider: e2b });

    const controller = new AbortController();
    controller.abort();

    await expect(sdk.sandbox.create({ signal: controller.signal })).rejects.toThrow('The operation was aborted.');
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
  });

  it('rethrows AbortError immediately instead of falling back to next provider', async () => {
    const e2bCreate = vi.fn(async () => {
      const err = new Error('The operation was aborted.') as any;
      err.name = 'AbortError';
      throw err;
    });
    const e2b = makeProvider('e2b', { create: e2bCreate });
    const modalCreate = vi.fn(async () => makeSandbox('modal-sbx', 'modal'));
    const modal = makeProvider('modal', { create: modalCreate });

    const sdk = compute({ providers: [e2b, modal] });
    await expect(sdk.sandbox.create()).rejects.toThrow('The operation was aborted.');
    expect(modalCreate).not.toHaveBeenCalled();
  });

  it('rethrows an error with fallback === false instead of trying the next provider', async () => {
    // The platform provider marks create_outcome_unknown errors this way:
    // a box may exist and be billing, so booting a second one is unsafe.
    const unknownOutcome = new Error('Sandbox create outcome unknown after 6 minutes');
    (unknownOutcome as { fallback?: boolean }).fallback = false;
    const platformCreate = vi.fn(async () => {
      throw unknownOutcome;
    });
    const platformProvider = makeProvider('platform', { create: platformCreate });
    const modalCreate = vi.fn(async () => makeSandbox('modal-sbx', 'modal'));
    const modal = makeProvider('modal', { create: modalCreate });

    const sdk = compute({ providers: [platformProvider, modal] });
    await expect(sdk.sandbox.create()).rejects.toBe(unknownOutcome);
    expect(modalCreate).not.toHaveBeenCalled();
  });

  it('keeps the original errors on .errors when every provider fails', async () => {
    const firstError = new Error('e2b unavailable');
    const secondError = new Error('modal unavailable');
    const e2b = makeProvider('e2b', {
      create: async () => {
        throw firstError;
      },
    });
    const modal = makeProvider('modal', {
      create: async () => {
        throw secondError;
      },
    });

    const sdk = compute({ providers: [e2b, modal] });
    const err = await sdk.sandbox.create().then(
      () => {
        throw new Error('expected create to fail');
      },
      (e: unknown) => e as Error & { errors?: unknown[] },
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AggregateError');
    expect(err.errors).toEqual([firstError, secondError]);
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

  it('forwards scoped snapshot listing and does not turn unsupported inventory into empty results', async () => {
    const list = vi.fn().mockResolvedValue([]);
    const provider = makeProvider('scoped', {}, { list, listScope: 'instance' });
    const sdk = compute({ provider });
    const options = { instanceId: 'source', limit: 3 };
    await expect(sdk.snapshot.list(options)).resolves.toEqual([]);
    expect(list).toHaveBeenCalledWith(options);
    const unsupported = Object.assign(new Error('snapshot.list is unsupported'), { code: 'unsupported' });
    list.mockRejectedValueOnce(unsupported);
    await expect(sdk.snapshot.list()).rejects.toBe(unsupported);
  });

  it('continues past unsupported deletion when the snapshot owner is unknown', async () => {
    const unsupported = makeProvider('unsupported', {}, {
      delete: async () => { throw new Error('snapshot.delete is unsupported'); },
    });
    const remove = vi.fn().mockResolvedValue(undefined);
    const sdk = compute({ providers: [unsupported, makeProvider('owner', {}, { delete: remove })] });
    await sdk.snapshot.delete('unknown-snapshot');
    expect(remove).toHaveBeenCalledWith('unknown-snapshot');
  });

  it('lists scoped snapshots only through the known instance owner', async () => {
    const unrelated = vi.fn().mockResolvedValue([{ id: 'unrelated', provider: 'other', createdAt: new Date() }]);
    const expected = { id: 'owned', provider: 'owner', createdAt: new Date() };
    const scoped = vi.fn().mockResolvedValue([expected]);
    const sdk = compute({ providers: [
      makeProvider('other', {}, { list: unrelated }),
      makeProvider('owner', {}, { list: scoped, listScope: 'instance' }),
    ] });
    await sdk.instances.create({ provider: 'owner' });
    await expect(sdk.snapshot.list({ instanceId: 'owner-sandbox' })).resolves.toEqual([expected]);
    expect(scoped).toHaveBeenCalledWith({ instanceId: 'owner-sandbox' });
    expect(unrelated).not.toHaveBeenCalled();
  });

  it('rejects ambiguous scoped inventory before querying unrelated providers', async () => {
    const list = vi.fn().mockResolvedValue([]);
    const sdk = compute({ providers: [
      makeProvider('one', {}, { list }),
      makeProvider('two', {}, { list }),
    ] });
    await expect(sdk.snapshot.list({ instanceId: 'unknown' })).rejects.toThrow('known instance owner');
    expect(list).not.toHaveBeenCalled();
  });

  it('filters provider-wide inventories by authoritative source IDs', async () => {
    const canonical = { id: 'canonical', instanceId: 'source', provider: 'one', createdAt: new Date() };
    const legacy = { id: 'legacy', sandboxId: 'source', provider: 'one', createdAt: new Date() };
    const unrelated = { id: 'unrelated', instanceId: 'other', provider: 'one', createdAt: new Date() };
    const sdk = compute({ provider: makeProvider('one', {}, {
      list: async () => [canonical, unrelated, legacy],
    }) });
    await expect(sdk.snapshot.list({ sandboxId: 'source' })).resolves.toEqual([canonical, legacy]);
    await expect(sdk.snapshot.list({ instanceId: 'other', sandboxId: 'source' })).resolves.toEqual([unrelated]);
  });

  it('rejects scoped inventory that cannot identify snapshot sources', async () => {
    const sdk = compute({ provider: makeProvider('one', {}, {
      list: async () => [{ id: 'unattributed', provider: 'one', createdAt: new Date() }],
    }) });
    await expect(sdk.snapshot.list({ instanceId: 'source' })).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('does not return empty scoped inventory for an owner without snapshots', async () => {
    const sdk = compute({ provider: makeProvider('one') });
    await sdk.instances.create();
    await expect(sdk.snapshot.list({ instanceId: 'one-sandbox' })).rejects.toMatchObject({ code: 'unsupported' });
    await expect(sdk.snapshot.list({ instanceId: '' })).rejects.toThrow('non-empty instanceId');
  });

  it('preserves unsupported errors when deleting an external snapshot through one provider', async () => {
    const failure = Object.assign(new Error('snapshot.delete is unsupported'), { code: 'unsupported' });
    const provider = makeProvider('unsupported', {}, { delete: async () => { throw failure; } });
    await expect(compute({ provider }).snapshot.delete('external-snapshot')).rejects.toBe(failure);
  });

  it('preserves a known snapshot owner failure instead of claiming success through another provider', async () => {
    const failure = Object.assign(new Error('snapshot.delete is unsupported'), { code: 'unsupported' });
    const removeOwner = vi.fn().mockRejectedValue(failure);
    const removeOther = vi.fn().mockResolvedValue(undefined);
    const sdk = compute({ providers: [
      makeProvider('owner', {}, { delete: removeOwner }),
      makeProvider('other', {}, { delete: removeOther }),
    ] });
    const snapshot = await sdk.snapshot.create('source', { provider: 'owner' });
    await expect(sdk.snapshot.delete(snapshot.id)).rejects.toBe(failure);
    await expect(sdk.snapshot.delete(snapshot.id)).rejects.toBe(failure);
    expect(removeOwner).toHaveBeenCalledTimes(2);
    expect(removeOther).not.toHaveBeenCalled();
  });
});
