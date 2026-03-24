/**
 * Cloudflare R2 Storage Provider
 * 
 * Object storage using Cloudflare R2 with S3-compatible API.
 */

import { S3Client, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
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
  /** Get the underlying S3 client for advanced operations */
  getClient(): S3Client;
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
  // Resolve configuration from parameters or environment
  const accessKeyId = config.accessKeyId || process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = config.secretAccessKey || process.env.R2_SECRET_ACCESS_KEY;
  const accountId = config.accountId || process.env.R2_ACCOUNT_ID;
  
  // Build endpoint URL
  let endpoint = config.endpoint;
  if (!endpoint && accountId) {
    endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  } else if (!endpoint) {
    throw new Error(
      `Missing R2 endpoint. Provide 'endpoint' or 'accountId' in config, or set R2_ACCOUNT_ID environment variable.`
    );
  }

  if (!accessKeyId) {
    throw new Error(
      `Missing R2 Access Key ID. Provide 'accessKeyId' in config or set R2_ACCESS_KEY_ID environment variable.`
    );
  }

  if (!secretAccessKey) {
    throw new Error(
      `Missing R2 Secret Access Key. Provide 'secretAccessKey' in config or set R2_SECRET_ACCESS_KEY environment variable.`
    );
  }

  // Create S3-compatible client for R2
  // R2 requires forcePathStyle: true and uses 'auto' as the region
  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: true, // R2 requires path-style URLs
  });

  return {
    async upload(bucket: string, key: string, data: Uint8Array | string, options?: UploadOptions): Promise<StorageObject> {
      try {
        const body = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);
        const contentType = options?.contentType || 'application/octet-stream';

        // Use multipart upload for files larger than 5MB
        const upload = new Upload({
          client,
          params: {
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
            ...(options?.metadata && { Metadata: options.metadata }),
          },
          queueSize: 4,
          partSize: 5 * 1024 * 1024, // 5MB
        });

        await upload.done();

        return {
          bucket,
          key,
          size: body.length,
          etag: undefined,
          lastModified: new Date(),
        };
      } catch (error) {
        throw new Error(
          `Failed to upload to R2: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    async download(bucket: string, key: string): Promise<DownloadResult> {
      try {
        const command = new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        });

        const response = await client.send(command);
        
        // Convert stream to Uint8Array
        const chunks: Uint8Array[] = [];
        if (response.Body) {
          for await (const chunk of response.Body as any) {
            chunks.push(new Uint8Array(chunk));
          }
        }
        
        // Concatenate all chunks
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
          contentType: response.ContentType,
          etag: response.ETag,
          lastModified: response.LastModified,
          metadata: response.Metadata,
        };
      } catch (error) {
        if (error instanceof Error && error.name === 'NoSuchKey') {
          throw new Error(`Object not found: r2://${bucket}/${key}`);
        }
        throw new Error(
          `Failed to download from R2: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    async delete(bucket: string, key: string): Promise<void> {
      try {
        const command = new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        });

        await client.send(command);
      } catch (error) {
        throw new Error(
          `Failed to delete from R2: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    async list(bucket: string, options?: ListOptions): Promise<ListResult> {
      try {
        const command = new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: options?.prefix,
          MaxKeys: options?.maxKeys ?? 1000,
          ContinuationToken: options?.continuationToken,
        });

        const response = await client.send(command);

        return {
          objects: (response.Contents || []).map(obj => ({
            bucket,
            key: obj.Key || '',
            size: obj.Size || 0,
            etag: obj.ETag,
            lastModified: obj.LastModified,
          })),
          truncated: response.IsTruncated || false,
          continuationToken: response.NextContinuationToken,
        };
      } catch (error) {
        throw new Error(
          `Failed to list objects in R2: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    getClient(): S3Client {
      return client;
    },
  };
}
