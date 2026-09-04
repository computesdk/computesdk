import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compute, type DirectProvider } from '../compute';
import type {
  Sandbox,
  SandboxFileSystem,
  FileEntry,
  CommandResult,
  SandboxInfo,
} from '../types/universal-sandbox';

type ProviderConfig = Record<string, unknown>;

interface ProviderDefinition {
  config: () => ProviderConfig;
  isConfigured: () => boolean;
  createOptions?: () => Record<string, unknown>;
  filesystemBasePath?: string;
}

function env(name: string): string | undefined {
  return process.env[name] || undefined;
}

function firstEnv(...names: string[]): string | undefined {
  return names.map((name) => env(name)).find(Boolean);
}

function envConfig(
  values: Record<string, string | undefined>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).filter(
      (entry): entry is [string, string] => Boolean(entry[1])
    )
  );
}

function hasAnyEnv(...names: string[]): boolean {
  return names.some((name) => Boolean(env(name)));
}

function isDockerIntegrationEnabled(): boolean {
  return env('RUN_INTEGRATION') === '1' || env('RUN_INTEGRATION') === 'true';
}

const runIntegration = env('COMPUTESDK_INTEGRATION') === '1';

const providerDefinitions: Record<string, ProviderDefinition> = {
  agentcore: {
    config: () =>
      envConfig({
        region: firstEnv('AWS_REGION', 'AWS_DEFAULT_REGION'),
        profile: env('AWS_PROFILE'),
      }),
    isConfigured: () =>
      Boolean(
        firstEnv('AWS_REGION', 'AWS_DEFAULT_REGION') &&
          hasAnyEnv('AWS_ACCESS_KEY_ID', 'AWS_PROFILE', 'AWS_SESSION_TOKEN')
      ),
  },
  agentuity: {
    config: () =>
      envConfig({
        apiKey: env('AGENTUITY_SDK_KEY'),
        region: env('AGENTUITY_REGION'),
        baseURL: env('AGENTUITY_BASE_URL'),
      }),
    isConfigured: () => Boolean(env('AGENTUITY_SDK_KEY')),
    filesystemBasePath: '/home/agentuity/computesdk-fs-test',
  },
  archil: {
    config: () =>
      envConfig({
        apiKey: env('ARCHIL_API_KEY'),
        region: env('ARCHIL_REGION'),
        baseUrl: env('ARCHIL_BASE_URL'),
      }),
    isConfigured: () =>
      Boolean(env('ARCHIL_API_KEY') && env('ARCHIL_REGION') && env('ARCHIL_DISK_ID')),
    createOptions: () => ({ diskId: requireEnv('ARCHIL_DISK_ID') }),
  },
  arker: {
    config: () =>
      envConfig({
        apiKey: env('ARKER_API_KEY'),
        region: env('ARKER_REGION'),
        provider: env('ARKER_PROVIDER'),
      }),
    isConfigured: () => Boolean(env('ARKER_API_KEY')),
  },
  beam: {
    config: () =>
      envConfig({
        token: env('BEAM_TOKEN'),
        workspaceId: env('BEAM_WORKSPACE_ID'),
      }),
    isConfigured: () => Boolean(env('BEAM_TOKEN') && env('BEAM_WORKSPACE_ID')),
  },
  blaxel: {
    config: () =>
      envConfig({
        apiKey: env('BL_API_KEY'),
        workspace: env('BL_WORKSPACE'),
      }),
    isConfigured: () => Boolean(env('BL_API_KEY') && env('BL_WORKSPACE')),
  },
  'cloud-run': {
    config: () =>
      envConfig({
        sandboxUrl: env('CLOUD_RUN_SANDBOX_URL'),
        sandboxSecret: env('CLOUD_RUN_SANDBOX_SECRET'),
        gatewayAuthToken: env('CLOUD_RUN_AUTH_TOKEN'),
        sandboxBinary: env('CLOUD_RUN_SANDBOX_BINARY'),
        executionMode: 'stateful',
      }),
    isConfigured: () =>
      Boolean(env('CLOUD_RUN_SANDBOX_URL') && env('CLOUD_RUN_SANDBOX_SECRET')),
    filesystemBasePath: '/workspace/computesdk-fs-test',
  },
  cloudflare: {
    config: () =>
      envConfig({
        sandboxUrl: env('CLOUDFLARE_SANDBOX_URL'),
        sandboxApiKey: env('CLOUDFLARE_SANDBOX_API_KEY'),
      }),
    isConfigured: () =>
      Boolean(
        env('CLOUDFLARE_SANDBOX_URL') &&
          env('CLOUDFLARE_SANDBOX_API_KEY')
      ),
  },
  codesandbox: {
    config: () => envConfig({ apiKey: env('CSB_API_KEY') }),
    isConfigured: () => Boolean(env('CSB_API_KEY')),
  },
  collimate: {
    config: () =>
      envConfig({
        serverUrl: env('COLLIMATE_API_URL') || 'https://api.collimate.ai',
        apiKey: env('COLLIMATE_API_KEY'),
        templateId: env('COLLIMATE_TEMPLATE_ID') || 'node',
      }),
    isConfigured: () => Boolean(env('COLLIMATE_API_KEY')),
  },
  'createos-sandbox': {
    config: () =>
      envConfig({
        apiKey: env('CREATEOS_SANDBOX_API_KEY'),
        baseUrl: env('CREATEOS_SANDBOX_BASE_URL'),
      }),
    isConfigured: () => Boolean(env('CREATEOS_SANDBOX_API_KEY')),
  },
  daytona: {
    config: () => envConfig({ apiKey: env('DAYTONA_API_KEY') }),
    isConfigured: () => Boolean(env('DAYTONA_API_KEY')),
  },
  declaw: {
    config: () =>
      envConfig({
        apiKey: env('DECLAW_API_KEY'),
        domain: env('DECLAW_DOMAIN'),
      }),
    isConfigured: () => Boolean(env('DECLAW_API_KEY')),
  },
  docker: {
    config: () => ({
      runtime: 'node',
      image: {
        name: env('DOCKER_NODE_IMAGE') || 'node:20-alpine',
        pullPolicy: 'ifNotPresent',
      },
      container: { workdir: '/workspace', autoRemove: true },
    }),
    isConfigured: isDockerIntegrationEnabled,
    filesystemBasePath: '/workspace/computesdk-fs-test',
  },
  e2b: {
    config: () => envConfig({ apiKey: env('E2B_API_KEY') }),
    isConfigured: () => Boolean(env('E2B_API_KEY')),
  },
  freestyle: {
    config: () =>
      envConfig({
        apiKey: env('FREESTYLE_API_KEY'),
        snapshotId: env('FREESTYLE_SNAPSHOT_ID'),
        baseUrl: env('FREESTYLE_API_URL'),
      }),
    isConfigured: () => Boolean(env('FREESTYLE_API_KEY')),
  },
  givemeanode: {
    config: () =>
      envConfig({
        apiKey: env('GMN_TOKEN'),
        baseUrl: env('GMN_API_HOST'),
      }),
    isConfigured: () => Boolean(env('GMN_TOKEN')),
  },
  hopx: {
    config: () =>
      envConfig({
        apiKey: env('HOPX_API_KEY'),
        baseURL: env('HOPX_BASE_URL'),
      }),
    isConfigured: () => Boolean(env('HOPX_API_KEY')),
  },
  isorun: {
    config: () => envConfig({ apiKey: env('ISORUN_API_KEY') }),
    isConfigured: () => Boolean(env('ISORUN_API_KEY')),
  },
  'just-bash': {
    config: () => ({}),
    isConfigured: () => true,
  },
  leap0: {
    config: () =>
      envConfig({
        apiKey: env('LEAP0_API_KEY'),
        baseUrl: env('LEAP0_API_URL'),
        sandboxDomain: env('LEAP0_SANDBOX_DOMAIN'),
        template: env('LEAP0_TEMPLATE'),
      }),
    isConfigured: () => Boolean(env('LEAP0_API_KEY')),
  },
  lelantos: {
    config: () =>
      envConfig({
        apiKey: env('LELANTOS_API_KEY') || env('E2B_API_KEY'),
        domain: env('LELANTOS_DOMAIN') || 'lelantos.ai',
      }),
    isConfigured: () =>
      Boolean(env('LELANTOS_API_KEY') || env('E2B_API_KEY')),
  },
  lightning: {
    config: () =>
      envConfig({
        apiKey: firstEnv('LIGHTNING_SANDBOX_API_KEY', 'LIGHTNING_API_KEY'),
        baseUrl: env('LIGHTNING_CLOUD_URL'),
      }),
    isConfigured: () =>
      hasAnyEnv('LIGHTNING_SANDBOX_API_KEY', 'LIGHTNING_API_KEY'),
  },
  microsandbox: {
    config: () => ({
      ...(env('MSB_RUN_INTEGRATION') === '1'
        ? { backend: 'local' }
        : {
            backend: 'cloud',
            ...envConfig({
              apiKey: env('MSB_API_KEY'),
              apiUrl: env('MSB_API_URL'),
              profile: env('MSB_PROFILE'),
            }),
          }),
    }),
    isConfigured: () =>
      env('MSB_RUN_INTEGRATION') === '1' ||
      hasAnyEnv('MSB_API_KEY', 'MSB_PROFILE'),
  },
  miosa: {
    config: () =>
      envConfig({
        apiKey: env('MIOSA_API_KEY'),
        baseUrl: env('MIOSA_API_URL'),
      }),
    isConfigured: () => Boolean(env('MIOSA_API_KEY')),
  },
  modal: {
    config: () =>
      envConfig({
        tokenId: env('MODAL_TOKEN_ID'),
        tokenSecret: env('MODAL_TOKEN_SECRET'),
      }),
    isConfigured: () =>
      Boolean(env('MODAL_TOKEN_ID') && env('MODAL_TOKEN_SECRET')),
  },
  mosaic: {
    config: () =>
      envConfig({
        baseUrl: env('MOSAIC_API_URL'),
        apiKey: env('MOSAIC_API_TOKEN'),
        template: env('MOSAIC_TEMPLATE'),
      }),
    isConfigured: () =>
      Boolean(env('MOSAIC_API_URL') && env('MOSAIC_API_TOKEN')),
    filesystemBasePath: '/workspace/computesdk-fs-test',
  },
  neevcloud: {
    config: () =>
      envConfig({
        apiKey: env('NEEV_API_KEY'),
        orgId: env('NEEV_ORG_ID'),
        projectId: env('NEEV_PROJECT_ID'),
      }),
    isConfigured: () => Boolean(env('NEEV_API_KEY')),
  },
  northflank: {
    config: () =>
      envConfig({
        token: env('NORTHFLANK_TOKEN'),
        projectId: env('NORTHFLANK_PROJECT_ID'),
        host: env('NORTHFLANK_API_URL'),
      }),
    isConfigured: () =>
      Boolean(env('NORTHFLANK_TOKEN') && env('NORTHFLANK_PROJECT_ID')),
  },
  opencomputer: {
    config: () =>
      envConfig({
        apiKey: env('OPENCOMPUTER_API_KEY'),
        apiUrl: env('OPENCOMPUTER_API_URL'),
        template: env('OPENCOMPUTER_TEMPLATE'),
      }),
    isConfigured: () => Boolean(env('OPENCOMPUTER_API_KEY')),
  },
  quilt: {
    config: () =>
      envConfig({
        baseUrl: env('QUILT_BASE_URL'),
        apiKey: env('QUILT_API_KEY'),
        accessToken: env('QUILT_ACCESS_TOKEN'),
        tenantId: env('QUILT_TENANT_ID'),
      }),
    isConfigured: () =>
      Boolean(
        env('QUILT_BASE_URL') &&
          hasAnyEnv('QUILT_API_KEY', 'QUILT_ACCESS_TOKEN')
      ),
  },
  railway: {
    config: () =>
      envConfig({
        token: env('RAILWAY_API_TOKEN'),
        environmentId: env('RAILWAY_ENVIRONMENT_ID'),
      }),
    isConfigured: () => Boolean(env('RAILWAY_API_TOKEN')),
  },
  'run-cloud': {
    config: () =>
      envConfig({
        apiKey: firstEnv('RUN_CLOUD_API_KEY', 'RUN_CLOUD_API_TOKEN'),
        apiUrl: env('RUN_CLOUD_API_URL'),
      }),
    isConfigured: () =>
      hasAnyEnv('RUN_CLOUD_API_KEY', 'RUN_CLOUD_API_TOKEN'),
  },
  runloop: {
    config: () => envConfig({ apiKey: env('RUNLOOP_API_KEY') }),
    isConfigured: () => Boolean(env('RUNLOOP_API_KEY')),
  },
  sail: {
    config: () =>
      envConfig({
        apiKey: env('SAIL_API_KEY'),
        app: env('SAIL_APP'),
      }),
    isConfigured: () => Boolean(env('SAIL_API_KEY')),
    filesystemBasePath: '/tmp',
  },
  sandbox0: {
    config: () =>
      envConfig({
        token: env('SANDBOX0_TOKEN') || env('SANDBOX0_API_KEY'),
        teamId: env('SANDBOX0_TEAM_ID'),
        baseUrl: env('SANDBOX0_BASE_URL'),
        templateId: env('SANDBOX0_TEMPLATE'),
      }),
    isConfigured: () =>
      hasAnyEnv('SANDBOX0_TOKEN', 'SANDBOX0_API_KEY'),
  },
  'secure-exec': {
    config: () => ({}),
    isConfigured: () => true,
    filesystemBasePath: '/workspace/computesdk-fs-test',
  },
  sprites: {
    config: () =>
      envConfig({
        apiKey: env('SPRITES_TOKEN'),
        baseUrl: env('SPRITES_API_URL'),
      }),
    isConfigured: () => Boolean(env('SPRITES_TOKEN')),
  },
  superserve: {
    config: () =>
      envConfig({
        apiKey: env('SUPERSERVE_API_KEY'),
        baseUrl: env('SUPERSERVE_BASE_URL'),
      }),
    isConfigured: () => Boolean(env('SUPERSERVE_API_KEY')),
  },
  tenki: {
    config: () =>
      envConfig({
        apiKey: firstEnv('TENKI_API_KEY', 'TENKI_AUTH_TOKEN'),
        baseUrl: env('TENKI_API_URL'),
        workspaceId: env('TENKI_WORKSPACE_ID'),
      }),
    isConfigured: () =>
      hasAnyEnv('TENKI_API_KEY', 'TENKI_AUTH_TOKEN'),
    filesystemBasePath: '/home/tenki/computesdk-fs-test',
  },
  tensorlake: {
    config: () =>
      envConfig({
        apiKey: env('TENSORLAKE_API_KEY'),
        apiUrl: env('TENSORLAKE_API_URL'),
        proxyUrl: env('TENSORLAKE_PROXY_URL'),
      }),
    isConfigured: () =>
      env('SKIP_INTEGRATION') !== 'true' && Boolean(env('TENSORLAKE_API_KEY')),
  },
  upstash: {
    config: () =>
      envConfig({
        apiKey: env('UPSTASH_BOX_API_KEY'),
        runtime: env('UPSTASH_RUNTIME'),
      }),
    isConfigured: () => Boolean(env('UPSTASH_BOX_API_KEY')),
  },
};

