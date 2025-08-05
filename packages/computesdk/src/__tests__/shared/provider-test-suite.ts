import { describe, it, expect } from 'vitest';
import type { 
  FilesystemComputeSpecification, 
  FilesystemComputeSandbox,
  FileEntry,
  Runtime
} from '../../types';

/**
 * Shared test suite that all ComputeSDK providers must pass.
 * This ensures consistency and quality across all provider implementations.
 */
export interface ProviderTestConfig {
  /** The provider instance to test */
  provider: FilesystemComputeSpecification & FilesystemComputeSandbox;
  
  /** Provider-specific test configuration */
  config: {
    /** Expected provider name */
    providerName: string;
    
    /** Supported runtimes for this provider */
    supportedRuntimes: Runtime[];
    
    /** Sample code that should execute successfully for each runtime */
    sampleCode: Record<Runtime, { code: string; expectedOutput: string }>;
    
    /** Whether this provider supports filesystem operations */
    supportsFilesystem: boolean;
    
    /** Whether this provider supports terminal operations */
    supportsTerminal?: boolean;
    
    /** Custom timeout for slow operations (optional) */
    timeout?: number;
  };
}

/**
 * Runs the complete provider test suite.
 * Call this function in each provider's test file.
 */
export function runProviderTestSuite(testConfig: ProviderTestConfig) {
  const { provider, config } = testConfig;

  describe(`${config.providerName} Provider Test Suite`, () => {
    
    describe('Core Provider Interface', () => {
      it('should have correct provider metadata', () => {
        expect(provider.provider).toBe(config.providerName);
        expect(provider.specificationVersion).toBe('v1');
        expect(provider.sandboxId).toBeDefined();
        expect(typeof provider.sandboxId).toBe('string');
        expect(provider.sandboxId.length).toBeGreaterThan(0);
      });

      it('should implement required methods', () => {
        expect(typeof provider.doExecute).toBe('function');
        expect(typeof provider.doKill).toBe('function');
        expect(typeof provider.doGetInfo).toBe('function');
        expect(typeof provider.execute).toBe('function');
        expect(typeof provider.kill).toBe('function');
        expect(typeof provider.getInfo).toBe('function');
      });

      if (config.supportsFilesystem) {
        it('should have filesystem interface', () => {
          expect(provider.filesystem).toBeDefined();
          expect(typeof provider.filesystem.readFile).toBe('function');
          expect(typeof provider.filesystem.writeFile).toBe('function');
          expect(typeof provider.filesystem.mkdir).toBe('function');
          expect(typeof provider.filesystem.readdir).toBe('function');
          expect(typeof provider.filesystem.exists).toBe('function');
          expect(typeof provider.filesystem.remove).toBe('function');
        });
      }
    });

    describe('Code Execution', () => {
      for (const runtime of config.supportedRuntimes) {
        const sample = config.sampleCode[runtime];
        if (!sample) continue;

        it(`should execute ${runtime} code successfully`, async () => {
          const result = await provider.doExecute(sample.code, runtime);
          
          expect(result).toBeDefined();
          expect(typeof result).toBe('object');
          expect(result.stdout).toBe(sample.expectedOutput);
          expect(result.stderr).toBe('');
          expect(result.exitCode).toBe(0);
          expect(result.provider).toBe(config.providerName);
          expect(result.sandboxId).toBe(provider.sandboxId);
          expect(typeof result.executionTime).toBe('number');
          expect(result.executionTime).toBeGreaterThanOrEqual(0);
        }, config.timeout);

        it(`should handle ${runtime} execution errors`, async () => {
          const errorCode = runtime === 'python' 
            ? 'raise Exception("Test error")'
            : 'throw new Error("Test error")';
            
          const result = await provider.doExecute(errorCode, runtime);
          
          expect(result.exitCode).toBeGreaterThan(0);
          expect(result.stderr.length).toBeGreaterThan(0);
          expect(result.provider).toBe(config.providerName);
        }, config.timeout);
      }

      it('should return consistent ExecutionResult format', async () => {
        const runtime = config.supportedRuntimes[0];
        const sample = config.sampleCode[runtime];
        
        const result = await provider.doExecute(sample.code, runtime);
        
        // Verify all required fields are present
        expect(result).toHaveProperty('stdout');
        expect(result).toHaveProperty('stderr');
        expect(result).toHaveProperty('exitCode');
        expect(result).toHaveProperty('executionTime');
        expect(result).toHaveProperty('sandboxId');
        expect(result).toHaveProperty('provider');
        
        // Verify field types
        expect(typeof result.stdout).toBe('string');
        expect(typeof result.stderr).toBe('string');
        expect(typeof result.exitCode).toBe('number');
        expect(typeof result.executionTime).toBe('number');
        expect(typeof result.sandboxId).toBe('string');
        expect(typeof result.provider).toBe('string');
      }, config.timeout);
    });

    describe('Sandbox Management', () => {
      it('should provide sandbox information', async () => {
        const info = await provider.doGetInfo();
        
        expect(info).toBeDefined();
        expect(info.id).toBe(provider.sandboxId);
        expect(info.provider).toBe(config.providerName);
        expect(info.runtime).toBeDefined();
        expect(['running', 'stopped', 'starting'].includes(info.status)).toBe(true);
        expect(info.createdAt).toBeInstanceOf(Date);
        expect(typeof info.timeout).toBe('number');
        expect(info.metadata).toBeDefined();
        expect(typeof info.metadata).toBe('object');
      }, config.timeout);

      it('should handle sandbox termination', async () => {
        // Execute something first to ensure sandbox is active
        const runtime = config.supportedRuntimes[0];
        const sample = config.sampleCode[runtime];
        await provider.doExecute(sample.code, runtime);
        
        // Should not throw when killing
        await expect(provider.doKill()).resolves.not.toThrow();
      }, config.timeout);

      it('should handle multiple kill calls gracefully', async () => {
        await provider.doKill();
        await expect(provider.doKill()).resolves.not.toThrow();
      }, config.timeout);
    });

    if (config.supportsFilesystem) {
      describe('Filesystem Operations', () => {
        const testFilePath = '/test-file.txt';
        const testDirPath = '/test-dir';
        const testContent = 'Hello, ComputeSDK Test Suite!';

        it('should write and read files', async () => {
          await provider.filesystem.writeFile(testFilePath, testContent);
          const content = await provider.filesystem.readFile(testFilePath);
          
          expect(content).toBe(testContent);
        }, config.timeout);

        it('should check file existence', async () => {
          await provider.filesystem.writeFile(testFilePath, testContent);
          
          const exists = await provider.filesystem.exists(testFilePath);
          const notExists = await provider.filesystem.exists('/nonexistent-file.txt');
          
          expect(exists).toBe(true);
          expect(notExists).toBe(false);
        }, config.timeout);

        it('should create directories', async () => {
          await provider.filesystem.mkdir(testDirPath);
          const exists = await provider.filesystem.exists(testDirPath);
          
          expect(exists).toBe(true);
        }, config.timeout);

        it('should list directory contents', async () => {
          // Create test structure
          await provider.filesystem.mkdir(testDirPath);
          await provider.filesystem.writeFile(`${testDirPath}/file1.txt`, 'content1');
          await provider.filesystem.writeFile(`${testDirPath}/file2.txt`, 'content2');
          
          const entries = await provider.filesystem.readdir(testDirPath);
          
          expect(Array.isArray(entries)).toBe(true);
          expect(entries.length).toBeGreaterThanOrEqual(2);
          
          // Check entry structure
          entries.forEach((entry: FileEntry) => {
            expect(entry).toHaveProperty('name');
            expect(entry).toHaveProperty('path');
            expect(entry).toHaveProperty('isDirectory');
            expect(entry).toHaveProperty('size');
            expect(entry).toHaveProperty('lastModified');
            
            expect(typeof entry.name).toBe('string');
            expect(typeof entry.path).toBe('string');
            expect(typeof entry.isDirectory).toBe('boolean');
            expect(typeof entry.size).toBe('number');
            expect(entry.lastModified).toBeInstanceOf(Date);
          });
        }, config.timeout);

        it('should remove files and directories', async () => {
          // Create test file
          await provider.filesystem.writeFile(testFilePath, testContent);
          expect(await provider.filesystem.exists(testFilePath)).toBe(true);
          
          // Remove file
          await provider.filesystem.remove(testFilePath);
          expect(await provider.filesystem.exists(testFilePath)).toBe(false);
          
          // Create and remove directory
          await provider.filesystem.mkdir(testDirPath);
          expect(await provider.filesystem.exists(testDirPath)).toBe(true);
          
          await provider.filesystem.remove(testDirPath);
          expect(await provider.filesystem.exists(testDirPath)).toBe(false);
        }, config.timeout);

        describe('Filesystem Error Handling', () => {
          it('should handle read errors for nonexistent files', async () => {
            await expect(provider.filesystem.readFile('/nonexistent-file.txt'))
              .rejects.toThrow();
          }, config.timeout);

          it('should handle readdir errors for nonexistent directories', async () => {
            await expect(provider.filesystem.readdir('/nonexistent-directory'))
              .rejects.toThrow();
          }, config.timeout);

          it('should handle remove errors for nonexistent paths', async () => {
            // This should either succeed (idempotent) or throw a meaningful error
            // Different providers may handle this differently
            try {
              await provider.filesystem.remove('/nonexistent-path');
            } catch (error) {
              expect(error).toBeInstanceOf(Error);
              expect((error as Error).message.length).toBeGreaterThan(0);
            }
          }, config.timeout);
        });
      });
    }

    describe('Runtime Support', () => {
      it('should support all declared runtimes', () => {
        expect(config.supportedRuntimes.length).toBeGreaterThan(0);
        
        for (const runtime of config.supportedRuntimes) {
          expect(['node', 'python', 'bash'].includes(runtime)).toBe(true);
          expect(config.sampleCode[runtime]).toBeDefined();
          expect(config.sampleCode[runtime].code).toBeDefined();
          expect(config.sampleCode[runtime].expectedOutput).toBeDefined();
        }
      });

      it('should reject unsupported runtimes', async () => {
        const unsupportedRuntimes: Runtime[] = ['node', 'python', 'bash']
          .filter(r => !config.supportedRuntimes.includes(r as Runtime)) as Runtime[];
        
        if (unsupportedRuntimes.length > 0) {
          const unsupportedRuntime = unsupportedRuntimes[0];
          await expect(provider.doExecute('test', unsupportedRuntime))
            .rejects.toThrow();
        }
      }, config.timeout);
    });

    describe('Concurrent Operations', () => {
      it('should handle concurrent executions', async () => {
        const runtime = config.supportedRuntimes[0];
        const sample = config.sampleCode[runtime];
        
        const promises = Array.from({ length: 3 }, () => 
          provider.doExecute(sample.code, runtime)
        );
        
        const results = await Promise.all(promises);
        
        results.forEach(result => {
          expect(result.stdout).toBe(sample.expectedOutput);
          expect(result.exitCode).toBe(0);
        });
      }, config.timeout ? config.timeout * 2 : undefined);

      if (config.supportsFilesystem) {
        it('should handle concurrent filesystem operations', async () => {
          const promises = Array.from({ length: 3 }, (_, i) => 
            provider.filesystem.writeFile(`/concurrent-test-${i}.txt`, `content-${i}`)
          );
          
          await Promise.all(promises);
          
          // Verify all files were created
          for (let i = 0; i < 3; i++) {
            const exists = await provider.filesystem.exists(`/concurrent-test-${i}.txt`);
            expect(exists).toBe(true);
            
            const content = await provider.filesystem.readFile(`/concurrent-test-${i}.txt`);
            expect(content).toBe(`content-${i}`);
          }
        }, config.timeout ? config.timeout * 2 : undefined);
      }
    });
  });
}