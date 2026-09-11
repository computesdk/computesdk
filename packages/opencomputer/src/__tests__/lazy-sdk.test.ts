import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('@opencomputer/sdk');
  vi.resetModules();
});

it('loads the SDK only on provider use and shares initialization across concurrent creates', async () => {
  vi.resetModules();
  let initialized = 0;
  const create = vi.fn().mockResolvedValue({ sandboxId: 'sb_lazy' });
  vi.doMock('@opencomputer/sdk', () => {
    initialized++;
    return { Sandbox: { create } };
  });

  const { opencomputer } = await import('../index');
  await vi.dynamicImportSettled();
  expect(initialized).toBe(0);

  const provider = opencomputer({ apiKey: 'test-key' });
  expect(initialized).toBe(0);
  const sandboxes = await Promise.all([
    provider.sandbox.create(),
    provider.sandbox.create(),
  ]);

  expect(initialized).toBe(1);
  expect(create).toHaveBeenCalledTimes(2);
  expect(sandboxes.map(sandbox => sandbox.sandboxId)).toEqual(['sb_lazy', 'sb_lazy']);
});

it('returns an SDK import failure to each concurrent caller', async () => {
  vi.resetModules();
  let initialized = 0;
  vi.doMock('@opencomputer/sdk', () => {
    initialized++;
    throw new Error('SDK load failed');
  });

  const { opencomputer } = await import('../index');
  const provider = opencomputer({ apiKey: 'test-key' });
  const outcomes = await Promise.allSettled([
    provider.sandbox.create(),
    provider.sandbox.create(),
  ]);

  expect(initialized).toBe(1);
  for (const outcome of outcomes) {
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.reason.cause?.message).toBe('SDK load failed');
    }
  }
});
