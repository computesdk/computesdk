/**
 * Tigris Storage Provider
 * 
 * Object storage using the official Tigris Storage SDK.
 */

import { 
  get, 
  put, 
  list as tigrisList,
  remove,
} from '@tigrisdata/storage';
import type { StorageProvider, StorageObject, UploadOptions, DownloadResult, ListOptions, ListResult } from '@computesdk/provider';

/**
 * Tigris-specific configuration options
 */
export interface TigrisConfig {
  /** Tigris Access Key ID - if not provided, will use TIGRIS_STORAGE_ACCESS_KEY_ID environment variable */
  accessKeyId?: string;
  /** Tigris Secret Access Key - if not provided, will use TIGRIS_STORAGE_SECRET_ACCESS_KEY environment variable */
  secretAccessKey?: string;
}

/**
 * Tigris Storage instance
 */
export interface Tigris extends StorageProvider {
  /** Upload data to Tigris */
  upload(bucket: string, key: string, data: Uint8Array | string, options?: UploadOptions): Promise<StorageObject>;
  /** Download data from Tigris */
  download(bucket: string, key: string): Promise<DownloadResult>;
  /** Delete object from Tigris */
  delete(bucket: string, key: string): Promise<void>;
  /** List objects in Tigris bucket */
  list(bucket: string, options?: ListOptions): Promise<ListResult>;
}

/**
 * Create a Tigris storage provider instance
 * 
 * Note: The Tigris SDK uses global environment variables for configuration.
 * This implementation sets credentials once at initialization. For concurrent
 * use with different credentials, create separate instances.
 * 
 * @param config - Tigris configuration options
 * @returns Tigris instance
 * 
 * @example
 * ```typescript
 * import { tigris } from '@computesdk/tigris';
 * 
 * const storage = tigris({
 *   accessKeyId: process.env.TIGRIS_STORAGE_ACCESS_KEY_ID,
 *   secretAccessKey: process.env.TIGRIS_STORAGE_SECRET_ACCESS_KEY
 * });
 * 
 * // Upload a file
 * await storage.upload('my-bucket', 'path/to/file.txt', new TextEncoder().encode('Hello, World!'));
 * 
 * // Download a file
 * const result = await storage.download('my-bucket', 'path/to/file.txt');
 * console.log(new TextDecoder().decode(result.data));
 * 
 * // Delete a file
 * await storage.delete('my-bucket', 'path/to/file.txt');
 * 
 * // List objects
 * const list = await storage.list('my-bucket', { prefix: 'path/to/' });
 * for (const obj of list.objects) {
 *   console.log(`${obj.key}: ${obj.size} bytes`);
 * }
 * ```
 */
