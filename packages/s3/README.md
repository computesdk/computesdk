# @computesdk/s3

AWS S3 storage provider for ComputeSDK - object storage with S3-compatible API.

## Installation

```bash
npm install @computesdk/s3
```

## Usage

```typescript
import { s3 } from '@computesdk/s3';

// Create storage instance
const storage = s3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: 'us-east-1'
});

// Upload a file
await storage.upload('my-bucket', 'path/to/file.txt', 'Hello, World!');

// Upload with options
await storage.upload('my-bucket', 'image.png', buffer, {
  contentType: 'image/png',
  metadata: { author: 'user-123' }
});

// Download a file
const result = await storage.download('my-bucket', 'path/to/file.txt');
console.log(Buffer.from(result.data).toString());

// Delete a file
await storage.delete('my-bucket', 'path/to/file.txt');

// List objects
const list = await storage.list('my-bucket', { prefix: 'path/to/' });
for (const obj of list.objects) {
  console.log(`${obj.key}: ${obj.size} bytes`);
}
```

## Configuration

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `accessKeyId` | string | No* | `AWS_ACCESS_KEY_ID` env | AWS access key |
| `secretAccessKey` | string | No* | `AWS_SECRET_ACCESS_KEY` env | AWS secret key |
| `region` | string | No | `us-east-1` | AWS region |
| `endpoint` | string | No | - | Custom endpoint for S3-compatible services |
| `forcePathStyle` | boolean | No | false | Use path-style URLs |

*Either provide in config or set environment variables.

## API

### `upload(bucket, key, data, options?)`

Upload data to S3.

- **bucket**: Bucket name
- **key**: Object key/path
- **data**: `Uint8Array` or `string` to upload (Node `Buffer` also works as it's a Uint8Array subclass)
- **options**: Optional upload configuration
  - `contentType`: MIME type (default: `application/octet-stream`)
  - `metadata`: Custom metadata object

Returns `Promise<StorageObject>` with metadata about the uploaded object.

### `download(bucket, key)`

Download data from S3.

- **bucket**: Bucket name
- **key**: Object key/path

Returns `Promise<DownloadResult>` containing:
- `data`: `Uint8Array` with object contents (Node `Buffer` can be created with `Buffer.from(data)`)
- `size`: Object size in bytes
- `contentType`: MIME type
- `etag`: Entity tag
- `lastModified`: Last modification date
- `metadata`: Custom metadata

### `delete(bucket, key)`

Delete object from S3.

- **bucket**: Bucket name
- **key**: Object key/path

Returns `Promise<void>`.

### `list(bucket, options?)`

List objects in bucket.

- **bucket**: Bucket name
- **options**: Optional list configuration
  - `prefix`: Filter by prefix
  - `maxKeys`: Maximum results (default: 1000)
  - `continuationToken`: Pagination token

Returns `Promise<ListResult>` containing:
- `objects`: Array of `StorageObject`
- `truncated`: Whether there are more results
- `continuationToken`: Token for next page

### `getClient()`

Get the underlying AWS S3 client for advanced operations.

Returns `S3Client` from `@aws-sdk/client-s3`.

## Environment Variables

```bash
export AWS_ACCESS_KEY_ID=your-access-key
export AWS_SECRET_ACCESS_KEY=your-secret-key
export AWS_REGION=us-east-1  # optional, defaults to us-east-1
```

## License

MIT
