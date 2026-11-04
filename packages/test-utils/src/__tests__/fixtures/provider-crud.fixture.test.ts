import { afterAll, describe, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { runProviderCrudTest } from '../../provider-crud-test';

// Only the subprocess unit test opts in. This fixture NEVER imports a provider
// implementation or vendor SDK, regardless of credentials in the environment.
if (process.env.CRUD_UNIT_FIXTURE !== '1') {
  describe.skip('CRUD subprocess fixture (fake provider only)', () => {
    it('requires explicit unit-fixture opt-in', () => {});
  });
} else {
  const scenario = process.env.CRUD_UNIT_SCENARIO;
  if (scenario === 'large-create-budget') vi.useFakeTimers();
  const calls = {
    create: 0, destroy: [] as string[], get: 0, list: 0, afterDestroy: 0,
    ...(scenario === 'concurrent-order' ? { order: [] as string[] } : {}),
  };
  const recordCalls = () => {
    writeFileSync(process.env.CRUD_UNIT_OBSERVATIONS!, JSON.stringify(calls));
  };
  // Collection failures never run afterAll, so record every fake-provider call
  // eagerly to prove that strict preflight failures happen before provisioning.
  recordCalls();
  const id = 'owned-unit-sandbox';
  let destroyed = false;
  const provider = {
    sandbox: {
      create: async () => {
        calls.order?.push('create');
        calls.create++;
        recordCalls();
        if (scenario === 'large-create-budget') {
          const allocation = new Promise<{ sandboxId: string }>((resolve) => {
            setTimeout(() => resolve({ sandboxId: id }), 20_000);
          });
          // Exercise a 20-second allocation against the actual suite budget
          // without waiting 20 real seconds or importing a native provider.
          void vi.advanceTimersByTimeAsync(20_000);
          return allocation;
        }
        if (scenario === 'late-create' || scenario === 'late-after-cleanup') {
          await new Promise((resolve) => setTimeout(resolve, scenario === 'late-create' ? 60 : 150));
          return { sandboxId: 'late-owned-unit-sandbox' };
        }
        if (scenario === 'never-create') return new Promise<never>(() => {});
        if (scenario === 'create-assertion') {
          let reads = 0;
          return {
            get sandboxId() {
              if (++reads > 1) throw new Error('ORIGINAL_CREATE_ASSERTION');
              return id;
            },
          };
        }
        return { sandboxId: id };
      },
      getById: async () => {
        calls.order?.push(destroyed ? 'verify' : 'get');
        calls.get++;
        if (!destroyed) {
          recordCalls();
          return { sandboxId: id };
        }
        calls.afterDestroy++;
        recordCalls();
        if (scenario === 'hang') return new Promise<never>(() => {});
        if (scenario === 'eventual' && calls.afterDestroy > 2) return null;
        if (['create-assertion', 'late-create', 'late-after-cleanup', 'large-create-budget', 'concurrent-order'].includes(scenario!)) return null;
        if (scenario === 'explicit-enable' || scenario === 'strict-explicit-enable') return null;
        return { sandboxId: id, status: 'running' };
      },
      list: async () => {
        calls.order?.push('list');
        calls.list++;
        recordCalls();
        if (scenario === 'original-failure') throw new Error('ORIGINAL_LIST_FAILURE');
        return [{ sandboxId: id }];
      },
      destroy: async (sandboxId: string) => {
        calls.order?.push('destroy');
        calls.destroy.push(sandboxId);
        recordCalls();
        destroyed = true;
        if (scenario === 'secret') throw new Error('NATIVE_SECRET_do_not_print');
      },
    },
  };

  const registerCrud = () => runProviderCrudTest({
    name: ['unsupported', 'explicit-enable', 'strict-unsupported', 'strict-explicit-enable'].includes(scenario!)
      ? 'e2b' : 'railway',
    provider: provider as any,
    skipIntegration: ['skip', 'strict-skip', 'strict-skip-enabled'].includes(scenario!),
    enabled: ['explicit-enable', 'strict-explicit-enable', 'strict-skip-enabled'].includes(scenario!)
      ? true : ['disabled', 'strict-disabled'].includes(scenario!) ? false : undefined,
    timeout: ['late-create', 'late-after-cleanup', 'never-create'].includes(scenario!) ? 80
      : scenario === 'short-test-budget' ? 100 : scenario === 'large-create-budget' ? 120_000 : 20_000,
    verificationTimeout: scenario === 'short-test-budget' ? 20_000 : 40,
    verificationPollInterval: 5,
  } as any);
  if (scenario === 'concurrent-order') {
    // Exercise inheritance from a nested parent under global concurrent mode.
    describe('outer fake-provider suite', registerCrud);
  } else {
    registerCrud();
  }

  // Keep the fixture file active even when the CRUD suite is entirely skipped,
  // so its observation hook runs and proves there were no provider calls.
  it('collects a unit-only fake-provider fixture', async () => {
    if (scenario === 'late-after-cleanup') {
      // Keep this unit worker alive past the CRUD hook's unresolved-allocation
      // failure. A deadline does not cancel creation; its observer must remain.
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  });

  afterAll(() => {
    recordCalls();
    if (scenario === 'large-create-budget') vi.useRealTimers();
  });
}
