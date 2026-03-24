/**
 * AWS S3 Storage Provider Integration Tests
 * 
 * Uses the unified storage provider test suite to ensure S3 implements
 * the standard StorageProvider interface correctly.
 * 
 * These tests run against real S3 and only execute when AWS credentials
 * are available in environment variables.
 * 
 * To run: Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, then run tests
 * These tests are automatically skipped in CI without credentials.
 */

import { describe, it } from 'vitest';
import { runStorageProviderTestSuite } from '@computesdk/test-utils';
import { s3 } from '../index';

// Only run integration tests if credentials are available
const runIntegration = !!(
  process.env.AWS_ACCESS_KEY_ID && 
  process.env.AWS_SECRET_ACCESS_KEY
);

// Use environment bucket or default test bucket
const testBucket = process.env.AWS_TEST_BUCKET || 'computesdk-test-bucket';

if (runIntegration) {
  // Run the full test suite with real S3
  runStorageProviderTestSuite({
    name: 'AWS S3',
    provider: s3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      region: process.env.AWS_REGION || 'us-east-1',
    }),
    bucket: testBucket,
    skipIntegration: false,
    timeout: 60000,
  });
} else {
  // Add a placeholder test so vitest doesn't complain about empty file
  describe('AWS S3 Integration', () => {
    it.skip('skipped - no AWS credentials available', () => {});
  });
}
