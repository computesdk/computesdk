# E2B

E2B provider for ComputeSDK - Execute code in full development environments with terminal support.

## Installation

```bash
npm install @computesdk/e2b
```

## Usage

### With ComputeSDK

```typescript
import { createCompute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

// Set as default provider
const compute = createCompute({ 
  provider: e2b({ apiKey: process.env.E2B_API_KEY }) 
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Get instance
const instance = sandbox.getInstance();

// Execute code
const result = await sandbox.runCode('print("Hello from E2B!")');
console.log(result.stdout); // "Hello from E2B!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

### Direct Usage

```typescript
import { e2b } from '@computesdk/e2b';

// Create provider
const provider = e2b({ 
  apiKey: 'your-api-key',
  template: 'base'
});

// Use with compute singleton
const sandbox = await compute.sandbox.create({ provider });
```

## Configuration

### Environment Variables

```bash
export E2B_API_KEY=e2b_your_api_key_here
```

### Configuration Options

```typescript
interface E2BConfig {
  /** E2B API key - if not provided, will use E2B_API_KEY env var */
  apiKey?: string;
  /** Environment template to use */
  template?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Custom API URL */
  apiUrl?: string;
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
- **[Sandbox Management](https://www.computesdk.com/docs/reference/sandbox-management.md)** - Create, list, and destroy sandboxes
- **[Error Handling](https://www.computesdk.com/docs/reference/api-integration.md#error-handling)** - Handle command failures and runtime errors
- **[Web Framework Integration](https://www.computesdk.com/docs/reference/api-integration#web-framework-integration)** - Integrate with Express, Next.js, and other frameworks

