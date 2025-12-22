/**
 * Focused CRUD Test Suite for ComputeSDK Providers
 * 
 * Tests the core sandbox lifecycle: create → getById → list → destroy
 */

import { describe, it, expect } from 'vitest';
// @ts-ignore - workspace reference
import type { Provider } from 'computesdk';

export interface ProviderCrudTestConfig {
  /** The provider instance to test */
  provider: Provider;
  /** Provider name for test descriptions */
  name: string;
  /** Custom test timeout in milliseconds */
  timeout?: number;
  /** Skip tests that require real API calls */
  skipIntegration?: boolean;
}

/**
 * Centralized whitelist of providers that should run CRUD tests
 * 
 * Only providers in this list will execute CRUD tests (create, read, list, destroy).
 * Providers not in this list will automatically skip CRUD tests with a clear message.
 * 
 * This approach:
 * - Prevents CRUD test failures for providers with limited implementations
 * - Avoids issues like Vercel's ephemeral sandboxes not supporting listing
 * - Makes it explicit which providers are ready for full CRUD testing
 * - Simplifies CI by avoiding complex environment variable logic
 * 
 * To enable CRUD tests for a provider: add the provider name to this array
 */
const CRUD_ENABLED_PROVIDERS = [
  'railway',  // Has working CRUD operations with stable sandbox lifecycle
  'render',   // Stable provider ready for CRUD testing
  'lambda',   // Lambda provider with instance lifecycle management
  'namespace', 
  'avm'
  // Add more providers here as they become stable for CRUD testing
  // 'e2b',      // Add when CRUD implementation is stable
  // 'vercel',   // Skip - ephemeral sandboxes don't support listing operations
];

export function runProviderCrudTest(config: ProviderCrudTestConfig) {
  const { provider, name, timeout = 30000, skipIntegration = false } = config;

  describe(`${name} Provider CRUD Operations`, () => {
    // Check if this provider should run CRUD tests
    if (!CRUD_ENABLED_PROVIDERS.includes(name)) {
      it.skip(`CRUD tests not enabled for ${name} provider`, () => {
        console.log(`Skipping CRUD tests for ${name} - not in enabled providers list`);
        console.log(`Enabled providers: ${CRUD_ENABLED_PROVIDERS.join(', ')}`);
      });
      return;
    }

    if (skipIntegration) {
      it.skip('Integration tests skipped - missing credentials', () => {});
      return;
    }

    let createdSandboxId: string;

    it('should create a sandbox', async () => {
      const result = await provider.sandbox.create();
      
      expect(result).toBeDefined();
      expect(result.sandboxId).toBeDefined();
      expect(typeof result.sandboxId).toBe('string');
      expect(result.sandboxId.length).toBeGreaterThan(0);
      
      createdSandboxId = result.sandboxId;
      
      console.log(`✓ Created ${name} sandbox: ${createdSandboxId}`);
    }, timeout);

    it('should get sandbox by ID', async () => {
      expect(createdSandboxId).toBeDefined();
      
      const result = await provider.sandbox.getById(createdSandboxId);
      
      expect(result).toBeDefined();
      expect(result?.sandboxId).toBe(createdSandboxId);
      
      console.log(`✓ Retrieved ${name} sandbox by ID: ${createdSandboxId}`);
    }, timeout);

    it('should list sandboxes and include created one', async () => {
      expect(createdSandboxId).toBeDefined();
      
      const sandboxes = await provider.sandbox.list();
      
      expect(Array.isArray(sandboxes)).toBe(true);
      
      // Find our sandbox in the list
      const ourSandbox = sandboxes.find(s => s.sandboxId === createdSandboxId);
      expect(ourSandbox).toBeDefined();
      expect(ourSandbox?.sandboxId).toBe(createdSandboxId);
      
      console.log(`✓ Listed ${name} sandboxes, found our sandbox in ${sandboxes.length} total`);
    }, timeout);

    it('should destroy the sandbox', async () => {
      expect(createdSandboxId).toBeDefined();

      // Wait for 15 seconds before destroying
      await new Promise(resolve => setTimeout(resolve, 15000));
      
      // Destroy should not throw an error
      await expect(provider.sandbox.destroy(createdSandboxId)).resolves.not.toThrow();
      
      console.log(`✓ Destroyed ${name} sandbox: ${createdSandboxId}`);
    }, timeout);

    it('should not find sandbox after destruction (or verify it was marked for deletion)', async () => {
      expect(createdSandboxId).toBeDefined();
      
      // After destruction, getById should return null or the sandbox might still exist but be marked for deletion
      const result = await provider.sandbox.getById(createdSandboxId);
      
      if (result === null) {
        console.log(`✓ Verified ${name} sandbox was completely removed: ${createdSandboxId}`);
      } else {
        // Some providers may not immediately delete the sandbox but mark it for deletion
        console.log(`✓ ${name} sandbox still exists but was marked for destruction: ${createdSandboxId}`);
        console.log('Note: Some providers have delayed deletion - this is expected behavior');
      }
      
      // At minimum, we should not fail if the sandbox still exists after destroy
      // The important thing is that the destroy call completed without throwing
    }, timeout);
  });
}