type SupportedProvider = keyof typeof providerDefinitions;

const requestedProvider = process.env.TEST_PROVIDER;
const testProvider: SupportedProvider | undefined =
  requestedProvider && requestedProvider in providerDefinitions
    ? (requestedProvider as SupportedProvider)
    : undefined;
const describeIntegration =
  runIntegration &&
  testProvider &&
  providerDefinitions[testProvider].isConfigured()
    ? describe
    : describe.skip;

const filesystemBasePath =
  providerDefinitions[testProvider ?? 'just-bash'].filesystemBasePath ??
  '/tmp/computesdk-fs-test';

function getWorkspaceRoot(): string {
  const cwd = process.cwd();
  const candidates = [cwd, resolve(cwd, '..'), resolve(cwd, '..', '..')];

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

async function loadProviderFactory(
  provider: SupportedProvider
): Promise<(config: ProviderConfig) => DirectProvider> {
  const workspaceRoot = getWorkspaceRoot();
  const modulePaths: Record<SupportedProvider, string> = Object.fromEntries(
    Object.keys(providerDefinitions).map((name) => [
      name,
      resolve(workspaceRoot, `packages/${name}/dist/index.mjs`),
    ])
  ) as Record<SupportedProvider, string>;
  const factoryMap: Record<SupportedProvider, string> = {
    agentcore: 'agentcore',
    agentuity: 'agentuity',
    archil: 'archil',
    arker: 'arker',
    beam: 'beam',
    blaxel: 'blaxel',
    'cloud-run': 'cloudRun',
    cloudflare: 'cloudflare',
    codesandbox: 'codesandbox',
    collimate: 'collimate',
    'createos-sandbox': 'createosSandbox',
    daytona: 'daytona',
    declaw: 'declaw',
    docker: 'docker',
    e2b: 'e2b',
    freestyle: 'freestyle',
    givemeanode: 'givemeanode',
    hopx: 'hopx',
    isorun: 'isorun',
    'just-bash': 'justBash',
    leap0: 'leap0',
    lelantos: 'lelantos',
    lightning: 'lightning',
    microsandbox: 'microsandbox',
    miosa: 'miosa',
    modal: 'modal',
    mosaic: 'mosaic',
    neevcloud: 'neevcloud',
    northflank: 'northflank',
    opencomputer: 'opencomputer',
    quilt: 'quilt',
    railway: 'railway',
    'run-cloud': 'runCloud',
    runloop: 'runloop',
    sail: 'sail',
    sandbox0: 'sandbox0',
    'secure-exec': 'secureExec',
    sprites: 'sprites',
    superserve: 'superserve',
    tenki: 'tenki',
    tensorlake: 'tensorlake',
    upstash: 'upstash',
  };

  const moduleUrl = pathToFileURL(modulePaths[provider]).href;
  const mod = await import(moduleUrl);
  const factory = (mod as Record<string, unknown>)[factoryMap[provider]];
  if (typeof factory !== 'function') {
    throw new Error(
      `Provider factory "${factoryMap[provider]}" not found for ${provider}`
    );
  }

  return factory as (config: ProviderConfig) => DirectProvider;
}

function getProviderConfig(provider: SupportedProvider): ProviderConfig {
  return providerDefinitions[provider].config();
}

function getProviderCreateOptions(
  provider: SupportedProvider
): Record<string, unknown> {
  return providerDefinitions[provider].createOptions?.() ?? {};
}

function createInMemoryFilesystem(): SandboxFileSystem {
  const files = new Map<string, { content: string; modified: Date }>();
  const dirs = new Set<string>();

  const normalize = (p: string): string => {
    let normalized = p.replace(/\/+/g, '/');
    if (normalized.length > 1 && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  };

  const ensureDir = (p: string): void => {
    const normalized = normalize(p);
    if (normalized === '/') return;
    const parts = normalized.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current += `/${part}`;
      dirs.add(current);
    }
  };

  const parentDir = (p: string): string => {
    const normalized = normalize(p);
    const index = normalized.lastIndexOf('/');
    return index <= 0 ? '/' : normalized.slice(0, index);
  };

  const listChildren = (p: string): FileEntry[] => {
    const normalized = normalize(p);
    const prefix = normalized === '/' ? '/' : `${normalized}/`;
    const entries = new Map<
      string,
      { type: 'file' | 'directory'; size: number; modified: Date }
    >();

    for (const [filePath, file] of files) {
      if (
        filePath !== normalized &&
        filePath.startsWith(prefix) &&
        !filePath.slice(prefix.length).includes('/')
      ) {
        const name = filePath.slice(prefix.length);
        entries.set(name, {
          type: 'file',
          size: file.content.length,
          modified: file.modified,
        });
      }
    }

    for (const dirPath of dirs) {
      if (
        dirPath !== normalized &&
        dirPath.startsWith(prefix) &&
        !dirPath.slice(prefix.length).includes('/')
      ) {
        const name = dirPath.slice(prefix.length);
        entries.set(name, { type: 'directory', size: 0, modified: new Date() });
      }
    }

    return Array.from(entries.entries()).map(([name, meta]) => ({
      name,
      ...meta,
    }));
  };

  return {
    readFile: async (path: string): Promise<string> => {
      const normalized = normalize(path);
      const file = files.get(normalized);
      if (!file) {
        throw new Error(
          `ENOENT: no such file or directory, open '${path}'`
        );
      }
      return file.content;
    },
    writeFile: async (path: string, content: string): Promise<void> => {
      const normalized = normalize(path);
      ensureDir(parentDir(normalized));
      files.set(normalized, { content, modified: new Date() });
    },
    mkdir: async (path: string): Promise<void> => {
      ensureDir(path);
    },
    readdir: async (path: string): Promise<FileEntry[]> => {
      return listChildren(path);
    },
    exists: async (path: string): Promise<boolean> => {
      const normalized = normalize(path);
      return files.has(normalized) || dirs.has(normalized);
    },
    remove: async (path: string): Promise<void> => {
      const normalized = normalize(path);
      for (const [filePath] of [...files]) {
        if (filePath === normalized || filePath.startsWith(`${normalized}/`)) {
          files.delete(filePath);
        }
      }
      for (const dirPath of [...dirs]) {
        if (dirPath === normalized || dirPath.startsWith(`${normalized}/`)) {
          dirs.delete(dirPath);
        }
      }
    },
  };
}

function createInMemoryFilesystemProvider(): DirectProvider {
  let counter = 0;

  return {
    name: 'in-memory-filesystem',
    sandbox: {
      create: async (): Promise<Sandbox> => {
        const sandboxId = `mem-fs-${(counter += 1)}`;
        const filesystem = createInMemoryFilesystem();

        const sandbox: Sandbox = {
          sandboxId,
          provider: 'in-memory-filesystem',
          runCommand: async (
            command: string,
            _options?: { env?: Record<string, string> }
          ): Promise<CommandResult> => ({
            stdout: `mock: ${command}`,
            stderr: '',
            exitCode: 0,
            durationMs: 0,
          }),
          getInfo: async (): Promise<SandboxInfo> => ({
            id: sandboxId,
            provider: 'in-memory-filesystem',
            status: 'running',
            createdAt: new Date(),
            timeout: 300000,
          }),
          getUrl: async ({
            port,
            protocol,
          }: {
            port: number;
            protocol?: string;
          }): Promise<string> =>
            `${protocol || 'https'}://${port}-${sandboxId}.example.com`,
          destroy: async (): Promise<void> => {},
          filesystem,
        };

        return sandbox;
      },
      getById: async (): Promise<Sandbox | null> => null,
      destroy: async (): Promise<void> => {},
    },
  };
}

async function runFilesystemAssertions(sandbox: Sandbox): Promise<void> {
  const testFile = `${filesystemBasePath}/hello.txt`;
  const testDir = `${filesystemBasePath}/data`;
  const testNestedFile = `${testDir}/nested.txt`;

  await sandbox.filesystem.mkdir(filesystemBasePath);
  await sandbox.filesystem.writeFile(testFile, 'hello from computesdk');

  const content = await sandbox.filesystem.readFile(testFile);
  expect(content).toBe('hello from computesdk');

  expect(await sandbox.filesystem.exists(testFile)).toBe(true);
  expect(await sandbox.filesystem.exists(`${filesystemBasePath}-missing`)).toBe(
    false
  );

  await sandbox.filesystem.mkdir(testDir);
  await sandbox.filesystem.writeFile(testNestedFile, 'nested content');

  const entries = await sandbox.filesystem.readdir(filesystemBasePath);
  expect(Array.isArray(entries)).toBe(true);
  const names = entries.map((entry: FileEntry) => entry.name).sort();
  expect(names).toContain('hello.txt');
  expect(names).toContain('data');

  const dirEntries = await sandbox.filesystem.readdir(testDir);
  const dirNames = dirEntries.map((entry: FileEntry) => entry.name);
  expect(dirNames).toContain('nested.txt');

  await sandbox.filesystem.remove(testNestedFile);
  expect(await sandbox.filesystem.exists(testNestedFile)).toBe(false);

  await sandbox.filesystem.remove(testDir);
  expect(await sandbox.filesystem.exists(testDir)).toBe(false);

  await sandbox.filesystem.remove(testFile);
  expect(await sandbox.filesystem.exists(testFile)).toBe(false);

  await sandbox.filesystem.remove(filesystemBasePath);
  expect(await sandbox.filesystem.exists(filesystemBasePath)).toBe(false);
}

describe('sandbox filesystem', () => {
  const sdk = compute({ provider: createInMemoryFilesystemProvider() });
  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = await sdk.sandbox.create();
  });

  afterEach(async () => {
    try {
      await sandbox.destroy();
    } catch {
      // Ignore cleanup errors
    }
  });

  it('exposes a filesystem on the sandbox', () => {
    expect(sandbox.filesystem).toBeDefined();
    expect(typeof sandbox.filesystem.readFile).toBe('function');
    expect(typeof sandbox.filesystem.writeFile).toBe('function');
    expect(typeof sandbox.filesystem.mkdir).toBe('function');
    expect(typeof sandbox.filesystem.readdir).toBe('function');
    expect(typeof sandbox.filesystem.exists).toBe('function');
    expect(typeof sandbox.filesystem.remove).toBe('function');
  });

  it('performs filesystem operations', async () => {
    await runFilesystemAssertions(sandbox);
  });

  it('throws when reading a missing file', async () => {
    await expect(
      sandbox.filesystem.readFile(`${filesystemBasePath}/missing.txt`)
    ).rejects.toThrow();
  });
});

describeIntegration('sandbox filesystem integration', () => {
  let sandbox: Sandbox;

  beforeEach(async () => {
    if (!testProvider) {
      throw new Error('TEST_PROVIDER must be set when COMPUTESDK_INTEGRATION=1');
    }

    const providerFactory = await loadProviderFactory(testProvider);
    const provider = providerFactory(getProviderConfig(testProvider));
    const sdk = compute({ provider });

    const createOptions: Record<string, unknown> = {
      timeout: 120000,
      ...getProviderCreateOptions(testProvider),
    };

    sandbox = await sdk.sandbox.create(createOptions as any);
  }, 180000);

  afterEach(async () => {
    try {
      await sandbox.destroy();
    } catch {
      // Ignore cleanup errors
    }
  }, 30000);

  it('performs filesystem operations', async () => {
    await runFilesystemAssertions(sandbox);
  }, 180000);

  it('throws when reading a missing file', async () => {
    await expect(
      sandbox.filesystem.readFile(`${filesystemBasePath}/missing.txt`)
    ).rejects.toThrow();
  }, 30000);
});
