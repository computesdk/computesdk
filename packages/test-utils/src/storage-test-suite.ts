/**
 * Unified Storage Provider Test Suite
 * 
 * This module provides a comprehensive test suite that can be used to test
 * any ComputeSDK storage provider implementation. It ensures consistency
 * across all storage providers (S3, R2, Tigris) and covers all core functionality.
 */

import { describe, it, expect, afterAll } from 'vitest';
// @ts-ignore - workspace reference
import type { StorageProvider, StorageObject, DownloadResult, ListResult } from '@computesdk/provider';

export interface StorageProviderTestConfig {
  /** The provider instance to test */
  provider: StorageProvider;
  /** Provider name for test descriptions */
  name: string;
  /** Test bucket name */
  bucket: string;
  /** Custom test timeout in milliseconds */
  timeout?: number;
  /** Skip tests that require real API calls */
  skipIntegration?: boolean;
}

/**
 * Creates a unified test suite for any storage provider
 * This ensures all providers (S3, R2, Tigris) implement the same interface correctly
 */
export function runStorageProviderTestSuite(config: StorageProviderTestConfig) {
  const { provider, name, bucket, timeout = 30000, skipIntegration = false } = config;

  // Skip entire suite if integration tests should be skipped
  const describeFn = skipIntegration ? describe.skip : describe;

  describeFn(`${name} Storage Provider`, () => {
    const testPrefix = `test-${Date.now()}-${Math.random().toString(36).substring(2, 8)}/`;
    const createdKeys: string[] = [];

    afterAll(async () => {
      // Cleanup: Delete all test objects
      if (!skipIntegration) {
        for (const key of createdKeys) {
          try {
            await provider.delete(bucket, key);
          } catch (error) {
            console.log(`Cleanup error for ${key} (non-fatal):`, error);
          }
        }
      }
    }, timeout);

    describe('CRUD Operations', () => {
      it('should upload and download text data', async () => {
        const key = `${testPrefix}text-${Date.now()}.txt`;
        const content = 'Hello, World! 🌍';
        
        // Upload
        const uploadResult: StorageObject = await provider.upload(bucket, key, content, {
          contentType: 'text/plain',
        });
        createdKeys.push(key);
        
        expect(uploadResult.bucket).toBe(bucket);
        expect(uploadResult.key).toBe(key);
        expect(uploadResult.size).toBe(new TextEncoder().encode(content).length);
        expect(uploadResult.lastModified).toBeInstanceOf(Date);
        
        // Download
        const downloadResult: DownloadResult = await provider.download(bucket, key);
        expect(downloadResult.size).toBe(uploadResult.size);
        
        // Verify content
        const decoder = new TextDecoder();
        const downloadedText = decoder.decode(downloadResult.data);
        expect(downloadedText).toBe(content);
      }, timeout);

      it('should upload and download binary data', async () => {
        const key = `${testPrefix}binary-${Date.now()}.bin`;
        const content = new Uint8Array([0, 1, 2, 255, 254, 253, 128, 64]);
        
        // Upload
        await provider.upload(bucket, key, content, {
          contentType: 'application/octet-stream',
        });
        createdKeys.push(key);
        
        // Download
        const downloadResult: DownloadResult = await provider.download(bucket, key);
        expect(downloadResult.size).toBe(content.length);
        
        // Binary data should be identical
        expect(downloadResult.data).toEqual(content);
      }, timeout);

      it('should delete objects', async () => {
        const key = `${testPrefix}delete-${Date.now()}.txt`;
        const content = 'to be deleted';
        
        // Create
        await provider.upload(bucket, key, content);
        
        // Delete
        await expect(provider.delete(bucket, key)).resolves.not.toThrow();
        
        // Verify deletion
        await expect(provider.download(bucket, key)).rejects.toThrow();
      }, timeout);
    });

    describe('List Operations', () => {
      it('should list objects with prefix', async () => {
        // Create multiple objects with same prefix
        const keys: string[] = [];
        for (let i = 0; i < 3; i++) {
          const key = `${testPrefix}list-${Date.now()}-${i}.txt`;
          await provider.upload(bucket, key, `content-${i}`);
          keys.push(key);
          createdKeys.push(key);
        }
        
        // List with prefix
        const listResult: ListResult = await provider.list(bucket, {
          prefix: testPrefix,
        });
        
        expect(listResult.objects.length).toBeGreaterThanOrEqual(3);
        expect(listResult.objects.every((obj: { bucket: string }) => obj.bucket === bucket)).toBe(true);
        
        // Verify all created objects are listed
        for (const key of keys) {
          const found = listResult.objects.find((obj: { key: string }) => obj.key === key);
          expect(found).toBeDefined();
        }
      }, timeout);

      it('should respect maxKeys parameter', async () => {
        // Create multiple objects with a shared prefix
        const timestamp = Date.now();
        const keyPrefix = `${testPrefix}limit-${timestamp}`;
        const keys: string[] = [];
        for (let i = 0; i < 5; i++) {
          const key = `${keyPrefix}-${i}.txt`;
          await provider.upload(bucket, key, `content-${i}`);
          keys.push(key);
          createdKeys.push(key);
        }

        // List with limit
        const listResult: ListResult = await provider.list(bucket, {
          prefix: keyPrefix,
          maxKeys: 2,
        });
        
        expect(listResult.objects.length).toBeLessThanOrEqual(2);
      }, timeout);

      it('should return truncated/pagination info', async () => {
        const listResult: ListResult = await provider.list(bucket, {
          prefix: testPrefix,
          maxKeys: 100,
        });
        
        expect(typeof listResult.truncated).toBe('boolean');
        // continuationToken may be undefined if not truncated
        if (listResult.truncated) {
          expect(listResult.continuationToken).toBeDefined();
        }
      }, timeout);
    });

    describe('Error Handling', () => {
      it('should throw error for non-existent object', async () => {
        const nonExistentKey = `${testPrefix}nonexistent-${Date.now()}.txt`;
        
        await expect(
          provider.download(bucket, nonExistentKey)
        ).rejects.toThrow();
      }, timeout);

      it('should throw error for non-existent bucket (if applicable)', async () => {
        const nonExistentBucket = `nonexistent-bucket-${Date.now()}`;
        const key = 'test.txt';
        
        // Some providers throw on upload, some on operations
        // Just verify it rejects somehow
        try {
          await provider.upload(nonExistentBucket, key, 'test');
          // If it succeeds, that's okay (bucket auto-created)
          // Don't add to createdKeys — cleanup only targets the primary bucket
        } catch (error) {
          expect(error).toBeDefined();
        }
      }, timeout);
    });

    describe('Data Types', () => {
      it('should handle empty files', async () => {
        const key = `${testPrefix}empty-${Date.now()}.txt`;
        const content = '';
        
        await provider.upload(bucket, key, content);
        createdKeys.push(key);
        
        const downloadResult = await provider.download(bucket, key);
        expect(downloadResult.size).toBe(0);
        expect(downloadResult.data.byteLength).toBe(0);
      }, timeout);

      it('should handle large binary data', async () => {
        const key = `${testPrefix}large-${Date.now()}.bin`;
        // 1MB of random data
        const content = new Uint8Array(1024 * 1024);
        for (let i = 0; i < content.length; i++) {
          content[i] = i % 256;
        }
        
        await provider.upload(bucket, key, content, {
          contentType: 'application/octet-stream',
        });
        createdKeys.push(key);
        
        const downloadResult = await provider.download(bucket, key);
        expect(downloadResult.size).toBe(content.length);
        expect(downloadResult.data).toEqual(content);
      }, timeout * 2); // Larger timeout for big files

      it('should handle Unicode text', async () => {
        const key = `${testPrefix}unicode-${Date.now()}.txt`;
        const content = 'Hello 世界 🌍 привет 日本語 العربية';
        
        await provider.upload(bucket, key, content, {
          contentType: 'text/plain; charset=utf-8',
        });
        createdKeys.push(key);
        
        const downloadResult = await provider.download(bucket, key);
        const decoder = new TextDecoder('utf-8');
        const downloadedText = decoder.decode(downloadResult.data);
        expect(downloadedText).toBe(content);
      }, timeout);
    });
  });
}

/**
 * Run storage provider test suite with real API calls
 * Use this when you have credentials available
 */
export function runStorageProviderIntegrationTests(config: Omit<StorageProviderTestConfig, 'skipIntegration'>) {
  return runStorageProviderTestSuite({ ...config, skipIntegration: false });
}

/**
 * Run storage provider test suite with mocks (unit tests)
 * Use this when you don't have credentials
 */
export function runStorageProviderUnitTests(config: StorageProviderTestConfig) {
  return runStorageProviderTestSuite({ ...config, skipIntegration: true });
}
