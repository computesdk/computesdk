/**
 * Central Provider Test Suite
 * 
 * This module provides a comprehensive test suite that can be used to test
 * any ComputeSDK provider implementation. It ensures consistency across all
 * providers and covers all core functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// @ts-ignore - workspace reference
import type { Provider, ProviderSandbox, CommandResult, FileEntry, RunCommandOptions, SandboxInfo } from '@computesdk/provider';

export interface ProviderTestConfig {
  /** The provider instance to test */
  provider: Provider;
  /** Provider name for test descriptions */
  name: string;
  /** Whether this provider supports filesystem operations */
  supportsFilesystem?: boolean;
  /** Custom test timeout in milliseconds */
  timeout?: number;
  /** Skip tests that require real API calls */
  skipIntegration?: boolean;
  /** Ports to expose when creating sandboxes (needed for getUrl tests on some providers) */
  ports?: number[];
  /** Whether this provider should run getUrl coverage tests */
  supportsGetUrl?: boolean;
  /** Base path for filesystem tests (default: '/tmp') */
  filesystemBasePath?: string;
}

/**
 * Creates test functions for a provider test suite
 * This returns functions that can be called within describe blocks
 */
export function defineProviderTests(config: ProviderTestConfig) {
  const {
    provider,
    name,
    supportsFilesystem = false,
    timeout = 60000,
    skipIntegration = false,
    ports,
    supportsGetUrl = true,
    filesystemBasePath = '/tmp',
  } = config;

  return () => {
    let sandbox: ProviderSandbox;

    const createSandbox = async () => {
      if (skipIntegration) {
        return createMockSandbox(config);
      }
      const createOptions: any = {};
      if (ports && ports.length > 0) {
        createOptions.ports = ports;
      }
      return await provider.sandbox.create(createOptions);
    };

    const cleanupSandbox = async (sb: ProviderSandbox) => {
      if (sb && !skipIntegration) {
        try {
          await Promise.race([
            sb.destroy(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Destroy timeout')), 10000)
            )
          ]);
        } catch {
          // Ignore cleanup errors (including timeouts)
        }
      }
    };

    beforeEach(async () => {
      sandbox = await createSandbox();
    }, 90000);

    afterEach(async () => {
      await cleanupSandbox(sandbox);
    }, 30000);

    it('should create a sandbox with valid ID', () => {
      expect(sandbox).toBeDefined();
      expect(sandbox.sandboxId).toBeDefined();
      expect(typeof sandbox.sandboxId).toBe('string');
      expect(sandbox.provider).toBe(name.toLowerCase());
    });

    it('should execute shell commands', async () => {
      const result = await sandbox.runCommand('echo "Hello from command"');

      expect(result).toBeDefined();
      expect(result.stdout).toContain('Hello from command');
      expect(result.exitCode).toBe(0);
    }, timeout);

    it('should execute background commands', async () => {
      const result = await sandbox.runCommand('sleep 1', { background: true });

      expect(result).toBeDefined();
      expect(result.exitCode).toBe(0);
    }, timeout);

    it('should get sandbox info', async () => {
      const info = await sandbox.getInfo();

      expect(info).toBeDefined();
      expect(info.id).toBeDefined();
      expect(info.provider).toBe(name.toLowerCase());
      expect(info.status).toBeDefined();
    });

    if (supportsGetUrl) {
      const primaryPort = (ports && ports.length > 0) ? ports[0] : 3000;

      it('should get sandbox URL for a port', async () => {
        const url = await sandbox.getUrl({ port: primaryPort });

        expect(url).toBeDefined();
        expect(typeof url).toBe('string');
        expect(url.length).toBeGreaterThan(0);
        expect(url).toMatch(/^(https?|wss?):\/\/.+/);
      });

      if (ports && ports.length > 1) {
        it('should get sandbox URL with custom protocol', async () => {
          const url = await sandbox.getUrl({ port: ports[1], protocol: 'wss' });

          expect(url).toBeDefined();
          expect(typeof url).toBe('string');
          expect(url).toMatch(/^(https?|wss?):\/\/.+/);
        });
      }
    }

    it('should handle invalid commands gracefully', async () => {
      const result = await sandbox.runCommand('nonexistent-command-12345');
      expect(result.exitCode).not.toBe(0);
    });

    if (supportsFilesystem) {
      describe('Filesystem Operations', () => {
        const testFilePath = `${filesystemBasePath}/test-file.txt`;
        const testDirPath = `${filesystemBasePath}/test-dir`;
        const testContent = 'Hello, ComputeSDK filesystem!';

        it('should write and read files', async () => {
          await sandbox.filesystem.writeFile(testFilePath, testContent);
          const content = await sandbox.filesystem.readFile(testFilePath);

          expect(content).toBe(testContent);
        }, timeout);

        it('should check file existence', async () => {
          await sandbox.filesystem.writeFile(testFilePath, testContent);
          const exists = await sandbox.filesystem.exists(testFilePath);

          expect(exists).toBe(true);
        }, timeout);

        it('should create directories', async () => {
          await sandbox.filesystem.mkdir(testDirPath);
          const exists = await sandbox.filesystem.exists(testDirPath);

          expect(exists).toBe(true);
        }, timeout);

        it('should list directory contents', async () => {
          await sandbox.filesystem.mkdir(testDirPath);
          await sandbox.filesystem.writeFile(`${testDirPath}/file1.txt`, 'content1');
          await sandbox.filesystem.writeFile(`${testDirPath}/file2.txt`, 'content2');

          const entries = await sandbox.filesystem.readdir(testDirPath);

          expect(entries).toBeDefined();
          expect(Array.isArray(entries)).toBe(true);
          expect(entries.length).toBeGreaterThanOrEqual(2);

          const fileNames = entries.map((entry: FileEntry) => entry.name);
          expect(fileNames).toContain('file1.txt');
          expect(fileNames).toContain('file2.txt');
        }, timeout);

        it('should remove files and directories', async () => {
          await sandbox.filesystem.writeFile(testFilePath, testContent);
          await sandbox.filesystem.remove(testFilePath);

          const exists = await sandbox.filesystem.exists(testFilePath);
          expect(exists).toBe(false);
        }, timeout);

        it('should handle file not found errors', async () => {
          await expect(async () => {
            await sandbox.filesystem.readFile('/nonexistent/file.txt');
          }).rejects.toThrow();
        });
      });
    }

    describe('Shell Command Argument Quoting', () => {
      it('should properly quote arguments with spaces', async () => {
        const result = await sandbox.runCommand('sh -c \'echo "hello world"\'');

        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe('hello world');
      }, timeout);

      it('should properly quote arguments with special characters', async () => {
        const result = await sandbox.runCommand('sh -c \'echo "$HOME"\'');

        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBeTruthy();
      }, timeout);

      it('should handle complex shell commands with pipes', async () => {
        const result = await sandbox.runCommand('sh -c \'echo "test content" > /tmp/test-quoting.txt && cat /tmp/test-quoting.txt\'');

        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe('test content');
      }, timeout);
    });
  };
}

