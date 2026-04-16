import { describe, it, expect } from 'vitest';
import { compute, type DirectProvider } from '../compute';

type SupportedProvider = 'e2b' | 'vercel' | 'daytona' | 'modal';

const runIntegration = process.env.COMPUTESDK_INTEGRATION === '1';
const testProvider = process.env.TEST_PROVIDER as SupportedProvider | undefined;
const describeIntegration = runIntegration ? describe : describe.skip;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function loadProviderFactory(provider: SupportedProvider): Promise<(config: Record<string, string>) => DirectProvider> {
  const moduleMap: Record<SupportedProvider, string> = {
    e2b: '@computesdk/e2b',
    vercel: '@computesdk/vercel',
    daytona: '@computesdk/daytona',
    modal: '@computesdk/modal',
  };

  const factoryMap: Record<SupportedProvider, string> = {
    e2b: 'e2b',
    vercel: 'vercel',
    daytona: 'daytona',
    modal: 'modal',
  };

  const mod = await import(moduleMap[provider]);
  const factory = (mod as Record<string, unknown>)[factoryMap[provider]];
  if (typeof factory !== 'function') {
    throw new Error(`Provider factory "${factoryMap[provider]}" not found in ${moduleMap[provider]}`);
  }

  return factory as (config: Record<string, string>) => DirectProvider;
}

function getProviderConfig(provider: SupportedProvider): Record<string, string> {
  switch (provider) {
    case 'e2b':
      return {
        apiKey: requireEnv('E2B_API_KEY'),
      };
    case 'vercel':
      return {
        token: requireEnv('VERCEL_TOKEN'),
        teamId: requireEnv('VERCEL_TEAM_ID'),
        projectId: requireEnv('VERCEL_PROJECT_ID'),
      };
    case 'daytona':
      return {
        apiKey: requireEnv('DAYTONA_API_KEY'),
      };
    case 'modal':
      return {
        tokenId: requireEnv('MODAL_TOKEN_ID'),
        tokenSecret: requireEnv('MODAL_TOKEN_SECRET'),
      };
    default:
      throw new Error(`Unsupported TEST_PROVIDER: ${String(provider)}`);
  }
}

describeIntegration('compute provider integration', () => {
  it('creates, executes, and destroys a sandbox through compute', async () => {
    if (!testProvider) {
      throw new Error('TEST_PROVIDER must be set when COMPUTESDK_INTEGRATION=1');
    }

    const providerFactory = await loadProviderFactory(testProvider);
    const provider = providerFactory(getProviderConfig(testProvider));

    const sdk = compute({ provider });
    const sandbox = await sdk.sandbox.create({ timeout: 120000 });

    try {
      const result = await sandbox.runCode('print("computesdk-integration-ok")', 'python');
      expect(result.output).toContain('computesdk-integration-ok');

      const fetched = await sdk.sandbox.getById(sandbox.sandboxId);
      expect(fetched?.sandboxId).toBe(sandbox.sandboxId);

      await sdk.sandbox.extendTimeout(sandbox.sandboxId, { duration: 120000 });
    } finally {
      await sdk.sandbox.destroy(sandbox.sandboxId);
    }
  }, 180000);
});
