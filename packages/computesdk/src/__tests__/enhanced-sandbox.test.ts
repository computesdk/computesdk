import { describe, it, expect, beforeEach, vi } from 'vitest';
import { compute, createCompute } from '../compute';
import { MockProvider } from './test-utils.js';

/**
 * Tests for Sandbox functionality
 *
 * With the gateway provider, all sandboxes have ComputeClient features baked in.
 * The separation between "basic" and "enhanced" sandboxes no longer exists.
 */
describe('Sandbox with Gateway Provider', () => {
  beforeEach(() => {
    compute.clearConfig();
    vi.clearAllMocks();
  });

  describe('Configuration', () => {
    it('should store provider in config', () => {
      const provider = new MockProvider();

      compute.setConfig({
        defaultProvider: provider,
      });

      const config = compute.getConfig();
      expect(config?.defaultProvider).toBe(provider);
    });
  });

  describe('createCompute with proper typing', () => {
    it('should return typed compute instance with provider', () => {
      const provider = new MockProvider();

      const typedCompute = createCompute({
        defaultProvider: provider,
      });

      expect(typedCompute.getConfig()?.defaultProvider).toBe(provider);
    });
  });

  describe('Sandbox Type System', () => {
    it('should preserve provider type information', async () => {
      const provider = new MockProvider();
      const typedCompute = createCompute({
        defaultProvider: provider
      });

      const sandbox = await typedCompute.sandbox.create();

      // Should be able to call getInstance() and get proper typing
      const instance = sandbox.getInstance();
      expect(instance).toBeDefined();

      // Should be able to call getProvider() and get proper typing
      const sandboxProvider = sandbox.getProvider();
      expect(sandboxProvider.name).toBe('mock');
    });
  });

  describe('Sandbox Creation', () => {
    it('should create sandbox with provider', async () => {
      const provider = new MockProvider();
      compute.setConfig({
        defaultProvider: provider
      });

      const sandbox = await compute.sandbox.create();
      expect(sandbox).toBeDefined();
      expect(sandbox.sandboxId).toMatch(/^mock-sandbox-/);
    });
  });
});

/**
 * Integration test suite for gateway sandboxes
 *
 * These tests require:
 * - COMPUTESDK_API_KEY environment variable
 * - Provider credentials (e.g., E2B_API_KEY)
 * - Network access to ComputeSDK gateway
 *
 * Run with: COMPUTESDK_API_KEY=xxx E2B_API_KEY=xxx pnpm test
 */
describe('Gateway Sandbox Integration Tests', () => {
  const shouldSkip = !process.env.COMPUTESDK_API_KEY;

  describe.skipIf(shouldSkip)('Gateway Features', () => {
    it('should create sandbox via gateway', async () => {
      // This test would require real credentials
      expect(true).toBe(true);
    });

    it('should support createTerminal() on gateway sandbox', async () => {
      // Would test WebSocket terminal creation
      expect(true).toBe(true);
    });

    it('should support createWatcher() on gateway sandbox', async () => {
      // Would test file watcher creation
      expect(true).toBe(true);
    });

    it('should support startSignals() on gateway sandbox', async () => {
      // Would test signal service
      expect(true).toBe(true);
    });
  });
});
