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

type SupportedProvider =
  | 'e2b'
  | 'vercel'
  | 'daytona'
  | 'modal'
  | 'archil'
  | 'just-bash';

const runIntegration = process.env.COMPUTESDK_INTEGRATION === '1';
const testProvider = process.env.TEST_PROVIDER as SupportedProvider | undefined;
const describeIntegration =
  runIntegration && testProvider ? describe : describe.skip;

const filesystemBasePath = '/tmp/computesdk-fs-test';

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
): Promise<(config: Record<string, string>) => DirectProvider> {
  const workspaceRoot = getWorkspaceRoot();
  const modulePaths: Record<SupportedProvider, string> = {
    e2b: resolve(workspaceRoot, 'packages/e2b/dist/index.mjs'),
    vercel: resolve(workspaceRoot, 'packages/vercel/dist/index.mjs'),
    daytona: resolve(workspaceRoot, 'packages/daytona/dist/index.mjs'),
    modal: resolve(workspaceRoot, 'packages/modal/dist/index.mjs'),
    archil: resolve(workspaceRoot, 'packages/archil/dist/index.mjs'),
    'just-bash': resolve(workspaceRoot, 'packages/just-bash/dist/index.mjs'),
  };

  const factoryMap: Record<SupportedProvider, string> = {
    e2b: 'e2b',
    vercel: 'vercel',
    daytona: 'daytona',
    modal: 'modal',
    archil: 'archil',
    'just-bash': 'justBash',
  };

  const moduleUrl = pathToFileURL(modulePaths[provider]).href;
  const mod = await import(moduleUrl);
  const factory = (mod as Record<string, unknown>)[factoryMap[provider]];
  if (typeof factory !== 'function') {
    throw new Error(
      `Provider factory "${factoryMap[provider]}" not found for ${provider}`
    );
  }

  return factory as (config: Record<string, string>) => DirectProvider;
}

function getProviderConfig(
  provider: SupportedProvider
): Record<string, string> {
  switch (provider) {
    case 'e2b':
      return { apiKey: requireEnv('E2B_API_KEY') };
    case 'vercel':
      return {
        token: requireEnv('VERCEL_TOKEN'),
        teamId: requireEnv('VERCEL_TEAM_ID'),
        projectId: requireEnv('VERCEL_PROJECT_ID'),
      };
    case 'daytona':
      return { apiKey: requireEnv('DAYTONA_API_KEY') };
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
    case 'just-bash':
      return {};
    default:
      throw new Error(`Unsupported TEST_PROVIDER: ${String(provider)}`);
  }
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
  expect(await sandbox.filesystem.exists('/tmp/computesdk-fs-missing')).toBe(
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

    const createOptions: Record<string, unknown> = { timeout: 120000 };
    if (testProvider === 'archil') {
      createOptions.diskId = requireEnv('ARCHIL_DISK_ID');
    }

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
