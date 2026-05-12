# E2B

E2B provider for ComputeSDK


## Installation & Setup

```bash
npm install @computesdk/e2b
```

Add your E2B credentials to a `.env` file:

```bash
E2B_API_KEY=your_e2b_api_key
```


## Usage

```typescript
import { e2b } from '@computesdk/e2b';

const compute = e2b({
  apiKey: process.env.E2B_API_KEY,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from E2B!"');
console.log(result.stdout); // "Hello from E2B!"

// Clean up
await sandbox.destroy();
```


### Configuration Options

```typescript
interface E2BConfig {
  /** E2B API key - if not provided, will use E2B_API_KEY env var */
  apiKey?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
}
```
