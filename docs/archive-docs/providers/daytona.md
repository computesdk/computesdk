# Daytona

Daytona provider for ComputeSDK - Execute code in Daytona development workspaces.

## Installation & Setup

```bash
npm install computesdk

# add to .env file
COMPUTESDK_API_KEY=your_computesdk_api_key

DAYTONA_API_KEY=your_daytona_api_key
```


## Usage

### With ComputeSDK

```typescript
import { compute } from 'computesdk';
// auto-detects provider from environment variables

// Create sandbox
const sandbox = await compute.sandbox.create();

// Execute code
const result = await sandbox.runCode('print("Hello from Daytona!")');
console.log(result.stdout); // "Hello from Daytona!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

### Configuration Options

```typescript
interface DaytonaConfig {
  /** Daytona API key - if not provided, will use DAYTONA_API_KEY env var */
  apiKey?: string;
  /** Default runtime environment */
  runtime?: 'node' | 'python';
  /** Execution timeout in milliseconds */
  timeout?: number;
}
```


## Explicit Provider Configuration
If you prefer to set the provider explicitly, you can do so as follows:
```typescript
// Set as explict provider
const sandbox = compute({ 
  provider: 'daytona', 
  daytona: {
    daytonaApiKey: process.env.DAYTONA_API_KEY,
    daytonaRuntime: 'node',
    daytonaTimeout: 60000
  },
  apiKey: process.env.COMPUTESDK_API_KEY 
}).sandbox.create();
```

## Runtime Detection

The provider automatically detects the runtime based on code patterns:

**Python indicators:**
- `print` statements
- `import` statements  
- `def` function definitions
- Python-specific syntax (`f"`, `__`, etc.)

**Default:** Node.js for all other cases

## SDK Reference Links:

- **[Code Execution](/docs/reference/code-execution)** - Execute code snippets in various runtimes
- **[Command Execution](/docs/reference/code-execution#basic-code-execution)** - Run shell commands and scripts
- **[Filesystem Operations](/docs/reference/filesystem)** - Read, write, and manage files in sandboxes
- **[Sandbox Management](/docs/reference/sandbox-management)** - Create, list, and destroy sandboxes
- **[Error Handling](/docs/reference/api-integration#error-handling)** - Handle command failures and runtime errors
- **[Web Framework Integration](/docs/reference/api-integration#web-framework-integration)** - Integrate with Express, Next.js, and other frameworks
