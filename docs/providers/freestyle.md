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

// Run a command
const result = await sandbox.runCommand('echo "Hello from Freestyle!"');
console.log(result.stdout); // "Hello from Freestyle!"

// Clean up
await sandbox.destroy();
```


### Configuration Options

```typescript
interface FreestyleConfig {
  /** Freestyle API key - if not provided, will use FREESTYLE_API_KEY env var */
  apiKey?: string;
  /** Default runtime hint (e.g. 'node', 'python'). Default: 'node' */
  runtime?: string;
  /** Timeout in milliseconds for shell commands (runCommand). Default: 30000 */
  timeout?: number;
}
```
