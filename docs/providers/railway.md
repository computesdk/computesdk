# Railway

Railway provider for ComputeSDK - Deploy and manage containerized sandboxes on Railway's infrastructure.

## Installation & Setup

```bash
npm install computesdk

# add to .env file
COMPUTESDK_API_KEY=your_computesdk_api_key

RAILWAY_API_KEY=your_railway_api_key
RAILWAY_PROJECT_ID=your_railway_project_id
RAILWAY_ENVIRONMENT_ID=your_railway_environment_id
```


## Usage

```typescript
import { compute } from 'computesdk';
// auto-detects provider from environment variables

// Create sandbox
const sandbox = await compute.sandbox.create();

// List all sandboxes
const sandboxes = await compute.sandbox.list();
console.log(`Active sandboxes: ${sandboxes.length}`);

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
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


## Explicit Provider Configuration
If you prefer to set the provider explicitly, you can do so as follows:
```typescript
// Set as explict provider
const sandbox = compute({
  provider: 'railway',
  railway: {
    railwayApiKey: 'your_railway_api_key',
    railwayProjectId: 'your_railway_project_id',
    railwayEnvironmentId: 'your_railway_environment_id'
  },
  computesdkApiKey: 'your_computesdk_api_key'
}).sandbox.create()
```



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
