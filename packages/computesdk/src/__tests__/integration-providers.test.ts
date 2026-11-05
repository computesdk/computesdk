import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getProviderConfig,
  getProviderModuleUrl,
  getProviderSandboxOptions,
  getWorkspaceRoot,
  integrationProviders,
  loadProviderFactory,
} from './integration-providers';

function requiredEnvironment(provider: string): Record<string, string> {
  return Object.fromEntries(
    integrationProviders[provider].requiredEnv.map((name) => [name, `test-${name}`]),
  );
}

describe('shared integration provider wiring (no cloud credentials required)', () => {
  it('covers the 33 active Dax workflow providers plus the dedicated platform suite', () => {
    expect(Object.keys(integrationProviders)).toHaveLength(34);
    expect(integrationProviders).toHaveProperty('platform');
  });

  it('finds the workspace from both root and package test directories', () => {
    const root = getWorkspaceRoot();
    expect(getWorkspaceRoot(resolve(root, 'packages/computesdk/src/__tests__'))).toBe(root);
  });

  it.each(Object.keys(integrationProviders))('%s maps credentials, options and built package exports', async (provider) => {
    const definition = integrationProviders[provider];
    const env = requiredEnvironment(provider);
    const config = getProviderConfig(provider, env);
    const options = getProviderSandboxOptions(provider, env);
    for (const [property, name] of Object.entries(definition.config)) {
      if (env[name]) expect(config[property]).toBe(env[name]);
      else expect(config).not.toHaveProperty(property);
    }
    expect(config).toMatchObject(definition.factoryOptions ?? {});
    expect(options).toMatchObject({ timeout: 120000, ...definition.sandboxOptions });
    for (const [property, name] of Object.entries(definition.sandboxEnv ?? {})) {
      expect(options[property]).toBe(env[name]);
    }

    const packageRoot = resolve(getWorkspaceRoot(), 'packages', definition.directory);
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
    expect(manifest.name).toBe(definition.package);
    const exportedImports = Object.values(manifest.exports).flatMap((entry: any) =>
      typeof entry?.import === 'string' ? [entry.import] : [],
    );
    expect(exportedImports).toContain(`./dist/${definition.entry ?? 'index.mjs'}`);

    const factory = vi.fn();
    const importer = vi.fn().mockResolvedValue({ [definition.factory]: factory });
    expect(await loadProviderFactory(provider, getWorkspaceRoot(), importer)).toBe(factory);
    expect(importer).toHaveBeenCalledWith(getProviderModuleUrl(provider));
  });

  it.each(Object.keys(integrationProviders))('%s rejects every absent required credential', (provider) => {
    for (const name of integrationProviders[provider].requiredEnv) {
      const env = requiredEnvironment(provider);
      delete env[name];
      expect(() => getProviderConfig(provider, env)).toThrow(`Missing required environment variable: ${name}`);
    }
  });

  it('uses optional factory values only when present', () => {
    const env = requiredEnvironment('beam');
    expect(getProviderConfig('beam', env)).not.toHaveProperty('gatewayUrl');
    expect(getProviderConfig('beam', { ...env, BEAM_GATEWAY_URL: 'https://beam.example.test' }))
      .toHaveProperty('gatewayUrl', 'https://beam.example.test');
    expect(getProviderConfig('givemeanode', { GMN_TOKEN: 'token', GMN_API_HOST: 'https://gmn.example.test' }))
      .toEqual({ apiKey: 'token', baseUrl: 'https://gmn.example.test' });
  });

  it('prefers the sandbox Archil disk alias and retains canonical fallback without mutating env', () => {
    const env = { ...requiredEnvironment('archil'), ARCHIL_DISK_ID_SANDBOX: 'sandbox-disk' };
    const original = { ...env };
    expect(getProviderSandboxOptions('archil', env)).toHaveProperty('diskId', 'sandbox-disk');
    expect(getProviderSandboxOptions('archil', requiredEnvironment('archil')))
      .toHaveProperty('diskId', 'test-ARCHIL_DISK_ID');
    expect(env).toEqual(original);
  });

  it('prefers the dedicated platform key while accepting the benchmark vault alias', () => {
    // This key must belong to the access-listed test org with its own provider
    // key/order pinned, so the integration exercises own-keys rather than market.
    expect(getProviderConfig('platform', {
      COMPUTE_PLATFORM_TEST_API_KEY: 'dedicated',
      BENCHMARKS_PLATFORM_API_KEY: 'benchmark',
    })).toEqual({ apiKey: 'dedicated' });
    expect(getProviderConfig('platform', { BENCHMARKS_PLATFORM_API_KEY: 'benchmark' }))
      .toEqual({ apiKey: 'benchmark' });
    expect(() => getProviderConfig('platform', { COMPUTE_API_KEY: 'not-the-test-key' }))
      .toThrow('Missing required environment variable: COMPUTE_PLATFORM_TEST_API_KEY');
  });

  it('retains the Blaxel minimum TTL and nested Cloud Run dist entry', () => {
    expect(getProviderSandboxOptions('blaxel', requiredEnvironment('blaxel'))).toHaveProperty('timeout', 300000);
    expect(getProviderModuleUrl('cloud-run')).toMatch(/\/packages\/gcp\/dist\/cloud-run\/index\.mjs$/);
  });

  it.each(['unknown', 'toString', '__proto__'])('rejects unregistered provider %s', (provider) => {
    expect(() => getProviderConfig(provider, {})).toThrow(`Unsupported TEST_PROVIDER: ${provider}`);
    expect(() => getProviderModuleUrl(provider)).toThrow(`Unsupported TEST_PROVIDER: ${provider}`);
  });

  it('reports a missing factory export without invoking it', async () => {
    await expect(loadProviderFactory('e2b', getWorkspaceRoot(), async () => ({ e2b: 'not a factory' })))
      .rejects.toThrow('Provider factory "e2b" not found for e2b');
  });
});
