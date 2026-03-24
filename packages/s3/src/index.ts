/**
 * AWS S3 Storage Provider
 * 
 * Object storage using AWS S3 with the ComputeSDK storage interface.
 */

import { S3Client, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { StorageProvider, StorageObject, UploadOptions, DownloadResult, ListOptions, ListResult } from '@computesdk/provider';

/**
 * AWS S3-specific configuration options
 */
export interface S3Config {
  /** AWS Access Key ID - if not provided, will use AWS_ACCESS_KEY_ID environment variable */
  accessKeyId?: string;
  /** AWS Secret Access Key - if not provided, will use AWS_SECRET_ACCESS_KEY environment variable */
  secretAccessKey?: string;
  /** AWS region - defaults to us-east-1 */
  region?: string;
  /** Optional custom endpoint for S3-compatible services */
  endpoint?: string;
  /** Optional force path style (needed for some S3-compatible services) */
  forcePathStyle?: boolean;
}

/**
 * AWS S3 Storage instance
 */
export interface S3 extends StorageProvider {
  /** Upload data to S3 */
  upload(bucket: string, key: string, data: Uint8Array | string, options?: UploadOptions): Promise<StorageObject>;
  /** Download data from S3 */
  download(bucket: string, key: string): Promise<DownloadResult>;
  /** Delete object from S3 */
  delete(bucket: string, key: string): Promise<void>;
  /** List objects in S3 bucket */
  list(bucket: string, options?: ListOptions): Promise<ListResult>;
  /** Get the underlying S3 client for advanced operations */
  getClient(): S3Client;
}

/**
 * Create an AWS S3 storage provider instance
 * 
 * @param config - S3 configuration options
 * @returns S3 instance
 * 
 * @example
 * ```typescript
 * import { s3 } from '@computesdk/s3';
 * 
 * const storage = s3({
 *   accessKeyId: process.env.AWS_ACCESS_KEY_ID,
 *   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
 *   region: 'us-east-1'
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
export function s3(config: S3Config): S3 {
  // Resolve configuration from parameters or environment
  const accessKeyId = config.accessKeyId || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = config.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY;
  const region = config.region || process.env.AWS_REGION || 'us-east-1';

  if (!accessKeyId) {
    throw new Error(
      `Missing AWS Access Key ID. Provide 'accessKeyId' in config or set AWS_ACCESS_KEY_ID environment variable.`
    );
  }

  if (!secretAccessKey) {
    throw new Error(
      `Missing AWS Secret Access Key. Provide 'secretAccessKey' in config or set AWS_SECRET_ACCESS_KEY environment variable.`
    );
  }

  // Create S3 client
  const client = new S3Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    ...(config.endpoint && { endpoint: config.endpoint }),
    ...(config.forcePathStyle && { forcePathStyle: config.forcePathStyle }),
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
          etag: undefined, // Upload doesn't return ETag directly
          lastModified: new Date(),
        };
      } catch (error) {
        throw new Error(
          `Failed to upload to S3: ${error instanceof Error ? error.message : String(error)}`
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
          throw new Error(`Object not found: s3://${bucket}/${key}`);
        }
        throw new Error(
          `Failed to download from S3: ${error instanceof Error ? error.message : String(error)}`
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
          `Failed to delete from S3: ${error instanceof Error ? error.message : String(error)}`
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
          `Failed to list objects in S3: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    getClient(): S3Client {
      return client;
    },
  };
}
