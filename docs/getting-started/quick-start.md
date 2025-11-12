# Quick Start

Welcome to ComputeSDK! This guide will get you up and running with secure, isolated code execution across multiple cloud providers using a unified TypeScript interface.

<br />

<div class="bg-emerald-100/20 border-l-4 border-emerald-800/20 dark:bg-emerald-800/30 dark:border-emerald-100/20 p-6 my-2 rounded flex flex-col gap-4">
  <strong>For a quick interactive demo of the SDK in action:</strong>
  
  ```bash
  curl -fsSL https://computesdk.com/install.sh | sh
  ```
</div>

<br />

## Get an API Key

1) Visit https://console.computesdk.com/register to create an account and get your ComputeSDK API key.
2) Next create a .env file in the root of your project and add your API key (this is where you will store your API keys for each of your providers):

```bash
COMPUTESDK_API_KEY=your_api_key_here
```

## Installation

```bash
# Core SDK
npm install computesdk

# Provider packages (install only what you need)
npm install @computesdk/blaxel     # Blaxel provider
npm install @computesdk/codesandbox # CodeSandbox provider
npm install @computesdk/daytona    # Daytona provider
npm install @computesdk/e2b        # E2B provider
npm install @computesdk/modal      # Modal provider
npm install @computesdk/vercel     # Vercel provider  

# Frontend integration (optional)
npm install @computesdk/ui         # React hooks and utilities
```

## Basic Usage

```typescript
import { createCompute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

// Set default provider
const compute = createCompute({ 
  defaultProvider: e2b({ apiKey: process.env.E2B_API_KEY }),
  apiKey: process.env.COMPUTESDK_API_KEY 
});

// Create a sandbox
const sandbox = await compute.sandbox.create();

// Get instance
const instance = sandbox.getInstance();

// Execute code
const result = await sandbox.runCode('print("Hello World!")');
console.log(result.stdout); // "Hello World!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```


## Filesystem Operations

```typescript
// Write file
await sandbox.filesystem.writeFile('/tmp/hello.py', 'print("Hello")');

// Read file
const content = await sandbox.filesystem.readFile('/tmp/hello.py');

// Create directory
await sandbox.filesystem.mkdir('/tmp/mydir');

// List directory
const files = await sandbox.filesystem.readdir('/tmp');

// Check if exists
const exists = await sandbox.filesystem.exists('/tmp/hello.py');

// Remove file/directory
await sandbox.filesystem.remove('/tmp/hello.py');
```

## Shell Commands

```typescript
// Run shell command
const result = await sandbox.runCommand('ls', ['-la']);
console.log(result.stdout);

// With different working directory
const result2 = await sandbox.runCommand('pwd', [], { cwd: '/tmp' });
```

## Error Handling

```typescript
try {
  const sandbox = await compute.sandbox.create();
  const result = await sandbox.runCode('invalid code');
} catch (error) {
  console.error('Execution failed:', error.message);
  // Handle specific error types as needed
}
```

