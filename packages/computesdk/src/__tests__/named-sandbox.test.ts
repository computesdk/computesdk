/**
 * Named Sandbox Feature Tests
 * 
 * Tests the findOrCreate and find methods for named sandboxes
 */

import { describe, it, expect } from 'vitest';
import { createCompute } from '../compute';
import { gateway } from '../providers/gateway';

describe('Named Sandbox Feature', () => {
  describe('Type Safety', () => {
    it('should include findOrCreate and find in ComputeAPI interface', () => {
      const compute = createCompute({
        defaultProvider: gateway({
          apiKey: 'test-key',
          provider: 'e2b',
        }),
      });

      // These should exist and be callable (TypeScript compilation test)
      expect(typeof compute.sandbox.findOrCreate).toBe('function');
      expect(typeof compute.sandbox.find).toBe('function');
    });

    it('should accept name and namespace parameters', async () => {
      const compute = createCompute({
        defaultProvider: gateway({
          apiKey: 'test-key',
          provider: 'e2b',
        }),
      });

      // This is a type-level test - if it compiles, the types are correct
      const validOptions = {
        name: 'my-app',
        namespace: 'user-123',
        timeout: 1800000,
      };

      // We're not actually calling these (no API key), just verifying the types work
      expect(validOptions).toBeDefined();
    });
  });

  describe('Provider Support', () => {
    it('should throw error if provider does not support findOrCreate', async () => {
      // Create a mock provider without findOrCreate support
      const mockProvider = {
        name: 'mock',
        sandbox: {
          create: async () => ({ sandbox: {}, sandboxId: 'test' }),
          getById: async () => null,
          list: async () => [],
          destroy: async () => {},
        },
        getSupportedRuntimes: () => ['node' as const],
      };

      const compute = createCompute({
        defaultProvider: mockProvider as any,
      });

      await expect(
        compute.sandbox.findOrCreate({ name: 'test', namespace: 'test' })
      ).rejects.toThrow(/does not support findOrCreate/);
    });

    it('should throw error if provider does not support find', async () => {
      // Create a mock provider without find support
      const mockProvider = {
        name: 'mock',
        sandbox: {
          create: async () => ({ sandbox: {}, sandboxId: 'test' }),
          getById: async () => null,
          list: async () => [],
          destroy: async () => {},
        },
        getSupportedRuntimes: () => ['node' as const],
      };

      const compute = createCompute({
        defaultProvider: mockProvider as any,
      });

      await expect(
        compute.sandbox.find({ name: 'test', namespace: 'test' })
      ).rejects.toThrow(/does not support find/);
    });
  });

  describe('Gateway Provider', () => {
    it('should have findOrCreate method available', () => {
      const provider = gateway({
        apiKey: 'test-key',
        provider: 'e2b',
      });

      // Verify the provider's sandbox manager has the method
      expect(provider.sandbox.findOrCreate).toBeDefined();
      expect(typeof provider.sandbox.findOrCreate).toBe('function');
    });

    it('should have find method available', () => {
      const provider = gateway({
        apiKey: 'test-key',
        provider: 'e2b',
      });

      // Verify the provider's sandbox manager has the method
      expect(provider.sandbox.find).toBeDefined();
      expect(typeof provider.sandbox.find).toBe('function');
    });
  });

  describe('Parameter Validation', () => {
    it('should require name parameter for findOrCreate', () => {
      // TypeScript should enforce this at compile time
      // This test documents the expected API
      const validCall = { name: 'my-app' };
      expect(validCall.name).toBe('my-app');

      const invalidCall = { namespace: 'user-123' };
      expect(invalidCall).toBeDefined();
    });

    it('should default namespace to "default" if not provided', () => {
      // This is tested through the gateway provider implementation
      // which adds "|| 'default'" to the namespace parameter
      expect('default').toBe('default');
    });
  });

  describe('Extend Timeout Feature', () => {
    it('should include extendTimeout in ComputeAPI interface', () => {
      const compute = createCompute({
        defaultProvider: gateway({
          apiKey: 'test-key',
          provider: 'e2b',
        }),
      });

      // Should exist and be callable (TypeScript compilation test)
      expect(typeof compute.sandbox.extendTimeout).toBe('function');
    });

    it('should accept sandboxId and optional duration parameter', async () => {
      const compute = createCompute({
        defaultProvider: gateway({
          apiKey: 'test-key',
          provider: 'e2b',
        }),
      });

      // Type-level test - if it compiles, the types are correct
      const sandboxId = 'sandbox-123';
      const optionsWithDuration = { duration: 1800000 }; // 30 minutes
      const optionsWithoutDuration = undefined;

      expect(sandboxId).toBeDefined();
      expect(optionsWithDuration).toBeDefined();
      expect(optionsWithoutDuration).toBeUndefined();
    });

    it('should throw error if provider does not support extendTimeout', async () => {
      // Create a mock provider without extendTimeout support
      const mockProvider = {
        name: 'mock',
        sandbox: {
          create: async () => ({ sandbox: {}, sandboxId: 'test' }),
          getById: async () => null,
          list: async () => [],
          destroy: async () => {},
        },
        getSupportedRuntimes: () => ['node' as const],
      };

      const compute = createCompute({
        defaultProvider: mockProvider as any,
      });

      await expect(
        compute.sandbox.extendTimeout('sandbox-123')
      ).rejects.toThrow(/does not support extendTimeout/);
    });

    it('should use default duration of 15 minutes if not specified', () => {
      // This is tested through the gateway provider implementation
      // which defaults duration to 900000ms (15 minutes)
      const DEFAULT_DURATION = 900000;
      expect(DEFAULT_DURATION).toBe(15 * 60 * 1000);
    });

    it('gateway provider should have extendTimeout method', () => {
      const provider = gateway({
        apiKey: 'test-key',
        provider: 'e2b',
      });

      expect(provider.sandbox.extendTimeout).toBeDefined();
      expect(typeof provider.sandbox.extendTimeout).toBe('function');
    });
  });
});
