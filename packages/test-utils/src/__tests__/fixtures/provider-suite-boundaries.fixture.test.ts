import { afterAll, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { defineProviderTests, runIntegrationTests, runUnitTests } from '../../provider-test-suite';
import type { Provider, ProviderInstance } from '@computesdk/provider';

// Opt-in only: this fixture never invokes a real adapter or vendor API.
if (process.env.PROVIDER_SUITE_BOUNDARIES_FIXTURE !== '1') {
  it.skip('provider suite boundaries child fixture (opt-in injected fakes only)', () => {});
} else {
  const scenario = process.env.PROVIDER_SUITE_BOUNDARIES_SCENARIO;
  const observations: {
    create: string[]; destroy: string[]; background: string[]; unrelated: number;
    verified: string[]; cleanupVerified: string[]; commands: string[]; info: string[];
  } = {
    create: [], destroy: [], background: [], unrelated: 0,
    verified: [], cleanupVerified: [], commands: [], info: [],
  };
  const save = () => writeFileSync(process.env.PROVIDER_SUITE_BOUNDARIES_OBSERVATIONS!, JSON.stringify(observations));
  save();
  afterAll(save);
  const provider = (name: string) => ({
    sandbox: {
      create: async () => {
        const id = `${name}-${observations.create.length + 1}`;
        observations.create.push(id);
        save();
        if (scenario === 'create-rejection' && observations.create.length === 2) throw new Error('create failed');
        return {
          sandboxId: id,
          provider: name,
          runCommand: async (command: string, options?: { background?: boolean }) => {
            observations.commands.push(id);
            if (options?.background) observations.background.push(id);
            let stdout = '';
            if (command.includes('Hello from command')) stdout = 'Hello from command\n';
            if (command.includes('hello world')) stdout = 'hello world\n';
            if (command.includes('$HOME')) stdout = '/home/fake\n';
            if (command.includes('test content')) stdout = 'test content\n';
            return {
              stdout, stderr: '', durationMs: 1,
              exitCode: command === 'nonexistent-command-12345'
                ? (scenario === 'undefined-exit' ? undefined : 127) : 0,
            };
          },
          getInfo: async () => {
            observations.info.push(id);
            return { id, provider: name, status: 'running' };
          },
          destroy: async () => {
            observations.destroy.push(id);
            save();
            if (scenario === 'cleanup-failure') throw new Error('native-secret-do-not-print');
          },
        } as unknown as ProviderInstance;
      },
    },
  }) as unknown as Provider;
  const config = (name: string) => ({
    provider: provider(name), name, supportsGetUrl: false,
    supportsBackground: scenario === 'background-default' ? undefined : false,
    ...(['presence-failure', 'verification-success', 'cleanup-verification-failure', 'framework-verification'].includes(scenario!) ? {
      verifySandbox: async (sandbox: ProviderInstance) => {
        observations.verified.push(sandbox.sandboxId);
        save();
        // A fake SDK lookup returning the wrong identity must fail setup.
        const lookup = { sandboxId: scenario === 'presence-failure' ? 'wrong-owned-id' : sandbox.sandboxId };
        if (lookup.sandboxId !== sandbox.sandboxId || scenario === 'framework-verification') {
          throw new Error('native-secret-presence-verification');
        }
      },
      verifyCleanup: async (sandbox: ProviderInstance) => {
        observations.cleanupVerified.push(sandbox.sandboxId);
        save();
        expect(observations.destroy).toContain(sandbox.sandboxId);
        if (scenario === 'cleanup-verification-failure' || scenario === 'framework-verification') {
          throw new Error('native-secret-cleanup-verification');
        }
      },
    } : {}),
  });
  describe('caller scope', () => {
    if (scenario === 'skip' || scenario === 'strict-skip') {
      defineProviderTests({ ...config('alpha'), skipIntegration: true })();
    } else if (scenario === 'framework' || scenario === 'strict-framework' || scenario === 'framework-verification') {
      runUnitTests(config('alpha'));
    } else if (scenario === 'native-helper') {
      runIntegrationTests({ ...config('alpha'), skipIntegration: true, executionMode: 'framework-mocked' });
    } else {
      defineProviderTests(config('alpha'))();
      if (scenario === 'isolation' || scenario === 'isolation-concurrent') defineProviderTests(config('beta'))();
    }
    it('unrelated caller test has no sandbox hooks', () => {
      observations.unrelated += 1;
      // With global concurrency this sibling may run before either suite ends.
      // The parent checks final allocation counts to prove it acquired no hooks.
      if (scenario !== 'isolation-concurrent') {
        expect(observations.create.length).toBe(observations.destroy.length + (scenario === 'create-rejection' ? 1 : 0));
      }
    });
  });
}
