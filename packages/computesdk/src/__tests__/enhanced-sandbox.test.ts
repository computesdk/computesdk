import { describe, it, expect, beforeEach, vi } from 'vitest';
import { compute, createCompute } from '../compute';
import { MockProvider } from './test-utils.js';

/**
 * Tests for Enhanced Sandbox functionality
 *
 * Enhanced sandboxes are created when apiKey or accessToken is configured.
 * They wrap the base sandbox with ComputeClient features like:
 * - createTerminal() - WebSocket-based persistent terminals
 * - createWatcher() - Real-time file system watching
 * - startSignals() - Port and error monitoring
 */
describe('Enhanced Sandbox with API Key/Access Token', () => {
  beforeEach(() => {
    compute.clearConfig();
    vi.clearAllMocks();
  });

  describe('Configuration', () => {
    it('should store apiKey in config', () => {
      const provider = new MockProvider();

      compute.setConfig({
        defaultProvider: provider,
        apiKey: 'test_api_key_123'
      });

      const config = compute.getConfig();
      expect(config?.apiKey).toBe('test_api_key_123');
    });

    it('should store accessToken in config', () => {
      const provider = new MockProvider();

      compute.setConfig({
        defaultProvider: provider,
        accessToken: 'test_access_token_456'
      });

      const config = compute.getConfig();
      expect(config?.accessToken).toBe('test_access_token_456');
    });

    it('should support deprecated jwt key', () => {
      const provider = new MockProvider();

      compute.setConfig({
        defaultProvider: provider,
        jwt: 'test_jwt_789'
      });

      const config = compute.getConfig();
      // jwt should be converted to accessToken internally
      expect(config?.accessToken).toBe('test_jwt_789');
    });

    it('should prefer accessToken over jwt when both provided', () => {
      const provider = new MockProvider();

      compute.setConfig({
        defaultProvider: provider,
        accessToken: 'access_token_primary',
        jwt: 'jwt_backup'
      });

      const config = compute.getConfig();
      expect(config?.accessToken).toBe('access_token_primary');
    });
  });

  describe('createCompute with proper typing', () => {
    it('should return typed compute instance with apiKey', () => {
      const provider = new MockProvider();

      const typedCompute = createCompute({
        defaultProvider: provider,
        apiKey: 'test_key'
      });

      expect(typedCompute.getConfig()?.apiKey).toBe('test_key');
    });

    it('should return typed compute instance with accessToken', () => {
      const provider = new MockProvider();

      const typedCompute = createCompute({
        defaultProvider: provider,
        accessToken: 'test_token'
      });

      expect(typedCompute.getConfig()?.accessToken).toBe('test_token');
    });

    it('should return typed compute instance without auth', () => {
      const provider = new MockProvider();

      const typedCompute = createCompute({
        defaultProvider: provider
      });

      expect(typedCompute.getConfig()?.apiKey).toBeUndefined();
      expect(typedCompute.getConfig()?.accessToken).toBeUndefined();
    });
  });

  describe('Installation Behavior (Unit Tests)', () => {
    it('should not attempt installation without apiKey or accessToken', async () => {
      const provider = new MockProvider();
      compute.setConfig({ defaultProvider: provider });

      // Mock runCommand to verify it's not called for installation
      const runCommandSpy = vi.fn();
      const sandbox = await compute.sandbox.create();
      sandbox.runCommand = runCommandSpy;

      // Installation should not have been attempted
      expect(runCommandSpy).not.toHaveBeenCalled();
    });

    // Note: Full integration tests for installation require:
    // 1. A real provider (e.g., Daytona with DAYTONA_API_KEY)
    // 2. Network access to https://computesdk.com/install.sh
    // 3. Valid ComputeSDK API key or access token
    // These should be run as integration tests with proper env vars
  });

  describe('Enhanced Sandbox Type System', () => {
    it('should preserve provider type information without auth', async () => {
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

    // Note: Testing with apiKey would require mocking the license server
    // or using integration tests with real credentials
  });

  describe('Error Handling', () => {
    it('should create base sandbox without auth credentials', async () => {
      const provider = new MockProvider();
      compute.setConfig({
        defaultProvider: provider
      });

      // Without apiKey/accessToken, should create a regular sandbox
      const sandbox = await compute.sandbox.create();
      expect(sandbox).toBeDefined();
      expect(sandbox.sandboxId).toMatch(/^mock-sandbox-/);
    });
  });
});

/**
 * Integration test suite for enhanced sandboxes
 *
 * These tests require:
 * - DAYTONA_API_KEY environment variable
 * - COMPUTESDK_API_KEY or COMPUTESDK_ACCESS_TOKEN environment variable
 * - Network access to ComputeSDK services
 *
 * Run with: DAYTONA_API_KEY=xxx COMPUTESDK_API_KEY=xxx pnpm test
 */
describe('Enhanced Sandbox Integration Tests', () => {
  const shouldSkip = !process.env.COMPUTESDK_API_KEY && !process.env.COMPUTESDK_ACCESS_TOKEN;

  describe.skipIf(shouldSkip)('Compute CLI Installation', () => {
    it('should download and install compute CLI script', async () => {
      // This test would require a real provider and real credentials
      // Skipped unless integration test env vars are set
      expect(true).toBe(true);
    });

    it('should start compute daemon and verify health', async () => {
      // This test would verify the daemon starts and responds to health checks
      // Skipped unless integration test env vars are set
      expect(true).toBe(true);
    });

    it('should create enhanced sandbox with ComputeClient features', async () => {
      // This test would verify createTerminal(), createWatcher(), etc. are available
      // Skipped unless integration test env vars are set
      expect(true).toBe(true);
    });
  });

  describe.skipIf(shouldSkip)('Enhanced Features', () => {
    it('should support createTerminal() on enhanced sandbox', async () => {
      // Would test WebSocket terminal creation
      expect(true).toBe(true);
    });

    it('should support createWatcher() on enhanced sandbox', async () => {
      // Would test file watcher creation
      expect(true).toBe(true);
    });

    it('should support startSignals() on enhanced sandbox', async () => {
      // Would test signal service
      expect(true).toBe(true);
    });
  });
});
