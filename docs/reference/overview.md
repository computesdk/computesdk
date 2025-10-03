# ComputeSDK: Secure Code Execution Anywhere

ComputeSDK provides a unified interface for running code in secure, isolated environments across multiple cloud providers. Whether you're building AI applications, developer tools, or serverless backends, ComputeSDK makes it easy to execute untrusted code safely.

## Core Concepts

### Sandbox: Your Isolated Workspace
A sandbox is an isolated environment where your code executes securely. Each sandbox provides:
- Isolated filesystem
- Network restrictions
- Resource limits
- Clean environment for each execution

Learn more about [managing sandboxes →](./sandbox-management.md)

### Providers: Powering Your Sandboxes
ComputeSDK supports multiple execution backends (see providers for details)

[Configure your provider →](./configuration.md)

## Key Features

### 1. Run Node.js & Python code
Execute code in multiple languages with automatic runtime detection:
- Python
- Node.js
- Shell commands

[Learn about code execution →](./code-execution.md)

### 2. Full Filesystem Access
Interact with files in your sandbox:

[Explore filesystem operations →](./filesystem.md)

### 3. Web Integration
Build interactive web applications using our UI package:

[See UI package →](./ui-package.md)

## Getting Started

### Installation
```bash
npm install computesdk
# or
yarn add computesdk
```

### Basic Usage
```typescript
import { createCompute } from 'computesdk';

// Initialize with default provider (E2B)
const compute = createCompute();

// Create a sandbox
const sandbox = await compute.sandbox.create({
  options: {
    templateId: 'python',
    timeout: 30000
  }
});

try {
  // Run a command
  const result = await sandbox.runCommand('python', ['-c', 'print(2 + 2)']);
  console.log(result.stdout); // 4
  
  // Work with files
  await sandbox.filesystem.writeFile('/app/hello.py', 'print("Hello from Python!")');
  const fileResult = await sandbox.runCommand('python', ['/app/hello.py']);
  console.log(fileResult.stdout); // Hello from Python!
  
} finally {
  // Always clean up
  await compute.sandbox.destroy(sandbox.sandboxId);
}
```
[View full API reference →](./code-execution.md)
