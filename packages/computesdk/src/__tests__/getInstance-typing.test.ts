/**
 * Tests for getInstance() typing with providers
 * 
 * This test ensures that getInstance() returns the correct type when using
 * createCompute() with a typed provider.
 */

import { describe, it, expect } from 'vitest';
import { createCompute } from '../compute';
import { createProvider } from '../factory';

describe('getInstance() typing', () => {
  it('should correctly type getInstance() return value with createProvider', async () => {
    // Create a mock provider with a specific instance type
    interface MockInstance {
      mockId: string;
      mockMethod(): string;
    }

    const providerFactory = createProvider<MockInstance, {}>({
      name: 'mock-typed',
      methods: {
        sandbox: {
          create: async () => ({
            sandbox: {
              mockId: 'test-123',
              mockMethod: () => 'mock-result'
            },
            sandboxId: 'test-id'
          }),
          getById: async () => null,
          list: async () => [],
          destroy: async () => {},
          runCode: async () => ({ output: '', exitCode: 0, language: 'node' as const }),
          runCommand: async () => ({ stdout: '', stderr: '', exitCode: 0, durationMs: 0 }),
          getInfo: async () => ({
            id: 'test',
            provider: 'mock-typed',
            runtime: 'node' as const,
            status: 'running' as const,
            createdAt: new Date(),
            timeout: 0
          }),
          getUrl: async () => 'https://test.com',
          getInstance: (sandbox: MockInstance) => sandbox,
        }
      }
    });

    const provider = providerFactory({});
    const compute = createCompute({ defaultProvider: provider });

    const sandbox = await compute.sandbox.create();
    const instance = sandbox.getInstance();

    // TypeScript should know that instance is MockInstance
    // These should compile without errors and work at runtime
    expect(instance.mockId).toBe('test-123');
    expect(instance.mockMethod()).toBe('mock-result');
  });

  it('should work with untyped compute (zero-config mode)', async () => {
    // In zero-config mode, getInstance() returns unknown which is expected
    interface MockInstance {
      mockId: string;
    }

    const providerFactory = createProvider<MockInstance, {}>({
      name: 'mock-untyped',
      methods: {
        sandbox: {
          create: async () => ({
            sandbox: { mockId: 'test-456' },
            sandboxId: 'test-id-2'
          }),
          getById: async () => null,
          list: async () => [],
          destroy: async () => {},
          runCode: async () => ({ output: '', exitCode: 0, language: 'node' as const }),
          runCommand: async () => ({ stdout: '', stderr: '', exitCode: 0, durationMs: 0 }),
          getInfo: async () => ({
            id: 'test',
            provider: 'mock-untyped',
            runtime: 'node' as const,
            status: 'running' as const,
            createdAt: new Date(),
            timeout: 0
          }),
          getUrl: async () => 'https://test.com',
          getInstance: (sandbox: MockInstance) => sandbox,
        }
      }
    });

    const provider = providerFactory({});
    const compute = createCompute();
    compute.setConfig({ defaultProvider: provider });

    const sandbox = await compute.sandbox.create();
    const instance = sandbox.getInstance();

    // In zero-config mode, we need to cast because getInstance() returns unknown
    expect((instance as MockInstance).mockId).toBe('test-456');
  });
});
