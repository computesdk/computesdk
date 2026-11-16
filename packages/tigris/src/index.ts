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
  type PutOptions,
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
 * Credentials and bucket are passed to the Tigris SDK on every call, so
 * instances with different credentials can be used concurrently.
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

  const sdkConfig = (bucket: string): NonNullable<PutOptions['config']> => ({ bucket, accessKeyId, secretAccessKey });

  return {
    async upload(bucket: string, key: string, data: Uint8Array | string, options?: UploadOptions): Promise<StorageObject> {
      try {
        const body = typeof data === 'string'
          ? data
          : Buffer.from(data.buffer, data.byteOffset, data.byteLength);

        const result = await put(key, body, {
          contentType: options?.contentType,
          config: sdkConfig(bucket),
        });

        if (result.error) {
          throw new Error(result.error.message);
        }

        return {
          bucket,
          key,
          size: typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : body.byteLength,
          etag: undefined,
          lastModified: result.data.modified ? new Date(result.data.modified) : new Date(),
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
        const result = await get(key, 'stream', { config: sdkConfig(bucket) });

        if (result.error) {
          throw new Error(result.error.message);
        }

        const reader = result.data.getReader();
        const chunks: Uint8Array[] = [];
        let totalLength = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          totalLength += value.length;
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
        const result = await remove(key, { config: sdkConfig(bucket) });

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
        const result = await tigrisList({
          prefix: options?.prefix,
          limit: options?.maxKeys,
          paginationToken: options?.continuationToken,
          config: sdkConfig(bucket),
        });

        if (result.error) {
          throw new Error(result.error.message);
        }

        return {
          objects: result.data.items.map((item) => ({
            bucket,
            key: item.name,
            size: item.size,
            etag: undefined,
            lastModified: item.lastModified ? new Date(item.lastModified) : undefined,
          })),
          truncated: result.data.hasMore,
          continuationToken: result.data.paginationToken,
        };
      } catch (error) {
        throw new Error(
          `Failed to list objects in Tigris: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
  };
}
