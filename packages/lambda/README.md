# @computesdk/lambda

Lambda provider for ComputeSDK - enables sandbox creation and management on Lambda cloud infrastructure.

## Installation

```bash
npm install @computesdk/lambda
```

## Usage

```typescript
import { lambda } from '@computesdk/lambda';

const compute = lambda({
  apiKey: 'your-lambda-api-key', // or set LAMBDA_API_KEY environment variable
  regionName: 'us-west-1', // or set LAMBDA_REGION_NAME environment variable
  instanceTypeName: 'gpu_1x_a10', // or set LAMBDA_INSTANCE_TYPE_NAME environment variable
  sshKeyName: 'your-ssh-key' // or set LAMBDA_SSH_KEY_NAME environment variable
});

// Create a new sandbox
const { sandbox, sandboxId } = await compute.sandbox.create({
  runtime: 'node' // or 'python'
});

// List all sandboxes
const sandboxes = await compute.sandbox.list();

// Get a specific sandbox
const retrieved = await compute.sandbox.getById(sandboxId);

// Destroy a sandbox
await compute.sandbox.destroy(sandboxId);
```

## Configuration

Set the following environment variables or pass them in the config object:

- `LAMBDA_API_KEY` - Your Lambda API key
- `LAMBDA_REGION_NAME` - Lambda region (e.g., 'us-west-1')
- `LAMBDA_INSTANCE_TYPE_NAME` - Instance type (e.g., 'gpu_1x_a10')
- `LAMBDA_SSH_KEY_NAME` - SSH key name for instance access


## License

MIT