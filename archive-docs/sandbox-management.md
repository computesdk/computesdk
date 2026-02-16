# Sandbox Management

ComputeSDK provides a simple interface for creating and managing sandboxed environments.

## Quick Start

```typescript
import { createCompute } from 'computesdk'
import { e2b } from '@computesdk/e2b'

// Create a compute instance with the provider configuration
const compute = createCompute({
  defaultProvider: e2b({ apiKey: 'your-api-key' })
})

// Create a sandbox with default options
const sandbox = await compute.sandbox.create()

try {
  // Execute a command
  const result = await sandbox.runCommand('echo', ['Hello, World!'])
  console.log(result.stdout) // 'Hello, World!'
} finally {
  // Clean up when done
  await sandbox.destroy()
}
```

## Sandbox Creation

### Basic Creation

```typescript
import { createCompute } from 'computesdk'
import { e2b } from '@computesdk/e2b'

// Create a compute instance
const compute = createCompute({
  defaultProvider: e2b({ apiKey: 'your-api-key' })
})

// Create a sandbox with default options
const sandbox1 = await compute.sandbox.create()

// Create a sandbox with options
const sandbox2 = await compute.sandbox.create({
  runtime: 'python3.9',
  timeout: 30000, // 30 seconds
  metadata: {
    project: 'my-project'
  }
})
```

## Sandbox Operations

### Running Commands

```typescript
// Run a simple command
const result = await sandbox.runCommand('echo', ['Hello, World!'])
console.log(result.stdout) // 'Hello, World!'
console.log(result.exitCode) // 0

// Run a command with options
const bgResult = await sandbox.runCommand('long-running-process', [], {
  background: true
})
console.log('Process ID:', bgResult.pid)
```

### Getting Sandbox Information

```typescript
// Get sandbox information
const info = await sandbox.getInfo()
console.log('Sandbox ID:', info.sandboxId)
console.log('Status:', info.status)
console.log('Created at:', info.createdAt)
```

### Getting Sandbox URL

```typescript
// Get URL for accessing a service on a specific port
const url = await sandbox.getUrl({ port: 3000 })
console.log('Sandbox URL:', url)
```

## Error Handling

```typescript
try {
  // This will throw if the command fails
  await sandbox.runCommand('non-existent-command')
} catch (error) {
  if (error instanceof CommandExitError) {
    console.error('Command failed with exit code:', error.result.exitCode)
    console.error('Error output:', error.result.stderr)
  } else {
    console.error('Unexpected error:', error)
  }
}
```

## Extending Sandbox Timeout (Not implemented yet)

You can extend the timeout/expiration of a sandbox to keep it alive longer:

```typescript
// Extend timeout by default 15 minutes
await compute.sandbox.extendTimeout(sandbox.sandboxId)

// Extend timeout by custom duration (30 minutes)
await compute.sandbox.extendTimeout(sandbox.sandboxId, {
  duration: 30 * 60 * 1000
})

// Useful for long-running tasks
const sandbox = await compute.sandbox.create({
  timeout: 30 * 60 * 1000 // Start with 30 minutes
})

// Later, before timeout expires, extend it
await compute.sandbox.extendTimeout(sandbox.sandboxId, {
  duration: 60 * 60 * 1000 // Add 1 more hour
})
```

**Note:** `extendTimeout` is only available with the gateway provider. Other providers will throw an error.

## Cleanup

Always clean up sandboxes when you're done with them to free up resources:

```typescript
// Destroy the sandbox
await sandbox.destroy()

// Check if sandbox is destroyed
console.log('Is destroyed?', sandbox.isDestroyed) // true
```
