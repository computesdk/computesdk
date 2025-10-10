# API Integration

ComputeSDK provides a unified interface for working with compute sandboxes across different providers. This document covers how to integrate with the ComputeSDK API in your applications.

## Core Concepts

The ComputeSDK follows a provider-based architecture where different compute providers can be used through a consistent interface. The main components are:

- `compute`: The main entry point for creating and managing sandboxes
- `providers`: Plugins that implement the compute interface for different backends
- `sandbox`: An isolated environment for executing code and commands

## Installation

```bash
npm install computesdk @computesdk/e2b
# or
yarn add computesdk @computesdk/e2b
```

## Basic Usage

### Initialization

```typescript
import { createCompute } from 'computesdk'
import { e2b } from '@computesdk/e2b'

// Initialize with default provider
const compute = createCompute({
  defaultProvider: e2b({
    apiKey: process.env.E2B_API_KEY  // Required for E2B provider
  })
})
```

### See also:

- **[Code Execution](https://www.computesdk.com/docs/reference/code-execution)** - Execute code snippets in various runtimes
- **[Command Execution](https://www.computesdk.com/docs/reference/code-execution#runcommand-method)** - Run shell commands and scripts
- **[Filesystem Operations](https://www.computesdk.com/docs/reference/filesystem)** - Read, write, and manage files in sandboxes
- **[Sandbox Management](https://www.computesdk.com/docs/reference/sandbox-management.md)** - Create, list, and destroy sandboxes


## Web Framework Integration

The SDK provides a request handler for easy integration with web frameworks:

```typescript
import { handleComputeRequest } from 'computesdk'
import { e2b } from '@computesdk/e2b'

// Example with Express
app.post('/api/compute', async (req, res) => {
  try {
    const response = await handleComputeRequest({
      request: req.body,
      provider: e2b({ apiKey: process.env.E2B_API_KEY })
    })
    res.json(response)
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})
```

### Request Format

```typescript
{
  "action": "compute.sandbox.create",  // Required: Action to perform
  "sandboxId": "optional-id",         // Optional: Target sandbox ID
  "command": "python",                // For runCommand action
  "args": ["script.py"],              // Command arguments
  "code": "print('hello')",           // For direct code execution
  "path": "/path/to/file",            // For file operations
  "content": "file content"           // For file write operations
}
```

## Error Handling

```typescript
import { CommandExitError } from 'computesdk'

try {
  const result = await sandbox.runCommand('false') // Will exit with non-zero status
} catch (error) {
  if (error instanceof CommandExitError) {
    console.error('Command failed:', error.result.stderr)
    console.error('Exit code:', error.result.exitCode)
  } else {
    console.error('Unexpected error:', error)
  }
}
```


## Best Practices

1. **Resource Management**: Always call `sandbox.destroy()` when done
2. **Error Handling**: Handle both command failures and runtime errors
3. **Timeouts**: Set appropriate timeouts for operations
4. **Cleanup**: Implement proper cleanup in error handlers
5. **Logging**: Add logging for debugging and monitoring


## Sandbox Options

When creating a sandbox, you can configure various options to customize its behavior. Here are the supported options:

### Supported Options

- **`runtime`** (string): Specifies the runtime environment for the sandbox (e.g., 'python3.9', 'nodejs16').
  ```typescript
  const sandbox = await compute.sandbox.create({
    runtime: 'python3.9'
  });
  ```

- **`timeout`** (number): Maximum execution time in milliseconds before the sandbox times out.
  ```typescript
  const sandbox = await compute.sandbox.create({
    timeout: 60000 // 1 minute timeout
  });
  ```

- **`sandboxId`** (string): Optional custom identifier for the sandbox. If not provided, one will be generated.
  ```typescript
  const sandbox = await compute.sandbox.create({
    sandboxId: 'my-custom-sandbox-123'
  });
  ```

- **`templateId`** (string): Identifier for a predefined template to use for the sandbox.
  ```typescript
  const sandbox = await compute.sandbox.create({
    templateId: 'data-science-template'
  });
  ```

- **`metadata`** (object): Custom key-value pairs to store additional metadata with the sandbox.
  ```typescript
  const sandbox = await compute.sandbox.create({
    metadata: {
      userId: 'user-123',
      project: 'data-analysis'
    }
  });
  ```

- **`domain`** (string): Custom domain to associate with the sandbox (if supported by the provider).
  ```typescript
  const sandbox = await compute.sandbox.create({
    domain: 'my-sandbox.example.com'
  });
  ```

- **`envs`** (object): Environment variables to set in the sandbox.
  ```typescript
  const sandbox = await compute.sandbox.create({
    envs: {
      API_KEY: 'your-api-key',
      DEBUG: 'true'
    }
  });
  ```

### Example with Multiple Options

```typescript
const sandbox = await compute.sandbox.create({
  runtime: 'python3.9',
  timeout: 300000, // 5 minutes
  sandboxId: 'data-processing-123',
  metadata: {
    userId: 'user-123',
    jobType: 'data-processing'
  },
  envs: {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: 'production'
  }
});
```