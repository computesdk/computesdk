# Railway

Railway provider for ComputeSDK - Deploy and manage containerized sandboxes on Railway's infrastructure.

## Installation

```bash
npm install @computesdk/railway
```

## Usage

### With ComputeSDK

```typescript
import { createCompute } from 'computesdk';
import { railway } from '@computesdk/railway';

// Set as default provider
const compute = createCompute({ 
  provider: railway({ 
    apiKey: process.env.RAILWAY_API_KEY,
    projectId: process.env.RAILWAY_PROJECT_ID,
    environmentId: process.env.RAILWAY_ENVIRONMENT_ID
  }),
  apiKey: process.env.COMPUTESDK_API_KEY 
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// List all sandboxes
const sandboxes = await compute.sandbox.list();
console.log(`Active sandboxes: ${sandboxes.length}`);

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

## Configuration

### Environment Variables

```bash
export RAILWAY_API_KEY=your_railway_api_key
export RAILWAY_PROJECT_ID=your_railway_project_id
export RAILWAY_ENVIRONMENT_ID=your_railway_environment_id
```

### Configuration Options

```typescript
interface RailwayConfig {
  /** Railway API key - if not provided, will use RAILWAY_API_KEY env var */
  apiKey?: string;
  /** Railway Project ID - if not provided, will use RAILWAY_PROJECT_ID env var */
  projectId?: string;
  /** Railway Environment ID - if not provided, will use RAILWAY_ENVIRONMENT_ID env var */
  environmentId?: string;
}
```

### Getting Your Railway Credentials

1. **API Key**: Generate a personal API token from [Railway Dashboard → Account Settings → Tokens](https://railway.app/account/tokens)
2. **Project ID**: Found in your Railway project URL: `https://railway.app/project/{PROJECT_ID}`
3. **Environment ID**: Available in your project's environment settings


## SDK Reference Links:

- **[Sandbox Management](/docs/reference/sandbox-management)** - Create, list, and destroy sandboxes
- **[Code Execution](/docs/reference/code-execution)** - Execute code snippets in various runtimes
- **[Command Execution](/docs/reference/code-execution#basic-code-execution)** - Run shell commands and scripts
- **[Filesystem Operations](/docs/reference/filesystem)** - Read, write, and manage files in sandboxes
- **[Error Handling](/docs/reference/api-integration#error-handling)** - Handle command failures and runtime errors

## Implementation Notes

- Services are automatically deployed upon creation
- Sandboxes are backed by Railway services in your specified project and environment
- Destroy operations gracefully handle already-deleted services