/**
 * Runs the complete provider test suite (legacy function for backward compatibility)
 */
export function runProviderTestSuite(config: ProviderTestConfig) {
  const testFunction = defineProviderTests(config);
  testFunction();
}

/**
 * Creates a mock sandbox for unit testing
 */
function createMockSandbox(config: ProviderTestConfig): ProviderSandbox {
  const providerName = config.name.toLowerCase();

  // Mock state to simulate realistic behavior
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();

  return {
    sandboxId: 'mock-sandbox-123',
    provider: providerName,
    getInstance: <T = unknown>(): T => ({} as T),

    runCommand: async (command: string, options?: RunCommandOptions): Promise<CommandResult> => {
      if (command.includes('echo "Hello from command"')) {
        return { stdout: 'Hello from command\n', stderr: '', exitCode: 0, durationMs: 10 };
      }
      if (command === 'nonexistent-command-12345') {
        return { stdout: '', stderr: `bash: ${command}: command not found\n`, exitCode: 127, durationMs: 5 };
      }
      if (command.includes('sleep 1') && options?.background) {
        return { stdout: '', stderr: '', exitCode: 0, durationMs: 1 };
      }
      if (command === 'sh -c \'echo "hello world"\'') {
        return { stdout: 'hello world\n', stderr: '', exitCode: 0, durationMs: 10 };
      }
      if (command === 'sh -c \'echo "$HOME"\'') {
        return { stdout: '/home/user\n', stderr: '', exitCode: 0, durationMs: 10 };
      }
      if (command === 'sh -c \'echo "test content" > /tmp/test-quoting.txt && cat /tmp/test-quoting.txt\'') {
        mockFiles.set('/tmp/test-quoting.txt', 'test content');
        return { stdout: 'test content\n', stderr: '', exitCode: 0, durationMs: 20 };
      }
      return { stdout: `Mock command output: ${command}`, stderr: '', exitCode: 0, durationMs: 50 };
    },

    getInfo: async (): Promise<SandboxInfo> => ({
      id: 'mock-sandbox-123',
      provider: providerName,
      status: 'running',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      timeout: 300000,
      metadata: {}
    }),

    getUrl: async (options: { port: number; protocol?: string }): Promise<string> => {
      const { port, protocol = 'https' } = options;
      return `${protocol}://mock-sandbox-123-${port}.example.com`;
    },

    destroy: async (): Promise<void> => {},

    filesystem: {
      readFile: async (path: string): Promise<string> => {
        if (mockFiles.has(path)) return mockFiles.get(path)!;
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      },
      writeFile: async (path: string, content: string): Promise<void> => { mockFiles.set(path, content); },
      mkdir: async (path: string): Promise<void> => { mockDirs.add(path); },
      readdir: async (path: string): Promise<FileEntry[]> => {
        const entries: FileEntry[] = [];
        for (const [filePath, content] of mockFiles.entries()) {
          if (filePath.startsWith(path + '/') && !filePath.substring(path.length + 1).includes('/')) {
            entries.push({ name: filePath.substring(path.length + 1), type: 'file', size: content.length, modified: new Date('2024-01-01T00:00:00Z') });
          }
        }
        for (const dirPath of mockDirs) {
          if (dirPath.startsWith(path + '/') && !dirPath.substring(path.length + 1).includes('/')) {
            entries.push({ name: dirPath.substring(path.length + 1), type: 'directory', size: 0, modified: new Date('2024-01-01T00:00:00Z') });
          }
        }
        return entries;
      },
      exists: async (path: string): Promise<boolean> => mockFiles.has(path) || mockDirs.has(path),
      remove: async (path: string): Promise<void> => { mockFiles.delete(path); mockDirs.delete(path); }
    },

    getProvider: (): Provider => ({
      name: providerName,
      sandbox: {
        create: async () => { throw new Error('Not implemented in mock'); },
        getById: async () => { throw new Error('Not implemented in mock'); },
        list: async () => { throw new Error('Not implemented in mock'); },
        destroy: async () => { throw new Error('Not implemented in mock'); }
      }
    } as Provider)
  };
}

/**
 * Utility function to run integration tests with real API calls
 */
export function runIntegrationTests(config: ProviderTestConfig) {
  return runProviderTestSuite({ ...config, skipIntegration: false });
}

/**
 * Utility function to run unit tests with mocked implementations
 */
export function runUnitTests(config: ProviderTestConfig) {
  return runProviderTestSuite({ ...config, skipIntegration: true });
}
