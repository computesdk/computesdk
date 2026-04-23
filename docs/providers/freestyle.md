# Freestyle

Freestyle provider for ComputeSDK


## Installation & Setup

```bash
npm install @computesdk/freestyle
```

Add your Freestyle credentials to a `.env` file:

```bash
FREESTYLE_API_KEY=your_freestyle_api_key
```


## Usage

```typescript
import { freestyle } from '@computesdk/freestyle';

const compute = freestyle({
  apiKey: process.env.FREESTYLE_API_KEY,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Execute code
const result = await sandbox.runCode('print("Hello from Freestyle!")');
console.log(result.output); // "Hello from Freestyle!"

// Clean up
await sandbox.destroy();
```


### Configuration Options

```typescript
interface FreestyleConfig {
  /** Freestyle API key - if not provided, will use FREESTYLE_API_KEY env var */
  apiKey?: string;
  /** Default runtime hint used to auto-detect the language. Default: 'node' */
  runtime?: Runtime;
  /** Timeout in milliseconds for shell commands (runCommand). Default: 30000 */
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
