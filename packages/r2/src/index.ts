/**
 * Cloudflare R2 Storage Provider
 *
 * Object storage using the Tigris Storage SDK.
 */

import { get, list as tigrisList, put, remove } from '@tigrisdata/storage';
import type { StorageProvider, StorageObject, UploadOptions, DownloadResult, ListOptions, ListResult } from '@computesdk/provider';

/**
 * Cloudflare R2-specific configuration options
 */
export interface R2Config {
  /** R2 Access Key ID - if not provided, will use R2_ACCESS_KEY_ID environment variable */
  accessKeyId?: string;
  /** R2 Secret Access Key - if not provided, will use R2_SECRET_ACCESS_KEY environment variable */
  secretAccessKey?: string;
  /** R2 Account ID - used to construct the endpoint URL. If not provided, will use R2_ACCOUNT_ID env var */
  accountId?: string;
  /** R2 endpoint URL - if not provided, will be constructed from accountId */
  endpoint?: string;
}

/**
 * Cloudflare R2 Storage instance
 */
export interface R2 extends StorageProvider {
  /** Upload data to R2 */
  upload(bucket: string, key: string, data: Uint8Array | string, options?: UploadOptions): Promise<StorageObject>;
  /** Download data from R2 */
  download(bucket: string, key: string): Promise<DownloadResult>;
  /** Delete object from R2 */
  delete(bucket: string, key: string): Promise<void>;
  /** List objects in R2 bucket */
  list(bucket: string, options?: ListOptions): Promise<ListResult>;
  /** Exposes storage SDK operations for advanced use */
  getClient(): {
    put: (key: string, body: string | Uint8Array | Buffer, options?: Record<string, unknown>) => Promise<unknown>;
    get: (key: string, format: 'string' | 'file' | 'stream', options?: Record<string, unknown>) => Promise<unknown>;
    list: (options?: Record<string, unknown>) => ReturnType<typeof tigrisList>;
    remove: (key: string, options?: Record<string, unknown>) => ReturnType<typeof remove>;
  };
}

/**
 * Create a Cloudflare R2 storage provider instance
 * 
 * @param config - R2 configuration options
 * @returns R2 instance
 * 
 * @example
 * ```typescript
 * import { r2 } from '@computesdk/r2';
 * 
 * const storage = r2({
 *   accessKeyId: process.env.R2_ACCESS_KEY_ID,
 *   secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
 *   accountId: process.env.R2_ACCOUNT_ID
 * });
 * 
 * // Upload a file
 * await storage.upload('my-bucket', 'path/to/file.txt', 'Hello, World!');
 * 
 * // Download a file
 * const result = await storage.download('my-bucket', 'path/to/file.txt');
 * console.log(result.data.toString());
 * 
 * // Delete a file
 * await storage.delete('my-bucket', 'path/to/file.txt');
 * ```
 */
export function r2(config: R2Config): R2 {
  const accessKeyId =
    config.accessKeyId ||
    process.env.R2_ACCESS_KEY_ID ||
    process.env.TIGRIS_STORAGE_ACCESS_KEY_ID;
  const secretAccessKey =
    config.secretAccessKey ||
    process.env.R2_SECRET_ACCESS_KEY ||
    process.env.TIGRIS_STORAGE_SECRET_ACCESS_KEY;
  const accountId = config.accountId || process.env.R2_ACCOUNT_ID;

  let endpoint = config.endpoint;
  if (!endpoint && accountId) {
    endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  } else if (!endpoint) {
    throw new Error(
      `Missing R2 endpoint. Provide 'endpoint' or 'accountId' in config, or set R2_ACCOUNT_ID environment variable.`
    );
  }

  if (!accessKeyId) {
    throw new Error(`Missing access key. Provide 'accessKeyId' in config or set TIGRIS_STORAGE_ACCESS_KEY_ID/R2_ACCESS_KEY_ID.`);
  }

  if (!secretAccessKey) {
    throw new Error(`Missing secret key. Provide 'secretAccessKey' in config or set TIGRIS_STORAGE_SECRET_ACCESS_KEY/R2_SECRET_ACCESS_KEY.`);
  }

  const operationConfig = { accessKeyId, secretAccessKey, endpoint };

  return {
    async upload(bucket: string, key: string, data: Uint8Array | string, options?: UploadOptions): Promise<StorageObject> {
      try {
        const body = typeof data === 'string' ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        const result = await put(key, body, {
          ...(options?.contentType ? { contentType: options.contentType } : {}),
          ...(options?.metadata ? { metadata: options.metadata } : {}),
          config: { ...operationConfig, bucket },
        } as any);
        if (result.error) {
          throw new Error(result.error.message);
        }

        return {
          bucket,
          key,
          size: typeof data === 'string' ? Buffer.byteLength(data, 'utf8') : data.byteLength,
          etag: undefined,
          lastModified: new Date(),
          metadata: options?.metadata,
        };
      } catch (error) {
        throw new Error(
          `Failed to upload to R2: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    async download(bucket: string, key: string): Promise<DownloadResult> {
      try {
        const result = await get(key, 'stream', {
          config: { ...operationConfig, bucket },
        });
        if (result.error) {
          throw new Error(result.error.message);
        }

        const stream = result.data as ReadableStream;
        const reader = stream.getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }

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
          size: data.length,
          contentType: undefined,
          etag: undefined,
          lastModified: undefined,
          metadata: undefined,
        };
      } catch (error) {
        throw new Error(
          `Failed to download from R2: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    async delete(bucket: string, key: string): Promise<void> {
      try {
        const result = await remove(key, {
          config: { ...operationConfig, bucket },
        });
        if (result.error) {
          throw new Error(result.error.message);
        }
      } catch (error) {
        throw new Error(
          `Failed to delete from R2: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    async list(bucket: string, options?: ListOptions): Promise<ListResult> {
      try {
        const result = await tigrisList({
          prefix: options?.prefix,
          limit: options?.maxKeys,
          cursor: options?.continuationToken,
          config: { ...operationConfig, bucket },
        } as any);
        if (result.error) {
          throw new Error(result.error.message);
        }
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
          `Failed to list objects in R2: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    getClient() {
      return {
        put: (key: string, body: string | Uint8Array | Buffer, options?: Record<string, unknown>) =>
          put(key, typeof body === 'string' || Buffer.isBuffer(body) ? body : Buffer.from(body), {
            ...(options || {}),
            config: { ...operationConfig, ...(options?.config as object || {}) },
          } as any),
        get: (key: string, format: 'string' | 'file' | 'stream', options?: Record<string, unknown>) =>
          get(key, format as any, {
            ...(options || {}),
            config: { ...operationConfig, ...(options?.config as object || {}) },
          } as any),
        list: (options?: Record<string, unknown>) =>
          tigrisList({
            ...(options || {}),
            config: { ...operationConfig, ...(options?.config as object || {}) },
          } as any),
        remove: (key: string, options?: Record<string, unknown>) =>
          remove(key, {
            ...(options || {}),
            config: { ...operationConfig, ...(options?.config as object || {}) },
          } as any),
      };
    },
  };
}
