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

## Quick Start

### Gateway Mode (Recommended)

Use the gateway for zero-config auto-detection:

```typescript
import { compute } from 'computesdk';

// Auto-detects Railway from RAILWAY_API_KEY/RAILWAY_PROJECT_ID/RAILWAY_ENVIRONMENT_ID environment variables
const sandbox = await compute.sandbox.create();
console.log(`Created sandbox: ${sandbox.sandboxId}`);

await sandbox.destroy();
```

### Direct Mode

For direct SDK usage without the gateway:

```typescript
import { railway } from '@computesdk/railway';

const compute = railway({
  apiKey: process.env.RAILWAY_API_KEY,
  projectId: process.env.RAILWAY_PROJECT_ID,
  environmentId: process.env.RAILWAY_ENVIRONMENT_ID
});

const sandbox = await compute.sandbox.create();
console.log(`Created sandbox: ${sandbox.sandboxId}`);

await sandbox.destroy();
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