export function tigris(config: TigrisConfig): Tigris {
  // Resolve configuration from parameters or environment
  const accessKeyId = config.accessKeyId || process.env.TIGRIS_STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = config.secretAccessKey || process.env.TIGRIS_STORAGE_SECRET_ACCESS_KEY;

  if (!accessKeyId) {
    throw new Error(
      `Missing Tigris Access Key ID. Provide 'accessKeyId' in config or set TIGRIS_STORAGE_ACCESS_KEY_ID environment variable.`
    );
  }

  if (!secretAccessKey) {
    throw new Error(
      `Missing Tigris Secret Access Key. Provide 'secretAccessKey' in config or set TIGRIS_STORAGE_SECRET_ACCESS_KEY environment variable.`
    );
  }

  // Set credentials once at initialization
  // Note: Tigris SDK uses global env vars, so concurrent instances with different
  // credentials will interfere. This is a limitation of the Tigris SDK.
  process.env.TIGRIS_STORAGE_ACCESS_KEY_ID = accessKeyId;
  process.env.TIGRIS_STORAGE_SECRET_ACCESS_KEY = secretAccessKey;

  return {
    async upload(bucket: string, key: string, data: Uint8Array | string, options?: UploadOptions): Promise<StorageObject> {
      try {
        // Store previous bucket value
        const prevBucket = process.env.TIGRIS_STORAGE_BUCKET;
        
        // Set bucket for this operation
        process.env.TIGRIS_STORAGE_BUCKET = bucket;

        let result;
        if (typeof data === 'string') {
          result = await put(key, data, options?.contentType ? { contentType: options.contentType } : undefined);
        } else {
          // Pass Uint8Array as Buffer for binary data support
          const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
          result = await put(key, buffer, options?.contentType ? { contentType: options.contentType } : undefined);
        }

        // Restore previous bucket
        if (prevBucket !== undefined) {
          process.env.TIGRIS_STORAGE_BUCKET = prevBucket;
        } else {
          delete process.env.TIGRIS_STORAGE_BUCKET;
        }

        if (result.error) {
          throw new Error(result.error.message);
        }

        return {
          bucket,
          key,
          size: typeof data === 'string' ? data.length : data.byteLength,
          etag: undefined,
          lastModified: new Date(),
          metadata: options?.metadata,
        };
      } catch (error) {
        throw new Error(
          `Failed to upload to Tigris: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    async download(bucket: string, key: string): Promise<DownloadResult> {
      try {
        // Store previous bucket value
        const prevBucket = process.env.TIGRIS_STORAGE_BUCKET;
        
        // Set bucket for this operation
        process.env.TIGRIS_STORAGE_BUCKET = bucket;

        const result = await get(key, 'stream');

        // Restore previous bucket
        if (prevBucket !== undefined) {
          process.env.TIGRIS_STORAGE_BUCKET = prevBucket;
        } else {
          delete process.env.TIGRIS_STORAGE_BUCKET;
        }

        if (result.error) {
          throw new Error(result.error.message);
        }

        // Convert stream to Uint8Array
        const stream = result.data as ReadableStream;
        const reader = stream.getReader();
        const chunks: Uint8Array[] = [];
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        
        // Concatenate chunks
        let totalLength = 0;
        for (const chunk of chunks) {
          totalLength += chunk.length;
        }
        const data = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          data.set(chunk, offset);
          offset += chunk.length;
        }

        return {
          data,
          size: data.byteLength,
          contentType: undefined,
          etag: undefined,
          lastModified: new Date(),
          metadata: undefined,
        };
      } catch (error) {
        throw new Error(
          `Failed to download from Tigris: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    async delete(bucket: string, key: string): Promise<void> {
      try {
        // Store previous bucket value
        const prevBucket = process.env.TIGRIS_STORAGE_BUCKET;
        
        // Set bucket for this operation
        process.env.TIGRIS_STORAGE_BUCKET = bucket;

        const result = await remove(key);

        // Restore previous bucket
        if (prevBucket !== undefined) {
          process.env.TIGRIS_STORAGE_BUCKET = prevBucket;
        } else {
          delete process.env.TIGRIS_STORAGE_BUCKET;
        }

        if (result.error) {
          throw new Error(result.error.message);
        }
      } catch (error) {
        throw new Error(
          `Failed to delete from Tigris: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    async list(bucket: string, options?: ListOptions): Promise<ListResult> {
      try {
        // Store previous bucket value
        const prevBucket = process.env.TIGRIS_STORAGE_BUCKET;
        
        // Set bucket for this operation
        process.env.TIGRIS_STORAGE_BUCKET = bucket;

        const result = await tigrisList({
          prefix: options?.prefix,
          limit: options?.maxKeys,
        });

        // Restore previous bucket
        if (prevBucket !== undefined) {
          process.env.TIGRIS_STORAGE_BUCKET = prevBucket;
        } else {
          delete process.env.TIGRIS_STORAGE_BUCKET;
        }

        if (result.error) {
          throw new Error(result.error.message);
        }

        // Tigris list response has different structure, adapt it
        const responseData = result.data as any;
        
        return {
          objects: (responseData?.objects || []).map((obj: any) => ({
            bucket,
            key: obj.key || '',
            size: obj.size || 0,
            etag: obj.etag,
            lastModified: obj.lastModified ? new Date(obj.lastModified) : undefined,
          })),
          truncated: responseData?.truncated || false,
          continuationToken: responseData?.nextContinuationToken,
        };
      } catch (error) {
        throw new Error(
          `Failed to list objects in Tigris: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
  };
}
