/**
 * Real-provider entrypoint for the EXISTING shared suite, not provider unit
 * files (which may install SDK/fetch mocks). Default collection is inert.
 */
import { describe, afterAll } from 'vitest';
import { pathToFileURL } from 'node:url';
import { runIntegrationTests, type ProviderTestConfig } from '../packages/test-utils/src/provider-test-suite';
import { runProviderCrudTest } from '../packages/test-utils/src/provider-crud-test';
import { loadProfiles, blockedReason, providerModule, sourceFingerprint, reportPath, createResourceJournal } from '../scripts/compute-conformance.mjs';
import { waitForSandboxAbsence, withDeadline } from '../packages/test-utils/src/provider-lifecycle';

interface LiveProfile {
  id: string;
  symbol: string;
  config: Record<string, unknown>;
  configEnvironment: Record<string, string>;
  suite: Omit<ProviderTestConfig, 'provider' | 'name'>;
}

if (process.env.COMPUTESDK_CONFORMANCE_NATIVE !== '1') {
  describe.skip('Compute native conformance requires explicit execution approval', () => {});
} else {
  const profile = (loadProfiles() as LiveProfile[]).find(p => p.id === process.env.COMPUTE_CONFORMANCE_PROVIDER);
  if (!profile || blockedReason(profile, process.env)) throw new Error('Compute native profile is blocked');
  if (process.env.COMPUTE_CONFORMANCE_EXPECTED_SOURCE !== sourceFingerprint().sha256) {
    throw new Error('Compute native source fingerprint mismatch');
  }
  if (!['shared', 'crud'].includes(process.env.COMPUTE_CONFORMANCE_SUITE || 'shared')) throw new Error('Unknown native suite');
  if (process.env.COMPUTE_CONFORMANCE_SUITE === 'crud' && profile.id !== '@computesdk/isorun') {
    throw new Error('Unreviewed CRUD profile');
  }
  const limit = Number(process.env.COMPUTE_CONFORMANCE_MAX_CREATES);
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Missing SDK create-attempt limit');
  const config: Record<string, unknown> = { ...profile.config };
  for (const [key, name] of Object.entries(profile.configEnvironment) as [string, string][]) {
    if (process.env[name]) config[key] = process.env[name];
  }
  const journal = createResourceJournal(reportPath(profile.id).replace(/\.json$/, '.resources.json'),
    profile.id, process.env.COMPUTE_CONFORMANCE_EXPECTED_SOURCE);
  afterAll(() => journal.assertHealthy());
  const module = await import(pathToFileURL(providerModule(profile)).href);
  const factory: unknown = module[profile.symbol];
  if (typeof factory !== 'function') throw new Error('Missing provider factory export');
  const provider = factory(config) as ProviderTestConfig['provider'];
  if (!provider || typeof provider.name !== 'string' || typeof provider.sandbox?.create !== 'function') {
    throw new Error('Invalid provider factory result');
  }
  let attempts = 0;
  const create = provider.sandbox.create.bind(provider.sandbox);
  // Limit SDK requests, NOT native retries, internal builds, VM counts or USD.
  // Do not mutate returned instances or change their destruction semantics.
  const manager = new Proxy(provider.sandbox, {
    get(target, key) {
      if (key === 'create') return (...args: Parameters<typeof create>) => {
        const number = ++attempts;
        if (number > limit) throw new Error('SDK create-attempt limit reached');
        journal.requested(number);
        try {
          return Promise.resolve(create(...args)).then(
            sandbox => journal.returned(number, sandbox),
            error => { journal.rejected(number); throw error; },
          );
        } catch (error) { journal.rejected(number); throw error; }
      };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const selected = new Proxy(provider, {
    get(target, key) {
      return key === 'sandbox' || key === 'instances' ? manager : Reflect.get(target, key, target);
    },
  });
  if (process.env.COMPUTE_CONFORMANCE_SUITE === 'crud') {
    describe(`${provider.name} [native] CRUD`, () => {
      runProviderCrudTest({ provider: selected, name: provider.name, enabled: true, timeout: 120000 });
    });
  } else {
    runIntegrationTests({
      ...profile.suite, provider: selected, name: provider.name,
      verifySandbox: async sandbox => {
        const found = await withDeadline(() => selected.sandbox.getById(sandbox.sandboxId),
          8000, 'SDK presence lookup failed or timed out');
        if (found?.sandboxId !== sandbox.sandboxId) throw new Error('SDK presence lookup did not return the owned ID');
      },
      verifyCleanup: async sandbox => {
        await waitForSandboxAbsence(() => selected.sandbox.getById(sandbox.sandboxId), {
          timeoutMs: 8000, pollIntervalMs: 250,
          failureMessage: 'SDK-reported absence was not verified for the owned ID',
        });
        journal.absent(sandbox.sandboxId);
      },
    });
  }
}
