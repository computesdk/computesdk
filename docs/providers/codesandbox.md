# CodeSandbox

CodeSandbox provider for ComputeSDK - Execute code in CodeSandbox development environments.

## Installation & Setup

```bash
npm install @computesdk/codesandbox
```

Add your CodeSandbox credentials to a `.env` file:

```bash
CSB_API_KEY=your_codesandbox_api_key
```


## Usage

```typescript
import { codesandbox } from '@computesdk/codesandbox';

const compute = codesandbox({
  apiKey: process.env.CSB_API_KEY,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Execute code
const result = await sandbox.runCode('print("Hello from CodeSandbox!")');
console.log(result.output); // "Hello from CodeSandbox!"

// Clean up
await sandbox.destroy();
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

## Runtime Detection

The provider automatically detects the runtime based on code patterns:

**Python indicators:**
- `print` statements
- `import` statements  
- `def` function definitions
- Python-specific syntax (`f"`, `__`, etc.)

**Default:** Node.js for all other cases
