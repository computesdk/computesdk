/**
 * S3-Compatible Storage Provider
 *
 * Object storage using the Tigris Storage SDK.
 */

import { get, list as tigrisList, put, remove } from '@tigrisdata/storage';
import type { StorageProvider, StorageObject, UploadOptions, DownloadResult, ListOptions, ListResult } from '@computesdk/provider';

/**
 * S3-compatible configuration options.
 */
export interface S3Config {
  /** Access Key ID - if not provided, uses TIGRIS_STORAGE_ACCESS_KEY_ID */
  accessKeyId?: string;
  /** Secret Access Key - if not provided, uses TIGRIS_STORAGE_SECRET_ACCESS_KEY */
  secretAccessKey?: string;
  /** Region value kept for backward compatibility */
  region?: string;
  /** Required endpoint for the target S3-compatible service */
  endpoint?: string;
  /** Optional force path style value kept for backward compatibility */
  forcePathStyle?: boolean;
}

/**
 * S3-compatible storage instance
 */
export interface S3 extends StorageProvider {
  /** Upload data */
  upload(bucket: string, key: string, data: Uint8Array | string, options?: UploadOptions): Promise<StorageObject>;
  /** Download data */
  download(bucket: string, key: string): Promise<DownloadResult>;
  /** Delete object */
  delete(bucket: string, key: string): Promise<void>;
  /** List objects in bucket */
  list(bucket: string, options?: ListOptions): Promise<ListResult>;
  /** Exposes storage SDK operations for advanced use */
  getClient(): {
    put: typeof put;
    get: typeof get;
    list: typeof tigrisList;
    remove: typeof remove;
  };
}

/**
 * Create an S3-compatible storage provider instance backed by Tigris SDK.
 *
 * Uses explicit config values or TIGRIS_STORAGE_* env vars via per-call config.
 */
export function s3(config: S3Config): S3 {
  const accessKeyId = config.accessKeyId || process.env.TIGRIS_STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = config.secretAccessKey || process.env.TIGRIS_STORAGE_SECRET_ACCESS_KEY;
  const endpoint = config.endpoint || process.env.TIGRIS_STORAGE_ENDPOINT;

  if (!accessKeyId) {
    throw new Error(`Missing access key. Provide 'accessKeyId' in config or set TIGRIS_STORAGE_ACCESS_KEY_ID.`);
  }

  if (!secretAccessKey) {
    throw new Error(`Missing secret key. Provide 'secretAccessKey' in config or set TIGRIS_STORAGE_SECRET_ACCESS_KEY.`);
  }

  if (!endpoint) {
    throw new Error(`Missing endpoint. Provide 'endpoint' in config or set TIGRIS_STORAGE_ENDPOINT.`);
  }

  const operationConfig = {
    bucket: undefined as string | undefined,
    accessKeyId,
    secretAccessKey,
    endpoint,
  };

  return {
    async upload(bucket: string, key: string, data: Uint8Array | string, options?: UploadOptions): Promise<StorageObject> {
      try {
        const body = typeof data === 'string' ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        const result = await put(key, body, {
          ...(options?.contentType ? { contentType: options.contentType } : {}),
          config: { ...operationConfig, bucket },
        });

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
        throw new Error(`Failed to upload to storage: ${error instanceof Error ? error.message : String(error)}`);
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
          lastModified: new Date(),
          metadata: undefined,
        };
      } catch (error) {
        throw new Error(`Failed to download from storage: ${error instanceof Error ? error.message : String(error)}`);
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
        throw new Error(`Failed to delete from storage: ${error instanceof Error ? error.message : String(error)}`);
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
        throw new Error(`Failed to list objects in storage: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    getClient() {
      return { put, get, list: tigrisList, remove };
    },
  };
}
