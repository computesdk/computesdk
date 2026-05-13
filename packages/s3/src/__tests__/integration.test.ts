/**
 * S3-Compatible Storage Provider Integration Tests
 * 
 * Uses the unified storage provider test suite to ensure S3 implements
 * the standard StorageProvider interface correctly.
 * 
 * These tests run against a real S3-compatible endpoint and only execute when credentials
 * are available in environment variables.
 * 
 * To run: Set TIGRIS_STORAGE_ACCESS_KEY_ID/TIGRIS_STORAGE_SECRET_ACCESS_KEY (or AWS_*), then run tests
 * These tests are automatically skipped in CI without credentials.
 */

import { describe, it } from 'vitest';
import { runStorageProviderTestSuite } from '@computesdk/test-utils';
import { s3 } from '../index';

// Only run integration tests if credentials are available
const runIntegration = !!(
  (process.env.TIGRIS_STORAGE_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID) &&
  (process.env.TIGRIS_STORAGE_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY)
);

// Use environment bucket or default test bucket
const testBucket = process.env.TIGRIS_STORAGE_BUCKET || process.env.AWS_TEST_BUCKET || 'computesdk-test-bucket';

if (runIntegration) {
  // Run the full test suite with a real S3-compatible store
  runStorageProviderTestSuite({
    name: 'S3-compatible (Tigris SDK)',
    provider: s3({
      accessKeyId: process.env.TIGRIS_STORAGE_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.TIGRIS_STORAGE_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY,
      endpoint: process.env.TIGRIS_STORAGE_ENDPOINT,
    }),
    bucket: testBucket,
    skipIntegration: false,
    timeout: 60000,
  });
} else {
  // Add a placeholder test so vitest doesn't complain about empty file
  describe('S3-Compatible Integration', () => {
    it.skip('skipped - no credentials available', () => {});
  });
}
