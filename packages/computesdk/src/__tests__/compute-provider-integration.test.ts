import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compute, type DirectProvider } from '../compute';

type SupportedProvider = 'e2b' | 'vercel' | 'daytona' | 'modal' | 'archil';

const runIntegration = process.env.COMPUTESDK_INTEGRATION === '1';
const testProvider = process.env.TEST_PROVIDER as SupportedProvider | undefined;
const describeIntegration = runIntegration ? describe : describe.skip;

function getWorkspaceRoot(): string {
  const cwd = process.cwd();
  const candidates = [
    cwd,
    resolve(cwd, '..'),
    resolve(cwd, '..', '..'),
  ];

  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, 'pnpm-workspace.yaml'))) {
      return candidate;
    }
  }

  return cwd;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function loadProviderFactory(provider: SupportedProvider): Promise<(config: Record<string, string>) => DirectProvider> {
  const workspaceRoot = getWorkspaceRoot();
  const modulePaths: Record<SupportedProvider, string> = {
    // Load built workspace packages directly from dist after the CI build step.
    e2b: resolve(workspaceRoot, 'packages/e2b/dist/index.mjs'),
    vercel: resolve(workspaceRoot, 'packages/vercel/dist/index.mjs'),
    daytona: resolve(workspaceRoot, 'packages/daytona/dist/index.mjs'),
    modal: resolve(workspaceRoot, 'packages/modal/dist/index.mjs'),
    archil: resolve(workspaceRoot, 'packages/archil/dist/index.mjs'),
  };

  const factoryMap: Record<SupportedProvider, string> = {
    e2b: 'e2b',
    vercel: 'vercel',
    daytona: 'daytona',
    modal: 'modal',
    archil: 'archil',
  };

  const moduleUrl = pathToFileURL(modulePaths[provider]).href;
  const mod = await import(moduleUrl);
  const factory = (mod as Record<string, unknown>)[factoryMap[provider]];
  if (typeof factory !== 'function') {
    throw new Error(`Provider factory "${factoryMap[provider]}" not found for ${provider}`);
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
    case 'archil':
      return {
        apiKey: requireEnv('ARCHIL_API_KEY'),
        region: requireEnv('ARCHIL_REGION'),
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
    const sandbox = await sdk.sandbox.create({
      timeout: 120000,
      ...(testProvider === 'archil'
        ? {
            diskId: requireEnv('ARCHIL_DISK_ID'),
          }
        : {}),
    } as any);

    try {
      const result = await sandbox.runCommand('echo computesdk-integration-ok');
      expect(result.stdout).toContain('computesdk-integration-ok');

      const fetched = await sdk.sandbox.getById(sandbox.sandboxId);
      expect(fetched?.sandboxId).toBe(sandbox.sandboxId);

      // Timeout extension is provider-specific in direct mode and is covered by
      // unit/contract tests; keep this integration focused on cross-provider
      // operations that are universally supported.
    } finally {
      await sdk.sandbox.destroy(sandbox.sandboxId);
    }
  }, 180000);
});
