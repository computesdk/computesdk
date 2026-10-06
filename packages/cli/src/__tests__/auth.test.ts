import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ActionsCliError, resolveActionsAuth } from '../actions-client.js';

// The legacy gateway login (browser flow to console.computesdk.com +
// ~/.computesdk/credentials.json) was removed in @computesdk/cli@2 — auth for
// Actions/Market/Sandboxes/Bench resolves through @benchsdk/cli's store only.
describe('resolveActionsAuth never starts a login', () => {
  const ACTIONS_ENV = [
    'COMPUTE_API_KEY',
    'BENCHMARKS_PLATFORM_API_KEY',
    'COMPUTE_PLATFORM_URL',
    'BENCHMARKS_PLATFORM_URL',
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ACTIONS_ENV) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ACTIONS_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('reports no_credentials with a `compute login` hint when the store is empty', async () => {
    const noPlatformCreds = async () => ({});
    let err: unknown;
    try {
      await resolveActionsAuth({}, noPlatformCreds);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ActionsCliError);
    expect((err as ActionsCliError).code).toBe('no_credentials');
    expect((err as Error).message).toContain('compute login');
  });
});
