/**
 * Callable Compute Tests
 *
 * Tests for the callable compute pattern where compute works as both
 * a singleton and a function.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { compute } from '../compute';
import { createProviderFromConfig } from '../explicit-config';
import type { ExplicitComputeConfig } from '../types';

describe('Callable Compute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    compute.clearConfig();
    // Reset autoConfigured flag
    (compute as any).autoConfigured = false;
    // Stub env vars to prevent auto-configuration
    vi.stubEnv('COMPUTESDK_API_KEY', '');
    vi.stubEnv('E2B_API_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('Singleton mode (compute.sandbox.*)', () => {
    it('should have sandbox property', () => {
      expect(compute.sandbox).toBeDefined();
      expect(typeof compute.sandbox.create).toBe('function');
      expect(typeof compute.sandbox.getById).toBe('function');
      expect(typeof compute.sandbox.list).toBe('function');
      expect(typeof compute.sandbox.destroy).toBe('function');
    });

    it('should have config methods', () => {
      expect(typeof compute.setConfig).toBe('function');
      expect(typeof compute.getConfig).toBe('function');
      expect(typeof compute.clearConfig).toBe('function');
    });

    it('should get/set/clear config correctly', () => {
      expect(compute.getConfig()).toBeNull();

      // Create a minimal mock provider
      const mockProvider = {
        name: 'mock',
        sandbox: {
          create: vi.fn(),
          getById: vi.fn(),
          list: vi.fn(),
          destroy: vi.fn(),
        },
        getSupportedRuntimes: () => ['node' as const],
      };

      compute.setConfig({ provider: mockProvider });
      expect(compute.getConfig()).not.toBeNull();
      expect(compute.getConfig()?.provider?.name).toBe('mock');

      compute.clearConfig();
      expect(compute.getConfig()).toBeNull();
    });
  });

  describe('Callable mode (compute({...}))', () => {
    it('should be callable as a function', () => {
      expect(typeof compute).toBe('function');
    });

    it('should return a ComputeAPI instance when called', () => {
      const config: ExplicitComputeConfig = {
        provider: 'e2b',
        apiKey: 'test-computesdk-key',
        e2b: { apiKey: 'test-e2b-key' },
      };

      const instance = compute(config);

      expect(instance).toBeDefined();
      expect(instance.sandbox).toBeDefined();
      expect(typeof instance.sandbox.create).toBe('function');
    });

    it('should return a new instance each time', () => {
      const config: ExplicitComputeConfig = {
        provider: 'e2b',
        apiKey: 'test-computesdk-key',
        e2b: { apiKey: 'test-e2b-key' },
      };

      const instance1 = compute(config);
      const instance2 = compute(config);

      expect(instance1).not.toBe(instance2);
    });

    it('should not affect the singleton when called', () => {
      // Singleton should have no config
      expect(compute.getConfig()).toBeNull();

      const config: ExplicitComputeConfig = {
        provider: 'e2b',
        apiKey: 'test-computesdk-key',
        e2b: { apiKey: 'test-e2b-key' },
      };

      // Call compute as function
      const instance = compute(config);
      expect(instance).toBeDefined();

      // Singleton should still have no config
      expect(compute.getConfig()).toBeNull();
    });
  });

  describe('createProviderFromConfig', () => {
    it('should throw if apiKey is missing', () => {
      const config = {
        provider: 'e2b',
        e2b: { apiKey: 'test-e2b-key' },
      } as ExplicitComputeConfig;

      expect(() => createProviderFromConfig(config)).toThrow(
        /Missing ComputeSDK API key/
      );
    });

    it('should throw if e2b.apiKey is missing for e2b provider', () => {
      const config: ExplicitComputeConfig = {
        provider: 'e2b',
        apiKey: 'test-computesdk-key',
        e2b: {},
      };

      expect(() => createProviderFromConfig(config)).toThrow(
        /Missing E2B configuration/
      );
    });

    it('should throw if modal credentials are missing for modal provider', () => {
      const config: ExplicitComputeConfig = {
        provider: 'modal',
        apiKey: 'test-computesdk-key',
        modal: { tokenId: 'only-id' },
      };

      expect(() => createProviderFromConfig(config)).toThrow(
        /Missing Modal configuration/
      );
    });

    it('should throw if railway.apiToken is missing for railway provider', () => {
      const config: ExplicitComputeConfig = {
        provider: 'railway',
        apiKey: 'test-computesdk-key',
        railway: {},
      };

      expect(() => createProviderFromConfig(config)).toThrow(
        /Missing Railway configuration/
      );
    });

    it('should create a gateway provider with correct config for e2b', () => {
      const config: ExplicitComputeConfig = {
        provider: 'e2b',
        apiKey: 'test-computesdk-key',
        e2b: { apiKey: 'test-e2b-key' },
      };

      const provider = createProviderFromConfig(config);

      expect(provider).toBeDefined();
      expect(provider.name).toBe('gateway');
    });

    it('should create a gateway provider with correct config for modal', () => {
      const config: ExplicitComputeConfig = {
        provider: 'modal',
        apiKey: 'test-computesdk-key',
        modal: { tokenId: 'test-id', tokenSecret: 'test-secret' },
      };

      const provider = createProviderFromConfig(config);

      expect(provider).toBeDefined();
      expect(provider.name).toBe('gateway');
    });

    it('should create a gateway provider with correct config for railway', () => {
      const config: ExplicitComputeConfig = {
        provider: 'railway',
        apiKey: 'test-computesdk-key',
        railway: { apiToken: 'test-railway-token' },
      };

      const provider = createProviderFromConfig(config);

      expect(provider).toBeDefined();
      expect(provider.name).toBe('gateway');
    });
  });

  describe('Type safety', () => {
    it('should accept valid ExplicitComputeConfig', () => {
      // This is a compile-time check - if this compiles, types are correct
      const validConfig: ExplicitComputeConfig = {
        provider: 'e2b',
        apiKey: 'computesdk-key',
        e2b: {
          apiKey: 'e2b-key',
          projectId: 'my-project',
          templateId: 'my-template',
        },
      };

      expect(validConfig.provider).toBe('e2b');
    });

    it('should support all provider config shapes', () => {
      const e2bConfig: ExplicitComputeConfig = {
        provider: 'e2b',
        apiKey: 'key',
        e2b: { apiKey: 'k', projectId: 'p', templateId: 't' },
      };

      const modalConfig: ExplicitComputeConfig = {
        provider: 'modal',
        apiKey: 'key',
        modal: { tokenId: 'id', tokenSecret: 'secret' },
      };

      const railwayConfig: ExplicitComputeConfig = {
        provider: 'railway',
        apiKey: 'key',
        railway: { apiToken: 'token' },
      };

      expect(e2bConfig.provider).toBe('e2b');
      expect(modalConfig.provider).toBe('modal');
      expect(railwayConfig.provider).toBe('railway');
    });
  });
});
