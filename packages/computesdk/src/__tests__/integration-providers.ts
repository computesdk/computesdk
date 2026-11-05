import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DirectProvider } from '../compute';

interface IntegrationProvider {
  package: string;
  directory: string;
  entry?: string;
  factory: string;
  requiredEnv: string[];
  optionalEnv?: string[];
  config: Record<string, string>;
  aliases?: Record<string, string[]>;
  canonicalFirst?: boolean;
  factoryOptions?: Record<string, unknown>;
  omitCreateTimeout?: boolean;
  sandboxOptions?: Record<string, unknown>;
  sandboxEnv?: Record<string, string>;
}

type Environment = Record<string, string | undefined>;
type ProviderFactory = (config: Record<string, unknown>) => DirectProvider;

export function getWorkspaceRoot(start = process.cwd()): string {
  let candidate = resolve(start);
  while (!existsSync(resolve(candidate, 'pnpm-workspace.yaml'))) {
    const parent = dirname(candidate);
    if (parent === candidate) {
      throw new Error('Cannot find the ComputeSDK workspace root');
    }
    candidate = parent;
  }
  return candidate;
}

// Shared with the CI matrices and vault loader; never duplicate provider rosters
// or credential mappings in the integration test.
export const integrationProviders = JSON.parse(
  readFileSync(resolve(getWorkspaceRoot(), 'scripts/integration-providers.json'), 'utf8'),
) as Record<string, IntegrationProvider>;

function getProvider(provider: string): IntegrationProvider {
  if (!Object.prototype.hasOwnProperty.call(integrationProviders, provider)) {
    throw new Error(`Unsupported TEST_PROVIDER: ${provider}`);
  }
  return integrationProviders[provider];
}

function getEnv(definition: IntegrationProvider, name: string, env: Environment): string | undefined {
  const aliases = definition.aliases?.[name] ?? [];
  const candidates = definition.canonicalFirst ? [name, ...aliases] : [...aliases, name];
  return candidates.map((candidate) => env[candidate]).find((value) => Boolean(value));
}

function requireEnvironment(definition: IntegrationProvider, env: Environment): void {
  for (const name of definition.requiredEnv) {
    if (!getEnv(definition, name, env)) {
      // Report names only: a missing credential must not expose another value.
      throw new Error(`Missing required environment variable: ${name}`);
    }
  }
}

function mapEnvironment(
  definition: IntegrationProvider,
  mapping: Record<string, string>,
  env: Environment,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [property, name] of Object.entries(mapping)) {
    const value = getEnv(definition, name, env);
    if (value) values[property] = value;
  }
  return values;
}

export function getProviderConfig(provider: string, env: Environment = process.env): Record<string, unknown> {
  const definition = getProvider(provider);
  requireEnvironment(definition, env);
  return {
    ...definition.factoryOptions,
    ...mapEnvironment(definition, definition.config, env),
  };
}

export function getProviderSandboxOptions(provider: string, env: Environment = process.env): Record<string, unknown> {
  const definition = getProvider(provider);
  requireEnvironment(definition, env);
  return {
    ...(definition.omitCreateTimeout ? {} : { timeout: 120000 }),
    ...definition.sandboxOptions,
    ...mapEnvironment(definition, definition.sandboxEnv ?? {}, env),
  };
}

export function getProviderModuleUrl(provider: string, workspaceRoot = getWorkspaceRoot()): string {
  const definition = getProvider(provider);
  return pathToFileURL(
    resolve(workspaceRoot, 'packages', definition.directory, 'dist', definition.entry ?? 'index.mjs'),
  ).href;
}

export async function loadProviderFactory(
  provider: string,
  workspaceRoot = getWorkspaceRoot(),
  importModule: (url: string) => Promise<Record<string, unknown>> = (url) => import(url),
): Promise<ProviderFactory> {
  const definition = getProvider(provider);
  // Load built workspace packages directly from dist after the CI build step.
  const mod = await importModule(getProviderModuleUrl(provider, workspaceRoot));
  const factory = mod[definition.factory];
  if (typeof factory !== 'function') {
    throw new Error(`Provider factory "${definition.factory}" not found for ${provider}`);
  }
  return factory as ProviderFactory;
}
