# @computesdk/r2

Cloudflare R2 storage provider for ComputeSDK - S3-compatible object storage.

## Installation

```bash
npm install @computesdk/r2
```

## Usage

```typescript
import { r2 } from '@computesdk/r2';

// Create storage instance
const storage = r2({
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  accountId: process.env.R2_ACCOUNT_ID
  // Or use endpoint directly:
  // endpoint: 'https://your-account-id.r2.cloudflarestorage.com'
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
| `accessKeyId` | string | No* | `R2_ACCESS_KEY_ID` env | R2 access key |
| `secretAccessKey` | string | No* | `R2_SECRET_ACCESS_KEY` env | R2 secret key |
| `accountId` | string | No† | `R2_ACCOUNT_ID` env | Cloudflare account ID |
| `endpoint` | string | No† | - | Full R2 endpoint URL |

*Either provide in config or set environment variables.
†Either provide `accountId` (endpoint will be auto-constructed) or provide full `endpoint`.

## Environment Variables

```bash
export R2_ACCESS_KEY_ID=your-access-key
export R2_SECRET_ACCESS_KEY=your-secret-key
export R2_ACCOUNT_ID=your-account-id
```

## API

See the [@computesdk/s3](../s3/README.md) documentation for full API details.

## Getting R2 Credentials

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to R2 > Manage R2 API Tokens
3. Create a new API token with Object Read & Write permissions
4. Note the Access Key ID, Secret Access Key, and Account ID

## License

MIT
