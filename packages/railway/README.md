# @computesdk/railway

Railway provider for ComputeSDK that enables creating and managing containerized sandboxes on Railway's infrastructure.

## Installation

```bash
npm install @computesdk/railway
```

## Configuration

The Railway provider requires the following environment variables:

```bash
RAILWAY_API_KEY=your_railway_api_key
RAILWAY_PROJECT_ID=your_railway_project_id
RAILWAY_ENVIRONMENT_ID=your_railway_environment_id
```

## Usage

```typescript
import { railway } from '@computesdk/railway';

const provider = railway({
  apiKey: 'your_api_key',
  projectId: 'your_project_id',
  environmentId: 'your_environment_id'
});

// Create a sandbox
const sandbox = await provider.sandbox.create({ runtime: 'node' });
console.log(`Created sandbox: ${sandbox.sandboxId}`);

// Destroy the sandbox
await provider.sandbox.destroy(sandbox.sandboxId);
```

## Currently Implemented

### Sandbox Operations
- **create()** - Creates a new Railway service with Docker container deployment
- **destroy()** - Deletes a Railway service

### Supported Runtimes
- **node** - Uses `node:alpine` Docker image
- **python** - Uses `python:alpine` Docker image (default)

### Configuration Options
- **apiKey** - Railway API authentication token
- **projectId** - Railway project identifier
- **environmentId** - Railway environment identifier

## Notes

- Services are automatically deployed upon creation
- Service names are generated with timestamp: `sandbox-{timestamp}`
- All operations use Railway's GraphQL API
- Environment variables take precedence over config options