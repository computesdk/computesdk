# @computesdk/tigris

Tigris storage provider for ComputeSDK using the official Tigris Storage SDK.

## Installation

```bash
npm install @computesdk/tigris
```

## Usage

```typescript
import { tigris } from '@computesdk/tigris';

// Create storage instance
const storage = tigris({
  accessKeyId: process.env.TIGRIS_STORAGE_ACCESS_KEY_ID,
  secretAccessKey: process.env.TIGRIS_STORAGE_SECRET_ACCESS_KEY,
  bucket: process.env.TIGRIS_STORAGE_BUCKET
});

// Upload a file
await storage.upload('my-bucket', 'path/to/file.txt', 'Hello, World!');

// Download a file
const result = await storage.download('my-bucket', 'path/to/file.txt');
console.log(result.data.toString());

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
| `accessKeyId` | string | No* | `TIGRIS_STORAGE_ACCESS_KEY_ID` env | Tigris access key ID |
| `secretAccessKey` | string | No* | `TIGRIS_STORAGE_SECRET_ACCESS_KEY` env | Tigris secret access key |

*Either provide in config or set environment variables.

## Environment Variables

```bash
export TIGRIS_STORAGE_ACCESS_KEY_ID=your-access-key-id
export TIGRIS_STORAGE_SECRET_ACCESS_KEY=your-secret-access-key
export TIGRIS_STORAGE_BUCKET=your-bucket-name
```

## API

See the [@computesdk/s3](../s3/README.md) documentation for full API details.

## Getting Tigris Credentials

1. Go to [Tigris Dashboard](https://console.tigris.dev/)
2. Create a new bucket or use an existing one
3. Generate access keys with appropriate permissions
4. Note the Access Key ID and Secret Access Key

## License

MIT
