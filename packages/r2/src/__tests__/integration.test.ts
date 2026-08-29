/**
 * Cloudflare R2 Storage Provider Integration Tests
 * 
 * Uses the unified storage provider test suite to ensure R2 implements
 * the standard StorageProvider interface correctly.
 * 
 * These tests run against real R2 and only execute when R2 credentials
 * are available in environment variables.
 * 
 * To run: Set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_ACCOUNT_ID 
 * then run tests. These tests are automatically skipped in CI without credentials.
 */

import { describe, it } from 'vitest';
import { runStorageProviderTestSuite } from '@computesdk/test-utils';
import { r2 } from '../index';

// Only run integration tests if credentials are available
const runIntegration = !!(
  process.env.R2_ACCESS_KEY_ID && 
  process.env.R2_SECRET_ACCESS_KEY &&
  (process.env.R2_ACCOUNT_ID || process.env.R2_ENDPOINT)
);

// Use environment bucket or default test bucket
const testBucket = process.env.R2_TEST_BUCKET || 'computesdk-test';

if (runIntegration) {
  runStorageProviderTestSuite({
    name: 'Cloudflare R2',
    provider: r2({
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      accountId: process.env.R2_ACCOUNT_ID,
      endpoint: process.env.R2_ENDPOINT,
    }),
    bucket: testBucket,
    skipIntegration: false,
    timeout: 60000,
  });
} else {
  describe('Cloudflare R2 Integration', () => {
    it.skip('skipped - no R2 credentials available', () => {});
  });
}
