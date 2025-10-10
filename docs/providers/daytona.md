# Daytona

Daytona provider for ComputeSDK - Execute code in Daytona development workspaces.

## Installation

```bash
npm install @computesdk/daytona
```

## Usage

### With ComputeSDK

```typescript
import { createCompute } from 'computesdk';
import { daytona } from '@computesdk/daytona';

// Set as default provider
const compute = createCompute({ 
  provider: daytona({ apiKey: process.env.DAYTONA_API_KEY }) 
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Get instance
const instance = sandbox.getInstance();

// Execute code
const result = await sandbox.runCode('print("Hello from Daytona!")');
console.log(result.stdout); // "Hello from Daytona!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

## Configuration

### Environment Variables

```bash
export DAYTONA_API_KEY=your_api_key_here
```

### Configuration Options

```typescript
interface DaytonaConfig {
  /** Daytona API key - if not provided, will use DAYTONA_API_KEY env var */
  apiKey?: string;
  /** Default runtime environment */
  runtime?: 'python' | 'node';
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Base URL for Daytona API */
  baseUrl?: string;
}
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

- **[Code Execution](https://www.computesdk.com/docs/reference/code-execution)** - Execute code snippets in various runtimes
- **[Command Execution](https://www.computesdk.com/docs/reference/code-execution#runcommand-method)** - Run shell commands and scripts
- **[Filesystem Operations](https://www.computesdk.com/docs/reference/filesystem)** - Read, write, and manage files in sandboxes
- **[Sandbox Management](https://www.computesdk.com/docs/reference/sandbox-management)** - Create, list, and destroy sandboxes
- **[Error Handling](https://www.computesdk.com/docs/reference/api-integration#error-handling)** - Handle command failures and runtime errors
- **[Web Framework Integration](https://www.computesdk.com/docs/reference/api-integration#web-framework-integration)** - Integrate with Express, Next.js, and other frameworks
