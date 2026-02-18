# Codesandbox

Codesandbox provider for ComputeSDK - Execute code in Codesandbox development environments.

## Installation & Setup

```bash
npm install computesdk

# add to .env file
COMPUTESDK_API_KEY=your_computesdk_api_key

CSB_API_KEY=your_codesandbox_api_key
```


## Usage

### With ComputeSDK

```typescript
import { compute } from 'computesdk';
// auto-detects provider from environment variables

// Create sandbox
const sandbox = await compute.sandbox.create();

// Execute code
const result = await sandbox.runCode('print("Hello from Codesandbox!")');
console.log(result.stdout); // "Hello from Codesandbox!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

### Configuration Options

```typescript
interface CodesandboxConfig {
  /** CodeSandbox API key - if not provided, will fallback to CSB_API_KEY environment variable */
  apiKey?: string;
  /** Template to use for new sandboxes */
  templateId?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
}
```


## Explicit Provider Configuration
If you prefer to set the provider explicitly, you can do so as follows:
```typescript
import { compute } from 'computesdk';

compute.setConfig({
   computesdkApiKey: process.env.COMPUTESDK_API_KEY,
   provider: 'codesandbox',
   codesandbox: {
     apiKey: process.env.CSB_API_KEY
   }
});

const sandbox = await compute.sandbox.create();
```

## Runtime Detection

The provider automatically detects the runtime based on code patterns:

**Python indicators:**
- `print` statements
- `import` statements  
- `def` function definitions
- Python-specific syntax (`f"`, `__`, etc.)

**Default:** Node.js for all other cases
