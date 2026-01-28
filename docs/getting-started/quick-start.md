# Quick Start

Welcome to ComputeSDK! This guide will get you up and running with secure, isolated code execution across multiple cloud providers using a unified TypeScript interface.


<br />

## Get an API Key

1) Visit https://console.computesdk.com/register to create an account and get your ComputeSDK API key.
2) Next create a .env file in the root of your project and add your API key (this is where you will store your API keys for each of your providers):

```bash
COMPUTESDK_API_KEY=your_api_key_here

# Add your provider API key (e.g., E2B, Modal, Railway, etc.)
E2B_API_KEY=your_e2b_api_key_here
```

## Installation

```bash
npm install computesdk
```

## Basic Usage

A **sandbox** is an isolated compute environment where you can safely execute code. Each sandbox runs on your chosen cloud provider (E2B, Railway, Modal, etc.) with a unified interface. The `create()` method provisions a new sandbox, `runCode()` executes code and returns the output, and `destroy()` tears down the sandbox to free resources.

```typescript
import { compute } from 'computesdk';


// Create a sandbox
const sandbox = await compute.sandbox.create();

// Execute code
const result = await sandbox.runCode('print("Hello World!")');
console.log(result.output); // "Hello World!"

// Clean up
await sandbox.destroy();
```


## Filesystem Operations

Each sandbox has its own isolated filesystem. You can read, write, and manage files using absolute paths (starting with `/`). Files persist for the sandbox lifetime and are destroyed when you call `destroy()`.

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

Use `runCommand()` for shell operations, package installation, or system commands. It provides full shell access with detailed execution results including stdout, stderr, exit codes, and execution time.

```typescript
// Run shell command
const result = await sandbox.runCommand('ls -la');
console.log(result.stdout);

// With different working directory
const result2 = await sandbox.runCommand('pwd', { cwd: '/tmp' });
```

## Error Handling

ComputeSDK methods throw exceptions for API/network failures. For command execution errors, check the `exitCode` in the result rather than relying on exceptions. Exit code `0` indicates success, non-zero indicates failure.

```typescript
try {
  const sandbox = await compute.sandbox.create();
  const result = await sandbox.runCode('invalid code');
} catch (error) {
  console.error('Execution failed:', error.message);
}
```

## Essential Patterns

### Resource Cleanup (Critical for Production)

Always destroy sandboxes when done to avoid resource leaks and unnecessary costs. Sandboxes consume resources until explicitly destroyed or they timeout.

```typescript
// ✅ Recommended: Use try-finally
let sandbox;
try {
  sandbox = await compute.sandbox.create();
  await sandbox.runCode('print("Hello")');
} finally {
  if (sandbox) {
    await sandbox.destroy();
  }
}
```

### Error Handling with Exit Codes

Commands return exit codes following Unix conventions: `0` means success, non-zero indicates failure. Always check `exitCode` rather than catching exceptions for command failures.

```typescript
const result = await sandbox.runCommand('npm test');
if (result.exitCode !== 0) {
  console.error('Tests failed:', result.stderr);
} else {
  console.log('Tests passed!', result.stdout);
}
```

## Understanding Results

### Code Execution Results

When you call `runCode()`, you receive:
- `output`: Combined stdout/stderr from your code
- `exitCode`: `0` for success, non-zero for errors  
- `language`: Detected or specified language (`'python'`, `'node'`, etc.)

```typescript
const result = await sandbox.runCode('print("Hello")');
console.log(result.output);    // "Hello\n"
console.log(result.exitCode);  // 0
console.log(result.language);  // "python"
```

### Command Execution Results

When you call `runCommand()`, you receive:
- `stdout`: Standard output (normal program output)
- `stderr`: Standard error (error messages and warnings)
- `exitCode`: `0` for success, non-zero for failures
- `durationMs`: Execution time in milliseconds

```typescript
const result = await sandbox.runCommand('npm install');
console.log(result.stdout);      // Installation logs
console.log(result.stderr);      // Warnings or errors
console.log(result.exitCode);    // 0
console.log(result.durationMs);  // 2341
```

## Named Sandboxes

Named sandboxes let you create persistent, reusable sandbox instances. If a sandbox with the same name already exists, `findOrCreate()` returns the existing one instead of creating a duplicate.

```typescript
// Find or create a sandbox by name
const sandbox = await compute.sandbox.findOrCreate({
  name: 'my-project',
  namespace: 'user-123',  // Optional: isolate by user, team, etc.
});

// The same call later returns the same sandbox
const sameSandbox = await compute.sandbox.findOrCreate({
  name: 'my-project',
  namespace: 'user-123',
});
```

## What's Next?

- **[Overlays](/docs/features/overlays)** - Bootstrap sandboxes from templates instantly
- **[Servers](/docs/features/servers)** - Run managed dev servers with health checks
- **[Client-Side Access](/docs/features/client-access)** - Delegate sandbox access to browser clients
- **[Named Sandboxes](/docs/features/named-sandboxes)** - Persistent, reusable sandbox patterns
