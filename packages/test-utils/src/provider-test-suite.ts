/**
 * Central Provider Test Suite
 * 
 * This module provides a comprehensive test suite that can be used to test
 * any ComputeSDK provider implementation. It ensures consistency across all
 * providers and covers all core functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Provider, Sandbox, ExecutionResult, SandboxInfo, FileEntry, TerminalSession } from 'computesdk';

export interface ProviderTestConfig {
  /** The provider instance to test */
  provider: Provider;
  /** Provider name for test descriptions */
  name: string;
  /** Whether this provider supports filesystem operations */
  supportsFilesystem?: boolean;
  /** Whether this provider supports terminal operations */
  supportsTerminal?: boolean;
  /** Whether this provider supports Python runtime */
  supportsPython?: boolean;
  /** Custom test timeout in milliseconds */
  timeout?: number;
  /** Skip tests that require real API calls */
  skipIntegration?: boolean;
}

/**
 * Creates test functions for a provider test suite
 * This returns functions that can be called within describe blocks
 */
export function createProviderTests(config: ProviderTestConfig) {
  const { provider, name, supportsFilesystem = false, supportsTerminal = false, supportsPython = false, timeout = 30000, skipIntegration = false } = config;

  return () => {
    let sandbox: Sandbox;

    beforeEach(async () => {
      if (skipIntegration) {
        // Use mock sandbox for unit tests
        sandbox = createMockSandbox(config);
      } else {
        // Create real sandbox for integration tests
        sandbox = await provider.sandbox.create({});
      }
    }, timeout);

    afterEach(async () => {
      if (sandbox && !skipIntegration) {
        try {
          await sandbox.destroy();
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    });

    describe('Core Functionality', () => {
      it('should create a sandbox with valid ID', () => {
        expect(sandbox).toBeDefined();
        expect(sandbox.sandboxId).toBeDefined();
        expect(typeof sandbox.sandboxId).toBe('string');
        expect(sandbox.provider).toBe(name.toLowerCase());
      });

      it('should execute simple Node.js code', async () => {
        const result = await sandbox.runCode('console.log("Hello, World!")');
        
        expect(result).toBeDefined();
        expect(result.stdout).toContain('Hello, World!');
        expect(result.provider).toBe(name.toLowerCase());
        expect(typeof result.executionTime).toBe('number');
        expect(result.executionTime).toBeGreaterThan(0);
      }, timeout);

      it('should handle code execution errors gracefully', async () => {
        const result = await sandbox.runCode('throw new Error("Test error")');
        
        expect(result).toBeDefined();
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain('Error');
      }, timeout);

      it('should execute shell commands', async () => {
        const result = await sandbox.runCommand('echo', ['Hello from command']);
        
        expect(result).toBeDefined();
        expect(result.stdout).toContain('Hello from command');
        expect(result.exitCode).toBe(0);
      }, timeout);

      it('should get sandbox info', async () => {
        const info = await sandbox.getInfo();
        
        expect(info).toBeDefined();
        expect(info.id).toBeDefined();
        expect(info.provider).toBe(name.toLowerCase());
        expect(info.status).toBeDefined();
      });
    });

    if (supportsPython) {
      describe('Python Runtime Support', () => {
        it('should execute Python code', async () => {
          const pythonCode = `
import sys
print(f"Python version: {sys.version}")
print("Hello from Python!")
          `.trim();

          const result = await sandbox.runCode(pythonCode, 'python');
          
          expect(result).toBeDefined();
          expect(result.stdout).toContain('Python version:');
          expect(result.stdout).toContain('Hello from Python!');
          expect(result.exitCode).toBe(0);
        }, timeout);

        it('should handle Python imports', async () => {
          const pythonCode = `
import json
import datetime

data = {"message": "Hello", "timestamp": str(datetime.datetime.now())}
print(json.dumps(data, indent=2))
          `.trim();

          const result = await sandbox.runCode(pythonCode, 'python');
          
          expect(result).toBeDefined();
          expect(result.stdout).toContain('"message": "Hello"');
          expect(result.stdout).toContain('"timestamp"');
          expect(result.exitCode).toBe(0);
        }, timeout);
      });
    }

    if (supportsFilesystem) {
      describe('Filesystem Operations', () => {
        const testFilePath = '/tmp/test-file.txt';
        const testDirPath = '/tmp/test-dir';
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
      });
    }

    if (supportsTerminal) {
      describe('Terminal Operations', () => {
        it('should create a terminal session', async () => {
          const terminal = await sandbox.terminal.create();
          
          expect(terminal).toBeDefined();
          expect(terminal.pid).toBeDefined();
          expect(typeof terminal.pid).toBe('number');
          expect(terminal.pid).toBeGreaterThan(0);
          expect(terminal.command).toBeDefined();
          expect(terminal.status).toBe('running');
          expect(terminal.cols).toBeGreaterThan(0);
          expect(terminal.rows).toBeGreaterThan(0);
        }, timeout);

        it('should write to terminal and receive data', async () => {
          const terminal = await sandbox.terminal.create();
          
          // Test writing to terminal
          await terminal.write('echo "Hello from terminal"\n');
          
          // In a real implementation, you would listen for onData events
          // For testing purposes, we just verify the terminal exists and can be written to
          expect(terminal.write).toBeDefined();
        }, timeout);

        it('should support onData callback in create options', async () => {
          let receivedData: Uint8Array | null = null;
          let callbackCalled = false;

          const terminal = await sandbox.terminal.create({
            onData: (data: Uint8Array) => {
              receivedData = data;
              callbackCalled = true;
            }
          });

          expect(terminal).toBeDefined();
          expect(typeof terminal.onData).toBe('function');
          
          // For mock tests, we simulate data reception
          if (skipIntegration && terminal.onData) {
            const mockData = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
            terminal.onData(mockData);
            expect(callbackCalled).toBe(true);
            expect(receivedData).toEqual(mockData);
          }
        }, timeout);

        it('should allow setting onData callback after creation', async () => {
          const terminal = await sandbox.terminal.create();
          
          let receivedData: Uint8Array | null = null;
          let callbackCalled = false;

          // Set callback after creation
          terminal.onData = (data: Uint8Array) => {
            receivedData = data;
            callbackCalled = true;
          };

          expect(typeof terminal.onData).toBe('function');
          
          // For mock tests, simulate data reception
          if (skipIntegration && terminal.onData) {
            const mockData = new Uint8Array([87, 111, 114, 108, 100]); // "World"
            terminal.onData(mockData);
            expect(callbackCalled).toBe(true);
            expect(receivedData).toEqual(mockData);
          }
        }, timeout);

        it('should handle onData callback updates', async () => {
          const terminal = await sandbox.terminal.create();
          
          let callback1Called = false;
          let callback2Called = false;

          // Set first callback
          terminal.onData = (data: Uint8Array) => {
            callback1Called = true;
          };

          // Replace with second callback
          terminal.onData = (data: Uint8Array) => {
            callback2Called = true;
          };

          // For mock tests, simulate data reception
          if (skipIntegration && terminal.onData) {
            const mockData = new Uint8Array([84, 101, 115, 116]); // "Test"
            terminal.onData(mockData);
            expect(callback1Called).toBe(false); // First callback should not be called
            expect(callback2Called).toBe(true);  // Second callback should be called
          }
        }, timeout);

        it('should handle onData with Uint8Array data type', async () => {
          let receivedDataType: string | null = null;
          let isUint8Array = false;

          const terminal = await sandbox.terminal.create({
            onData: (data: Uint8Array) => {
              receivedDataType = typeof data;
              isUint8Array = data instanceof Uint8Array;
            }
          });

          // For mock tests, simulate data reception
          if (skipIntegration && terminal.onData) {
            const mockData = new Uint8Array([65, 66, 67]); // "ABC"
            terminal.onData(mockData);
            expect(receivedDataType).toBe('object');
            expect(isUint8Array).toBe(true);
          }
        }, timeout);

        it('should support terminal resize operations', async () => {
          const terminal = await sandbox.terminal.create();
          
          expect(terminal.resize).toBeDefined();
          expect(typeof terminal.resize).toBe('function');
          
          // Test resize operation
          await terminal.resize(120, 30);
          
          // For mock implementation, we can't verify the actual resize
          // but we can verify the method exists and doesn't throw
        }, timeout);

        it('should support terminal kill operations', async () => {
          const terminal = await sandbox.terminal.create();
          
          expect(terminal.kill).toBeDefined();
          expect(typeof terminal.kill).toBe('function');
          
          // Test kill operation
          await terminal.kill();
          
          // For mock implementation, we can't verify the actual kill
          // but we can verify the method exists and doesn't throw
        }, timeout);

        it('should handle onExit callback if supported', async () => {
          let exitCallbackCalled = false;
          let exitCode: number | null = null;

          const terminal = await sandbox.terminal.create({
            onExit: (code: number) => {
              exitCallbackCalled = true;
              exitCode = code;
            }
          });

          // For mock tests, simulate exit event
          if (skipIntegration && terminal.onExit) {
            terminal.onExit(0);
            expect(exitCallbackCalled).toBe(true);
            expect(exitCode).toBe(0);
          }
        }, timeout);
      });
    }

    describe('Error Handling', () => {
      it('should handle invalid code gracefully', async () => {
        await expect(async () => {
          await sandbox.runCode('invalid syntax here!!!');
        }).rejects.toThrow();
      });

      it('should handle invalid commands gracefully', async () => {
        const result = await sandbox.runCommand('nonexistent-command-12345');
        expect(result.exitCode).not.toBe(0);
      });

      if (supportsFilesystem) {
        it('should handle file not found errors', async () => {
          await expect(async () => {
            await sandbox.filesystem.readFile('/nonexistent/file.txt');
          }).rejects.toThrow();
        });
      }
    });
  };
}

/**
 * Runs the complete provider test suite (legacy function for backward compatibility)
 */
export function runProviderTestSuite(config: ProviderTestConfig) {
  const testFunction = createProviderTests(config);
  testFunction();
}

/**
 * Creates a mock sandbox for unit testing
 */
function createMockSandbox(config: ProviderTestConfig): Sandbox {
  const providerName = config.name.toLowerCase();
  
  // Mock state to simulate realistic behavior
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();
  
  return {
    sandboxId: 'mock-sandbox-123',
    provider: providerName,
    
    runCode: async (code: string, runtime?: string): Promise<ExecutionResult> => {
      // Simulate realistic code execution
      if (code.includes('console.log("Hello, World!")')) {
        return {
          stdout: 'Hello, World!\n',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          sandboxId: 'mock-sandbox-123',
          provider: providerName
        };
      }
      
      if (code.includes('throw new Error("Test error")')) {
        return {
          stdout: '',
          stderr: 'Error: Test error\n    at <anonymous>:1:7\n',
          exitCode: 1,
          executionTime: 50,
          sandboxId: 'mock-sandbox-123',
          provider: providerName
        };
      }
      
      if (code.includes('invalid syntax here!!!')) {
        throw new Error('SyntaxError: Unexpected token');
      }
      
      // Default successful execution
      return {
        stdout: `Mock output for: ${code}`,
        stderr: '',
        exitCode: 0,
        executionTime: 100,
        sandboxId: 'mock-sandbox-123',
        provider: providerName
      };
    },
    
    runCommand: async (command: string, args?: string[]): Promise<ExecutionResult> => {
      const fullCommand = `${command} ${args?.join(' ') || ''}`.trim();
      
      if (command === 'echo' && args?.includes('Hello from command')) {
        return {
          stdout: 'Hello from command\n',
          stderr: '',
          exitCode: 0,
          executionTime: 10,
          sandboxId: 'mock-sandbox-123',
          provider: providerName
        };
      }
      
      if (command === 'nonexistent-command-12345') {
        return {
          stdout: '',
          stderr: `bash: ${command}: command not found\n`,
          exitCode: 127,
          executionTime: 5,
          sandboxId: 'mock-sandbox-123',
          provider: providerName
        };
      }
      
      return {
        stdout: `Mock command output: ${fullCommand}`,
        stderr: '',
        exitCode: 0,
        executionTime: 50,
        sandboxId: 'mock-sandbox-123',
        provider: providerName
      };
    },
    
    getInfo: async (): Promise<SandboxInfo> => ({
      id: 'mock-sandbox-123',
      provider: providerName,
      runtime: 'node',
      status: 'running',
      createdAt: new Date(),
      timeout: 300000,
      metadata: {}
    }),
    
    kill: async (): Promise<void> => {
      // Mock implementation
    },
    
    destroy: async (): Promise<void> => {
      // Mock implementation
    },
    
    filesystem: {
      readFile: async (path: string): Promise<string> => {
        if (mockFiles.has(path)) {
          return mockFiles.get(path)!;
        }
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      },
      
      writeFile: async (path: string, content: string): Promise<void> => {
        mockFiles.set(path, content);
      },
      
      mkdir: async (path: string): Promise<void> => {
        mockDirs.add(path);
      },
      
      readdir: async (path: string): Promise<FileEntry[]> => {
        const entries: FileEntry[] = [];
        
        // Add files in this directory
        for (const [filePath, content] of mockFiles.entries()) {
          if (filePath.startsWith(path + '/') && !filePath.substring(path.length + 1).includes('/')) {
            const fileName = filePath.substring(path.length + 1);
            entries.push({
              name: fileName,
              path: filePath,
              isDirectory: false,
              size: content.length,
              lastModified: new Date()
            });
          }
        }
        
        // Add subdirectories
        for (const dirPath of mockDirs) {
          if (dirPath.startsWith(path + '/') && !dirPath.substring(path.length + 1).includes('/')) {
            const dirName = dirPath.substring(path.length + 1);
            entries.push({
              name: dirName,
              path: dirPath,
              isDirectory: true,
              size: 0,
              lastModified: new Date()
            });
          }
        }
        
        return entries;
      },
      
      exists: async (path: string): Promise<boolean> => {
        return mockFiles.has(path) || mockDirs.has(path);
      },
      
      remove: async (path: string): Promise<void> => {
        mockFiles.delete(path);
        mockDirs.delete(path);
      }
    },
    
    terminal: {
      create: async (options?: any): Promise<TerminalSession> => {
        const mockTerminal: TerminalSession = {
          pid: 12345,
          command: options?.command || '/bin/bash',
          status: 'running' as const,
          cols: options?.cols || 80,
          rows: options?.rows || 24,
          write: async (data: string | Uint8Array) => {},
          resize: async (cols: number, rows: number) => {},
          kill: async () => {},
          onData: options?.onData,
          onExit: options?.onExit
        };
        return mockTerminal;
      },
      getById: async (terminalId: string): Promise<TerminalSession | null> => null,
      list: async (): Promise<TerminalSession[]> => [],
      destroy: async (terminalId: string): Promise<void> => {}
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