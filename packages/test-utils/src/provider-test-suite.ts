/**
 * Central Provider Test Suite
 * 
 * This module provides a comprehensive test suite that can be used to test
 * any ComputeSDK provider implementation. It ensures consistency across all
 * providers and covers all core functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createProviderSuiteAttempt } from './provider-suite-attempt';
import type { ProviderSuiteCleanupObserver } from './provider-suite-attempt';
import { withDeadline } from './provider-lifecycle';
// @ts-ignore - workspace reference
import type { Provider, ProviderInstance, CommandResult, FileEntry, RunCommandOptions, InstanceInfo } from '@computesdk/provider';

export interface ProviderTestConfig {
  /** The provider instance to test */
  provider: Provider;
  /** Provider name for test descriptions */
  name: string;
  /** Whether this provider supports filesystem operations */
  supportsFilesystem?: boolean;
  /** Custom test timeout in milliseconds */
  timeout?: number;
  /**
   * Allocation client deadline, separate from the test body timeout (default:
   * 60,000ms; positive safe integer, at most 15 minutes). Not cancellation:
   * ownership is retained and cleanup still attempts to destroy late allocations.
   */
  createTimeoutMs?: number;
  /** Skip native tests without substituting a mock (for example, missing credentials). */
  skipIntegration?: boolean;
  /**
   * Framework mocks only self-test this suite's assertions, never an adapter.
   * Native is the default; runUnitTests explicitly selects framework-mocked.
   */
  executionMode?: 'native' | 'framework-mocked';
  /** Whether to test background commands (default: true). */
  supportsBackground?: boolean;
  /**
   * Optional native-only setup verification, bounded to 10 seconds. For
   * example, require SDK-reported presence of this exact sandbox ID.
   */
  verifySandbox?: (sandbox: ProviderInstance) => Promise<void>;
  /**
   * Optional native-only verification after destroy, within its 10-second
   * cleanup budget. SDK-reported absence is not physical deletion proof.
   */
  verifyCleanup?: (sandbox: ProviderInstance) => Promise<void>;
  /**
   * Optional synchronous native-only diagnostics around the original destroy.
   * Rejection observers receive the original SDK error; do not log it raw.
   * Diagnostic failures cannot prevent destroy or verification, but fail cleanup.
   */
  observeCleanup?: ProviderSuiteCleanupObserver<ProviderInstance>;
  /** Ports to expose when creating sandboxes (needed for getUrl tests on some providers) */
  ports?: number[];
  /** Whether this provider should run getUrl coverage tests */
  supportsGetUrl?: boolean;
  /** Base path for filesystem tests (default: '/tmp') */
  filesystemBasePath?: string;
  /**
   * Whether to check live command output (`onStdout`/`onStderr`). Any provider
   * can serve it — natively via `streamCommand`, otherwise through the daemond
   * bridge — but the bridge needs a routable port inside the sandbox, so this is
   * opt-in per provider rather than assumed.
   */
  supportsStreaming?: boolean;
  /**
   * Whether to exercise `startProcess` (interactive stdin jobs via the
   * in-sandbox daemon). Like streaming it runs through daemond, so it needs a
   * sandbox where the daemon can boot — opt-in per provider.
   */
  supportsProcesses?: boolean;
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
    createTimeoutMs = 60_000,
    skipIntegration = false,
    executionMode = 'native',
    supportsBackground = true,
    verifySandbox,
    verifyCleanup,
    observeCleanup,
    ports,
    supportsGetUrl = true,
    filesystemBasePath = '/tmp',
    supportsStreaming = false,
    supportsProcesses = false,
  } = config;

  // Reject invalid client budgets before registering hooks or creating resources.
  if (!Number.isSafeInteger(createTimeoutMs) || createTimeoutMs <= 0 || createTimeoutMs > 900_000) {
    throw new Error('createTimeoutMs must be a positive safe integer no greater than 900000 milliseconds');
  }
  const setupHookTimeoutMs = Math.max(90_000, createTimeoutMs + 15_000);

  return () => {
    const frameworkMocked = executionMode === 'framework-mocked';
    if (process.env.COMPUTESDK_CONFORMANCE_NATIVE === '1' && (skipIntegration || frameworkMocked)) {
      throw new Error(
        `COMPUTESDK_CONFORMANCE_NATIVE requires enabled native coverage for ${name}; skipped or framework-mocked coverage is not conformance`,
      );
    }
    // Hooks belong to this invocation, not the caller's describe scope. These
    // tests share one current attempt, so override caller/global concurrency.
    const suite = skipIntegration && !frameworkMocked ? describe.sequential.skip : describe.sequential;
    suite(`${name} [${executionMode}]${frameworkMocked ? ' framework self-tests (not adapter coverage)' : ''}`, () => {
      let sandbox: ProviderInstance;
      let attempt: ReturnType<typeof createProviderSuiteAttempt<ProviderInstance>> | undefined;

      const createSandbox = async () => {
        if (frameworkMocked) {
          return createMockSandbox(config);
        }
        const createOptions: any = {};
        if (ports && ports.length > 0) {
          createOptions.ports = ports;
        }
        return await provider.sandbox.create(createOptions);
      };

      beforeEach(async () => {
        // Reset before creation: a failed setup must not re-destroy the previous
        // test's sandbox. A local attempt also fences late setup completion.
        sandbox = undefined!;
        const ownedAttempt = createProviderSuiteAttempt(
          createSandbox, createTimeoutMs, undefined, frameworkMocked ? undefined : verifyCleanup,
          frameworkMocked ? undefined : observeCleanup,
        );
        attempt = ownedAttempt;
        const created = await ownedAttempt.ready;
        if (attempt === ownedAttempt) {
          // Establish ownership before verification: even a failed presence
          // check must still destroy this allocation in afterEach.
          sandbox = created;
          if (!frameworkMocked && verifySandbox) {
            await withDeadline(
              () => verifySandbox(created), 10_000, 'Sandbox verification failed or timed out',
            );
          }
        }
      }, setupHookTimeoutMs);

      afterEach(async () => {
        const ownedAttempt = attempt;
        attempt = undefined;
        sandbox = undefined!;
        await ownedAttempt?.cleanup();
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

      if (supportsBackground) {
        it('should execute background commands', async () => {
          const result = await sandbox.runCommand('sleep 1', { background: true });

          expect(result).toBeDefined();
          expect(result.exitCode).toBe(0);
        }, timeout);
      }

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
        expect(Number.isInteger(result.exitCode)).toBe(true);
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

      if (supportsStreaming) {
        describe('Live Command Output', () => {
          it('should deliver output while the command is still running', async () => {
            // The point of streaming is *when* output arrives, so the assertion is
            // about ordering against the command's own completion rather than
            // about the final text.
            const chunks: string[] = [];
            const startedAt = Date.now();
            let firstChunkAt: number | undefined;

            const result = await sandbox.runCommand(
              `sh -c 'for i in 1 2 3 4 5; do echo tick $i; sleep 1; done'`,
              {
                onStdout: (text: string) => {
                  firstChunkAt ??= Date.now();
                  chunks.push(text);
                }
              }
            );

            expect(result.exitCode).toBe(0);
            expect(firstChunkAt).toBeDefined();
            // The first tick is printed immediately and the last four seconds are
            // spent sleeping, so a first chunk that arrives in the first half of
            // the command's life could not have been buffered until exit.
            expect((firstChunkAt as number) - startedAt).toBeLessThan(
              result.durationMs / 2
            );
            // Everything streamed is exactly what the command produced: no chunk
            // dropped, and none delivered twice.
            expect(chunks.join('')).toBe(result.stdout);
            for (let i = 1; i <= 5; i += 1) {
              expect(result.stdout).toContain(`tick ${i}`);
            }
          }, timeout);

          it('should stream stderr separately and report a non-zero exit', async () => {
            const out: string[] = [];
            const err: string[] = [];

            const result = await sandbox.runCommand(
              `sh -c 'echo out; echo err 1>&2; exit 3'`,
              {
                onStdout: (text: string) => out.push(text),
                onStderr: (text: string) => err.push(text)
              }
            );

            expect(result.exitCode).toBe(3);
            expect(out.join('')).toContain('out');
            expect(err.join('')).toContain('err');
            expect(out.join('')).not.toContain('err');
          }, timeout);

          it('should stop a streaming command that outruns its timeout', async () => {
            const result = await sandbox.runCommand(
              `sh -c 'echo starting; sleep 60'`,
              { timeout: 5000, onStdout: () => {} }
            );

            // What matters is that it came back at the deadline rather than after
            // the full sleep, and that it is not reported as a success.
            expect(result.exitCode).not.toBe(0);
            expect(result.durationMs).toBeLessThan(30000);
          }, timeout);
        });
      }

      if (supportsProcesses && !frameworkMocked) {
        describe('Interactive Processes', () => {
          it('should write to a process stdin and collect echoed output', async () => {
            const chunks: string[] = [];
            const proc = await sandbox.startProcess('cat', {
              stdin: true,
              onStdout: (c) => chunks.push(c),
            });

            await proc.write('hello\n');
            await proc.write('world\n');
            await proc.closeStdin();

            const result = await proc.wait({ timeout: 30000 });
            expect(result.exitCode).toBe(0);
            expect(result.stdout).toBe('hello\nworld\n');
            expect(chunks.join('')).toBe(result.stdout);
          }, timeout);

          it('should kill a running process and report its signal', async () => {
            const proc = await sandbox.startProcess('sleep 60');
            await proc.kill();
            const result = await proc.wait({ timeout: 15000 });

            expect(result.exitCode).not.toBe(0);
            expect(result.signal).toBeTruthy();
          }, timeout);
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
function createMockSandbox(config: ProviderTestConfig): ProviderInstance {
  const providerName = config.name.toLowerCase();

  // Mock state to simulate realistic behavior
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();

  return {
    instanceId: 'mock-sandbox-123',
    sandboxId: 'mock-sandbox-123',
    provider: providerName,
    getInstance: <T = unknown>(): T => ({} as T),

    runCommand: async (command: string, options?: RunCommandOptions): Promise<CommandResult> => {
      // Mocked streaming: the chunks are handed over before the promise settles,
      // which is the property the streaming tests are actually checking.
      if (command.includes('for i in 1 2 3 4 5')) {
        const startedAt = Date.now();
        let stdout = '';
        for (let i = 1; i <= 5; i += 1) {
          const text = `tick ${i}\n`;
          stdout += text;
          options?.onStdout?.(text);
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return { stdout, stderr: '', exitCode: 0, durationMs: Date.now() - startedAt };
      }
      if (command.includes('echo err 1>&2')) {
        options?.onStdout?.('out\n');
        options?.onStderr?.('err\n');
        return { stdout: 'out\n', stderr: 'err\n', exitCode: 3, durationMs: 5 };
      }
      if (command.includes('echo starting; sleep 60')) {
        options?.onStdout?.('starting\n');
        await new Promise((resolve) => setTimeout(resolve, options?.timeout ? 5 : 10));
        return { stdout: 'starting\n', stderr: '', exitCode: 124, durationMs: 5 };
      }
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

    startProcess: async (): Promise<never> => {
      throw new Error('daemond: not supported by mock');
    },

    getInfo: async (): Promise<InstanceInfo> => ({
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

    getProvider: (): Provider => {
      const instances = {
        create: async () => { throw new Error('Not implemented in mock'); },
        getById: async () => { throw new Error('Not implemented in mock'); },
        list: async () => { throw new Error('Not implemented in mock'); },
        destroy: async () => { throw new Error('Not implemented in mock'); }
      };
      return {
        name: providerName,
        instances,
        sandbox: instances
      } as Provider;
    }
  };
}

/**
 * Utility function to run integration tests with real API calls
 */
export function runIntegrationTests(config: ProviderTestConfig) {
  return runProviderTestSuite({ ...config, skipIntegration: false, executionMode: 'native' });
}

/**
 * Framework self-tests with canned mocks; these do not test the supplied adapter.
 */
export function runUnitTests(config: ProviderTestConfig) {
  return runProviderTestSuite({ ...config, skipIntegration: true, executionMode: 'framework-mocked' });
}
