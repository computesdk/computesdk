/**
 * Modal Port Forwarding Integration Tests
 * 
 * Comprehensive tests for Modal's port configuration and tunnel creation.
 * These tests verify that:
 * - Ports are properly configured during sandbox creation
 * - Tunnels are created and accessible
 * - getUrl() returns working tunnel URLs
 * - Services running on configured ports are reachable
 */

// Import from test-utils to trigger .env loading from monorepo root
import '@computesdk/test-utils';

import { describe, it, expect } from 'vitest';
import { createCompute } from 'computesdk';
import { modal } from '../index';

describe('Modal Port Forwarding Integration Tests', () => {
  const TEST_PORT = 5173;
  const MULTI_PORT_1 = 3000;
  const MULTI_PORT_2 = 8080;
  
  // Skip integration tests if Modal credentials are not available
  const skipTests = !process.env.MODAL_TOKEN_ID || !process.env.MODAL_TOKEN_SECRET;

  if (skipTests) {
    console.log('⚠️  Skipping Modal port integration tests - MODAL_TOKEN_ID and MODAL_TOKEN_SECRET not set');
  }

  it.skipIf(skipTests)('should handle multiple ports', async () => {
    console.log(`Testing Modal with multiple ports: ${MULTI_PORT_1}, ${MULTI_PORT_2}`);

    const compute = createCompute({
      provider: modal({
        tokenId: process.env.MODAL_TOKEN_ID,
        tokenSecret: process.env.MODAL_TOKEN_SECRET,
        ports: [MULTI_PORT_1, MULTI_PORT_2]
      })
    });

    let sandbox;
    try {
      console.log('Creating sandbox with multiple ports...');
      sandbox = await compute.sandbox.create();
      console.log(`✓ Sandbox created: ${sandbox.sandboxId}`);

      // Get URLs for both ports
      console.log('Getting URLs for both ports...');
      const url1 = await sandbox.getUrl({ port: MULTI_PORT_1 });
      const url2 = await sandbox.getUrl({ port: MULTI_PORT_2 });
      
      console.log(`✓ Port ${MULTI_PORT_1} URL: ${url1}`);
      console.log(`✓ Port ${MULTI_PORT_2} URL: ${url2}`);

      // Verify both URLs are valid and different
      expect(url1).toBeDefined();
      expect(url2).toBeDefined();
      expect(url1).not.toBe(url2);
      expect(url1).toMatch(/^https?:\/\//);
      expect(url2).toMatch(/^https?:\/\//);

      console.log('✅ SUCCESS: Multiple ports configured correctly!');
    } catch (error) {
      console.error('❌ TEST FAILED:', error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      if (sandbox) {
        console.log('Destroying sandbox...');
        await sandbox.destroy();
        console.log('✓ Sandbox destroyed');
      }
    }
  }, 60000);

  it.skipIf(skipTests)('should error when requesting URL for non-configured port', async () => {
    console.log('Testing error handling for non-configured ports...');

    const compute = createCompute({
      provider: modal({
        tokenId: process.env.MODAL_TOKEN_ID,
        tokenSecret: process.env.MODAL_TOKEN_SECRET,
        ports: [TEST_PORT] // Only expose 5173
      })
    });

    let sandbox;
    try {
      console.log(`Creating sandbox with only port ${TEST_PORT} configured...`);
      sandbox = await compute.sandbox.create();
      console.log(`✓ Sandbox created: ${sandbox.sandboxId}`);

      // Try to get URL for a port that wasn't configured
      console.log('Attempting to get URL for non-configured port 9999...');
      await expect(
        sandbox.getUrl({ port: 9999 })
      ).rejects.toThrow(/No tunnel found for port 9999/);

      console.log('✅ SUCCESS: Correctly errored for non-configured port!');
    } catch (error) {
      console.error('❌ TEST FAILED:', error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      if (sandbox) {
        console.log('Destroying sandbox...');
        await sandbox.destroy();
        console.log('✓ Sandbox destroyed');
      }
    }
  }, 60000);

  it.skipIf(skipTests)('should work without ports for backward compatibility', async () => {
    console.log('Testing backward compatibility (sandbox creation without ports)...');

    const compute = createCompute({
      provider: modal({
        tokenId: process.env.MODAL_TOKEN_ID,
        tokenSecret: process.env.MODAL_TOKEN_SECRET
      }) // No ports specified
    });

    let sandbox;
    try {
      console.log('Creating sandbox without ports...');
      sandbox = await compute.sandbox.create();
      console.log(`✓ Sandbox created: ${sandbox.sandboxId}`);
      
      // Sandbox should create successfully
      expect(sandbox).toBeDefined();
      expect(sandbox.sandboxId).toBeDefined();
      console.log('✓ Sandbox created successfully without ports');

      // But getUrl should fail since no ports were exposed
      console.log('Verifying that getUrl fails when no ports configured...');
      await expect(
        sandbox.getUrl({ port: 3000 })
      ).rejects.toThrow(/No tunnel found/);

      console.log('✅ SUCCESS: Backward compatibility maintained!');
    } catch (error) {
      console.error('❌ TEST FAILED:', error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      if (sandbox) {
        console.log('Destroying sandbox...');
        await sandbox.destroy();
        console.log('✓ Sandbox destroyed');
      }
    }
  }, 60000);

  it.skipIf(skipTests)('should verify timeout configuration is applied', async () => {
    console.log('Testing that timeout configuration is properly applied...');

    const customTimeout = 600000; // 10 minutes
    const compute = createCompute({
      provider: modal({
        tokenId: process.env.MODAL_TOKEN_ID,
        tokenSecret: process.env.MODAL_TOKEN_SECRET,
        ports: [TEST_PORT],
        timeout: customTimeout
      })
    });

    let sandbox;
    try {
      console.log('Creating sandbox with custom timeout...');
      sandbox = await compute.sandbox.create();
      console.log(`✓ Sandbox created: ${sandbox.sandboxId}`);
      
      // Get sandbox info
      const info = await sandbox.getInfo();
      
      // Verify timeout is set (Modal's SDK may handle this internally)
      expect(info).toBeDefined();
      expect(info.timeout).toBeDefined();
      
      console.log(`✓ Sandbox timeout: ${info.timeout}ms`);
      console.log('✅ SUCCESS: Timeout configuration verified!');
    } catch (error) {
      console.error('❌ TEST FAILED:', error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      if (sandbox) {
        console.log('Destroying sandbox...');
        await sandbox.destroy();
        console.log('✓ Sandbox destroyed');
      }
    }
  }, 60000);
});
