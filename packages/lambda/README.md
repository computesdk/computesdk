# @computesdk/lambda

Lambda provider for ComputeSDK - enables sandbox creation and management on Lambda cloud infrastructure.

## Installation

```bash
npm install @computesdk/lambda
```

## Usage

### Gateway Mode (Recommended)

Use the gateway for zero-config auto-detection:

```typescript
import { compute } from 'computesdk';

// Auto-detects Lambda from LAMBDA_API_KEY environment variable
const sandbox = await compute.sandbox.create();
console.log(`Created sandbox: ${sandbox.id}`);

// List all sandboxes
const sandboxes = await compute.sandbox.list();

// Destroy the sandbox
await sandbox.destroy();
```

### Direct Mode

For direct SDK usage without the gateway:

```typescript
import { lambda } from '@computesdk/lambda';

const compute = lambda({
  apiKey: 'your-lambda-api-key', // or set LAMBDA_API_KEY environment variable
  regionName: 'us-west-1', // or set LAMBDA_REGION_NAME environment variable
  instanceTypeName: 'gpu_1x_a10', // or set LAMBDA_INSTANCE_TYPE_NAME environment variable
  sshKeyName: 'your-ssh-key' // or set LAMBDA_SSH_KEY_NAME environment variable
});

// Create a new sandbox
const sandbox = await compute.sandbox.create({
  runtime: 'node' // or 'python'
});
console.log(`Created sandbox: ${sandbox.id}`);

// List all sandboxes
const sandboxes = await compute.sandbox.list();

// Destroy the sandbox
await sandbox.destroy();
```

## Configuration

Set the following environment variables or pass them in the config object:

- `LAMBDA_API_KEY` - Your Lambda API key
- `LAMBDA_REGION_NAME` - Lambda region (e.g., 'us-west-1')
- `LAMBDA_INSTANCE_TYPE_NAME` - Instance type (e.g., 'gpu_1x_a10')
- `LAMBDA_SSH_KEY_NAME` - SSH key name for instance access


## License

MIT