# Blaxel

Blaxel provider for ComputeSDK - Execute code in secure Blaxel sandboxes with 25ms cold starts and real-time preview URLs.


## Installation & Setup

```bash
npm install computesdk

# add to .env file
COMPUTESDK_API_KEY=your_computesdk_api_key

BLAXEL_API_KEY=your_blaxel_api_key
BLAXEL_WORKSPACE=your_blaxel_workspace
```

## Usage

```typescript
import { compute } from 'computesdk';
// auto-detects provider from environment variables

// Create sandbox
const sandbox = await compute.sandbox.create();

// Execute code
const result = await sandbox.runCode('print("Hello from E2B!")');
console.log(result.stdout); // "Hello from E2B!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

### Configuration Options

```typescript
interface BlaxelConfig {
	/** Blaxel workspace ID - if not provided, will fallback to BL_WORKSPACE environment variable */
	workspace?: string;
	/** Blaxel API key - if not provided, will fallback to BL_API_KEY environment variable */
	apiKey?: string;
	/** Default image for sandboxes */
	image?: 'node' | 'python';
	/** Default region for sandbox deployment */
	region?: string;
	/** Default memory allocation in MB */
	memory?: number | 4096;
	/** Default ports for sandbox */
	ports?: number[] | [3000];
}
```

## Explicit Provider Configuration
If you prefer to set the provider explicitly, you can do so as follows:
```typescript
// Set as explict provider
const sandbox = compute({ 
  provider: 'blaxel', 
  blaxel: {
    blaxelApiKey: process.env.BLAXEL_API_KEY,
    blaxelWorkspace: process.env.BLAXEL_WORKSPACE,
    blaxelImage: 'node',
    blaxelRegion: 'us-east-1',
    blaxelMemory: 4096,
    blaxelPorts: [3000]
  },
  apiKey: process.env.COMPUTESDK_API_KEY 
}).sandbox.create();
```

### Default Images

The provider automatically selects images based on runtime:
- **Python:** `blaxel/prod-py-app:latest`
- **Node.js:** `blaxel/prod-ts-app:latest`
- **Default:** `blaxel/prod-base:latest`

## SDK Reference Links:

- **[Code Execution](/docs/reference/code-execution)** - Execute code snippets in various runtimes
- **[Command Execution](/docs/reference/code-execution#basic-code-execution)** - Run shell commands and scripts
- **[Filesystem Operations](/docs/reference/filesystem)** - Read, write, and manage files in sandboxes
- **[Sandbox Management](/docs/reference/sandbox-management)** - Create, list, and destroy sandboxes
- **[Error Handling](/docs/reference/api-integration#error-handling)** - Handle command failures and runtime errors
- **[Web Framework Integration](/docs/reference/api-integration#web-framework-integration)** - Integrate with Express, Next.js, and other frameworks