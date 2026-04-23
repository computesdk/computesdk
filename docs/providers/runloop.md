# Runloop

Runloop provider for ComputeSDK


## Installation & Setup

```bash
npm install @computesdk/runloop
```

Add your Runloop credentials to a `.env` file:

```bash
RUNLOOP_API_KEY=your_runloop_api_key
```


## Usage

```typescript
import { runloop } from '@computesdk/runloop';

const compute = runloop({
  apiKey: process.env.RUNLOOP_API_KEY,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Execute code
const result = await sandbox.runCode('print("Hello from Runloop!")');
console.log(result.output); // "Hello from Runloop!"

// Clean up
await sandbox.destroy();
```


### Configuration Options

```typescript
interface RunloopConfig {
  /** Runloop API key - if not provided, will use RUNLOOP_API_KEY env var */
  apiKey?: string;
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
