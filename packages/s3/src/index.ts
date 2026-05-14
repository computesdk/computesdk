/**
 * S3-Compatible Storage Provider
 *
 * Object storage using the Tigris Storage SDK.
 */

import { get, head, list as tigrisList, put, remove } from '@tigrisdata/storage';
import type { StorageProvider, StorageObject, UploadOptions, DownloadResult, ListOptions, ListResult } from '@computesdk/provider';

/**
 * S3-compatible configuration options.
 */
export interface S3Config {
  /** Access Key ID - if not provided, uses TIGRIS_STORAGE_ACCESS_KEY_ID */
  accessKeyId?: string;
  /** Secret Access Key - if not provided, uses TIGRIS_STORAGE_SECRET_ACCESS_KEY */
  secretAccessKey?: string;
  /** Required endpoint for the target S3-compatible service */
  endpoint?: string;
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
    put: (key: string, body: string | Uint8Array | Buffer, options?: Parameters<typeof put>[2]) => ReturnType<typeof put>;
    get: (key: string, format: Parameters<typeof get>[1], options?: Parameters<typeof get>[2]) => ReturnType<typeof get>;
    list: (options?: Parameters<typeof tigrisList>[0]) => ReturnType<typeof tigrisList>;
    remove: (key: string, options?: Parameters<typeof remove>[1]) => ReturnType<typeof remove>;
  };
}

interface ListedObject {
  key?: string;
  size?: number;
  etag?: string;
  lastModified?: string | Date;
}

interface ListData {
  objects?: ListedObject[];
  truncated?: boolean;
  nextContinuationToken?: string;
}

interface HeadData {
  contentType?: string;
  etag?: string;
  lastModified?: string | Date;
  metadata?: Record<string, string>;
}

/**
 * Create an S3-compatible storage provider instance backed by Tigris SDK.
 *
 * Uses explicit config values or TIGRIS_STORAGE_* env vars via per-call config.
 */
export function s3(config: S3Config): S3 {
  const accessKeyId =
    config.accessKeyId ||
    process.env.TIGRIS_STORAGE_ACCESS_KEY_ID;
  const secretAccessKey =
    config.secretAccessKey ||
    process.env.TIGRIS_STORAGE_SECRET_ACCESS_KEY;
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

  const operationConfig = { accessKeyId, secretAccessKey, endpoint };
  const withConfig = <T extends object | undefined>(bucket: string | undefined, options?: T): T & { config: Record<string, string> } => {
    const baseOptions = (options ?? {}) as object;
    const optionConfig = (options as { config?: Record<string, string> } | undefined)?.config;
    return {
      ...(baseOptions as object),
      config: {
        ...operationConfig,
        ...(bucket ? { bucket } : {}),
        ...(optionConfig || {}),
      },
    } as T & { config: Record<string, string> };
  };

  return {
    async upload(bucket: string, key: string, data: Uint8Array | string, options?: UploadOptions): Promise<StorageObject> {
      try {
        const body = typeof data === 'string' ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        const result = await put(key, body, withConfig(bucket, {
          ...(options?.contentType ? { contentType: options.contentType } : {}),
          ...(options?.metadata ? { metadata: options.metadata } : {}),
        }));

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
        throw new Error(`Failed to upload to storage: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    async download(bucket: string, key: string): Promise<DownloadResult> {
      try {
        const result = await get(key, 'stream', withConfig(bucket));
        if (result.error) {
          throw new Error(result.error.message);
        }

        const headResult = await head(key, withConfig(bucket));
        const headData: HeadData | undefined = headResult.error ? undefined : (headResult.data as HeadData | undefined);

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
          contentType: headData?.contentType,
          etag: headData?.etag,
          lastModified: headData?.lastModified ? new Date(headData.lastModified) : undefined,
          metadata: headData?.metadata,
        };
      } catch (error) {
        if (error instanceof Error && /not\s*found|no\s*such\s*key/i.test(error.message)) {
          throw new Error(`Object not found: s3://${bucket}/${key}`);
        }
        throw new Error(`Failed to download from storage: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    async delete(bucket: string, key: string): Promise<void> {
      try {
        const result = await remove(key, withConfig(bucket));
        if (result.error) {
          throw new Error(result.error.message);
        }
      } catch (error) {
        throw new Error(`Failed to delete from storage: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    async list(bucket: string, options?: ListOptions): Promise<ListResult> {
      try {
        const result = await tigrisList(withConfig(bucket, {
          prefix: options?.prefix,
          limit: options?.maxKeys,
          cursor: options?.continuationToken,
        }));

        if (result.error) {
          throw new Error(result.error.message);
        }

        const responseData = (result.data ?? {}) as ListData;

        return {
          objects: (responseData.objects || []).map((obj) => ({
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
      return {
        put: (key: string, body: string | Uint8Array | Buffer, options?: Parameters<typeof put>[2]) =>
          put(key, typeof body === 'string' || Buffer.isBuffer(body) ? body : Buffer.from(body), withConfig(undefined, options)),
        get: (key: string, format: Parameters<typeof get>[1], options?: Parameters<typeof get>[2]) =>
          get(key, format, withConfig(undefined, options)),
        list: (options?: Parameters<typeof tigrisList>[0]) =>
          tigrisList(withConfig(undefined, options)),
        remove: (key: string, options?: Parameters<typeof remove>[1]) =>
          remove(key, withConfig(undefined, options)),
      };
    },
  };
}
