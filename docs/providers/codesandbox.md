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

// Run a command
const result = await sandbox.runCommand('echo "Hello from CodeSandbox!"');
console.log(result.stdout); // "Hello from CodeSandbox!"

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
