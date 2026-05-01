# Agentuity

Agentuity provider for ComputeSDK


## Installation & Setup

```bash
npm install @computesdk/agentuity
```

Add your Agentuity credentials to a `.env` file:

```bash
AGENTUITY_SDK_KEY=your_agentuity_sdk_key
```


## Usage

```typescript
import { agentuity } from '@computesdk/agentuity';

const compute = agentuity({
  apiKey: process.env.AGENTUITY_SDK_KEY,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Agentuity!"');
console.log(result.stdout); // "Hello from Agentuity!"

// Clean up
await sandbox.destroy();
```


### Configuration Options

```typescript
interface AgentuityConfig {
  /** Agentuity SDK key - if not provided, will use AGENTUITY_SDK_KEY env var */
  apiKey?: string;
  /** Region for API endpoints ('local', 'usc', or a full custom base URL). Default: 'usc' */
  region?: string;
  /** Override the sandbox base URL entirely */
  baseURL?: string;
  /** Default runtime, e.g. 'bun:1', 'python:3.14', 'node:22' */
  runtime?: string;
  /** Idle timeout passed to the sandbox (e.g. '5m', '1h') */
  idleTimeout?: string;
  /** Execution timeout passed to the sandbox (e.g. '30m', '2h') */
  executionTimeout?: string;
}
```
