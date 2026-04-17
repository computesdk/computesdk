# HopX

HopX provider for ComputeSDK


## Installation & Setup

```bash
npm install @computesdk/hopx
```

Add your HopX credentials to a `.env` file:

```bash
HOPX_API_KEY=your_hopx_api_key
```


## Usage

```typescript
import { hopx } from '@computesdk/hopx';

const compute = hopx({
  apiKey: process.env.HOPX_API_KEY,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Execute code
const result = await sandbox.runCode('print("Hello from HopX!")');
console.log(result.output); // "Hello from HopX!"

// Clean up
await sandbox.destroy();
```


### Configuration Options

```typescript
interface HopxConfig {
  /** HopX API key - if not provided, will use HOPX_API_KEY env var */
  apiKey?: string;
  /** Default runtime environment */
  runtime?: Runtime;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Template name for sandbox creation (e.g. 'code-interpreter') */
  template?: string;
  /** Base API URL for custom/staging environments */
  baseURL?: string;
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
