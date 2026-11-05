/**
 * Central Provider Test Suite
 * 
 * This module provides a comprehensive test suite that can be used to test
 * any ComputeSDK provider implementation. It ensures consistency across all
 * providers and covers all core functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// @ts-ignore - workspace reference
import type { Provider, ProviderInstance, CommandResult, FileEntry, RunCommandOptions, InstanceInfo, ProcessTier } from '@computesdk/provider';

/** Which runtime served streaming and background processes in a conformance run. */
export interface ProcessRuntimeCoverage {
  provider: string;
  streaming: ProcessTier | 'unknown';
  processes: ProcessTier | 'unknown';
}

/** Coverage recorded by every suite run in this process, for reporting. */
export const processRuntimeCoverage: ProcessRuntimeCoverage[] = [];

/** Reads which runtime serves `onStdout`/`onStderr` and `startProcess` on an instance. */
export function describeProcessRuntime(name: string, instance: ProviderInstance): ProcessRuntimeCoverage {
  const runtime = instance.processRuntime;
  return { provider: name, streaming: runtime?.streaming ?? 'unknown', processes: runtime?.processes ?? 'unknown' };
}

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
  /**
   * Whether to check live command output (`onStdout`/`onStderr`). Served
   * natively via `streamCommand`, otherwise by the shell process tier over
   * plain `runCommand` (or daemond when configured with `processRuntime: 'daemond'`).
   */
  supportsStreaming?: boolean;
  /**
   * Whether to exercise `startProcess` (stdin, kill, parallel starts, reattach).
   * Served natively via a `startProcess` hook, otherwise by the shell tier.
   */
  supportsProcesses?: boolean;
  /**
   * Expected runtime per capability, e.g. `{ streaming: 'native', processes: 'shell' }`.
   * The suite always records coverage in {@link processRuntimeCoverage}; with
   * this set it also fails when a provider silently changes tier.
   */
  expectProcessRuntime?: { streaming?: ProcessTier; processes?: ProcessTier };
}

/**
 * With COMPUTESDK_REQUIRE_INTEGRATION=1, a suite whose live tests would be
 * skipped (missing credentials) registers a failing test instead.
 */
export function failIfIntegrationRequired(name: string, skipIntegration: boolean) {
  if (!skipIntegration || process.env.COMPUTESDK_REQUIRE_INTEGRATION !== '1') return;
  it(`${name} integration tests require credentials`, () => {
    throw new Error(
      `COMPUTESDK_REQUIRE_INTEGRATION=1 but ${name} integration tests were skipped (missing credentials)`
    );
  });
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
    supportsStreaming = false,
    supportsProcesses = false,
    expectProcessRuntime,
  } = config;

  return () => {
    failIfIntegrationRequired(name, skipIntegration);

    let sandbox: ProviderInstance;

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

    const cleanupSandbox = async (sb: ProviderInstance) => {
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

    it('should report which runtime serves streaming and processes', () => {
      const coverage = describeProcessRuntime(name, sandbox);
      processRuntimeCoverage.push(coverage);
      console.info(`[conformance] ${name}: streaming=${coverage.streaming} processes=${coverage.processes}`);
      if (expectProcessRuntime?.streaming) expect(coverage.streaming).toBe(expectProcessRuntime.streaming);
      if (expectProcessRuntime?.processes) expect(coverage.processes).toBe(expectProcessRuntime.processes);
    });

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

        if (!skipIntegration) {
          it('should leave no delayed side effect after a timeout', async () => {
            // A deadline that only stops the client leaves the command running;
            // the marker proves the whole process tree died in the box.
            const marker = `/tmp/csdk-timeout-marker-${Date.now()}`;
            const result = await sandbox.runCommand(`sh -c 'sleep 4; touch ${marker}'`, {
              timeout: 1500,
              onStdout: () => {},
            });
            expect(result.exitCode).not.toBe(0);
            await new Promise((resolve) => setTimeout(resolve, 6000));
            const check = await sandbox.runCommand(`[ -e ${marker} ] && echo present || echo absent`);
            expect(check.stdout.trim()).toBe('absent');
          }, timeout);
        }
      });
    }

    if (supportsProcesses && !skipIntegration) {
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

        it('should start several processes in parallel', async () => {
          const results = await Promise.all(
            [0, 1, 2, 3].map((i) =>
              sandbox.startProcess(`echo parallel-${i}`).then((proc) => proc.wait({ timeout: 30000 }))
            )
          );
          results.forEach((result, i) => {
            expect(result.exitCode).toBe(0);
            expect(result.stdout).toBe(`parallel-${i}\n`);
          });
        }, timeout);

        it('should reattach to a shell-tier process from its job id', async () => {
          if (sandbox.processRuntime?.processes !== 'shell' || !sandbox.attachProcess) return;
          const proc = await sandbox.startProcess(`sh -c 'echo before; sleep 2; echo after'`);
          const attached = await sandbox.attachProcess(proc.jobId);
          const result = await attached.wait({ timeout: 30000 });
          expect(result.exitCode).toBe(0);
          expect(result.stdout).toBe('before\nafter\n');
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
      throw new Error('startProcess is not supported by the mock sandbox');
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
  return runProviderTestSuite({ ...config, skipIntegration: false });
}

/**
 * Utility function to run unit tests with mocked implementations
 */
export function runUnitTests(config: ProviderTestConfig) {
  return runProviderTestSuite({ ...config, skipIntegration: true });
}
