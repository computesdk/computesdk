/**
 * Tigris Storage Provider Integration Tests
 * 
 * Uses the unified storage provider test suite to ensure Tigris implements
 * the standard StorageProvider interface correctly.
 * 
 * These tests run against real Tigris and only execute when Tigris credentials
 * are available in environment variables.
 * 
 * To run: Set TIGRIS_STORAGE_ACCESS_KEY_ID and TIGRIS_STORAGE_SECRET_ACCESS_KEY
 * then run tests. These tests are automatically skipped in CI without credentials.
 */

import { describe, it } from 'vitest';
import { runStorageProviderTestSuite } from '@computesdk/test-utils';
import { tigris } from '../index';

// Only run integration tests if credentials are available
const runIntegration = !!(
  process.env.TIGRIS_STORAGE_ACCESS_KEY_ID && 
  process.env.TIGRIS_STORAGE_SECRET_ACCESS_KEY
);

// Use environment bucket or default test bucket
const testBucket = process.env.TIGRIS_TEST_BUCKET || 'computesdk-test';

if (runIntegration) {
  runStorageProviderTestSuite({
    name: 'Tigris',
    provider: tigris({
      accessKeyId: process.env.TIGRIS_STORAGE_ACCESS_KEY_ID!,
      secretAccessKey: process.env.TIGRIS_STORAGE_SECRET_ACCESS_KEY!,
    }),
    bucket: testBucket,
    skipIntegration: false,
    timeout: 60000,
  });
} else {
  describe('Tigris Integration', () => {
    it.skip('skipped - no Tigris credentials available', () => {});
  });
}
