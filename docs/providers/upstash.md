# Upstash

Upstash provider for ComputeSDK


## Installation & Setup

```bash
npm install @computesdk/upstash
```

Add your Upstash credentials to a `.env` file:

```bash
UPSTASH_BOX_API_KEY=your_upstash_box_api_key
```


## Usage

```typescript
import { upstash } from '@computesdk/upstash';

const compute = upstash({
  apiKey: process.env.UPSTASH_BOX_API_KEY,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Execute code
const result = await sandbox.runCode('print("Hello from Upstash!")');
console.log(result.output); // "Hello from Upstash!"

// Clean up
await sandbox.destroy();
```


### Configuration Options

```typescript
interface UpstashConfig {
  /** Upstash Box API key - if not provided, will use UPSTASH_BOX_API_KEY env var */
  apiKey?: string;
  /** Default runtime environment */
  runtime?: Runtime;
  /** Execution timeout in milliseconds (default: 600000) */
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
