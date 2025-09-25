# Overview

Complete reference documentation for ComputeSDK's APIs and interfaces.

## What is ComputeSDK?

ComputeSDK provides a unified abstraction layer for executing code in secure, isolated sandboxed environments across multiple cloud providers. The API is designed to be consistent across all providers while allowing for provider-specific features.

## Architecture

ComputeSDK follows a clean provider/sandbox separation architecture:

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Your App      │ → │   ComputeSDK     │ → │   Provider      │
│                 │    │   Core API       │    │   (E2B, etc.)   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                       ┌──────────────────┐
                       │    Sandbox       │
                       │   - Code Exec    │
                       │   - Filesystem   │
                       │   - Terminal     │
                       └──────────────────┘
```

## Basic Usage Pattern

```typescript
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

// 1. Configure provider
compute.setConfig({ 
  provider: e2b({ apiKey: process.env.E2B_API_KEY }) 
});

// 2. Create sandbox
const sandbox = await compute.sandbox.create();

// 3. Execute operations
const result = await sandbox.runCode('print("Hello World!")');
console.log(result.stdout);

// 4. Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

## Core Components

### Configuration Management
Global configuration and provider setup:
- `compute.setConfig(config)` - Set global configuration
- `compute.getConfig()` - Get current configuration  
- `compute.clearConfig()` - Clear configuration

### Sandbox Management
Create and manage isolated execution environments:
- `compute.sandbox.create(options)` - Create new sandbox
- `compute.sandbox.getById(id)` - Get existing sandbox
- `compute.sandbox.list()` - List all sandboxes
- `compute.sandbox.destroy(id)` - Destroy sandbox

### Code Execution
Execute code and shell commands:
- `sandbox.runCode(code, runtime?)` - Execute code
- `sandbox.runCommand(command, args?)` - Run shell command

### Filesystem Operations
File and directory management:
- `sandbox.filesystem.writeFile(path, content)` - Write file
- `sandbox.filesystem.readFile(path)` - Read file
- `sandbox.filesystem.mkdir(path)` - Create directory
- `sandbox.filesystem.readdir(path)` - List directory
- `sandbox.filesystem.exists(path)` - Check if exists
- `sandbox.filesystem.remove(path)` - Remove file/directory

### Terminal Operations
Interactive terminal sessions (E2B only):
- `sandbox.terminal.create(options)` - Create terminal
- `sandbox.terminal.list()` - List terminals
- `sandbox.terminal.getById(id)` - Get terminal by ID
- `terminal.write(data)` - Write to terminal
- `terminal.resize(cols, rows)` - Resize terminal
- `terminal.kill()` - Kill terminal

### Web Integration
Built-in request handler for web frameworks:
- `handleComputeRequest(options)` - Process web requests

## Supported Runtimes

ComputeSDK supports multiple runtime environments with automatic detection:

- **Python** - Python 3.x with data science libraries (pandas, numpy, etc.)
- **Node.js** - Node.js runtime with npm package support
- **Auto-detection** - Runtime automatically detected based on code patterns

### Runtime Detection

The SDK automatically detects the appropriate runtime:

**Python indicators:**
- `print(` statements
- `import` statements  
- `def` function definitions
- Python-specific syntax (`f"`, `__`, etc.)

**Default:** Node.js for all other cases

## Provider Support Matrix

Different providers support different features:

| Feature | E2B | Vercel | Blaxel | Daytona | CodeSandbox | Modal |
|---------|-----|--------|--------|---------|-------------|-------|
| **Code Execution** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Filesystem** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Terminal** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **GPU Support** | Limited | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Persistent Storage** | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |

## Error Handling

All ComputeSDK methods can throw errors. Always wrap calls in try-catch blocks:

```typescript
try {
  const result = await sandbox.runCode('invalid code');
  
  if (result.exitCode !== 0) {
    console.error('Code execution failed:', result.stderr);
  } else {
    console.log('Success:', result.stdout);
  }
} catch (error: any) {
  console.error('Execution failed:', error.message);
  
  // Handle specific error types
  if (error.message.includes('authentication')) {
    console.error('Check your API key configuration');
  } else if (error.message.includes('quota')) {
    console.error('Provider usage limits exceeded');
  } else if (error.message.includes('timeout')) {
    console.error('Operation timed out');
  }
}
```

## TypeScript Support

ComputeSDK is fully typed with comprehensive TypeScript definitions:

```typescript
import type { 
  Sandbox, 
  Provider, 
  ExecutionResult,
  ComputeConfig,
  Runtime,
  FilesystemAPI,
  TerminalAPI 
} from 'computesdk';

// All methods are properly typed
const sandbox: Sandbox = await compute.sandbox.create();
const result: ExecutionResult = await sandbox.runCode('print("Hello")', 'python');
```

## Best Practices

### 1. Resource Management

Always clean up sandboxes to avoid resource leaks:

```typescript
const withSandbox = async <T>(
  callback: (sandbox: Sandbox) => Promise<T>
): Promise<T> => {
  const sandbox = await compute.sandbox.create();
  
  try {
    return await callback(sandbox);
  } finally {
    await compute.sandbox.destroy(sandbox.sandboxId);
  }
};

// Usage
const result = await withSandbox(async (sandbox) => {
  return await sandbox.runCode('print("Hello World!")');
});
```

### 2. Error Handling

Implement comprehensive error handling:

```typescript
const executeCode = async (code: string) => {
  try {
    const sandbox = await compute.sandbox.create();
    
    try {
      const result = await sandbox.runCode(code);
      
      if (result.exitCode !== 0) {
        throw new Error(`Code execution failed: ${result.stderr}`);
      }
      
      return result.stdout;
    } finally {
      await compute.sandbox.destroy(sandbox.sandboxId);
    }
  } catch (error: any) {
    console.error('Code execution error:', error.message);
    throw error;
  }
};
```

### 3. Provider Configuration

Configure providers based on your needs:

```typescript
import { e2b } from '@computesdk/e2b';
import { vercel } from '@computesdk/vercel';
import { blaxel } from '@computesdk/blaxel';

// For data science and interactive development
compute.setConfig({ 
  provider: e2b({ apiKey: process.env.E2B_API_KEY }) 
});

// For serverless execution with long runtimes
compute.setConfig({ 
  provider: vercel({ runtime: 'python' })
});

// For AI-powered development with fast boot times
compute.setConfig({ 
  provider: blaxel({ 
    apiKey: process.env.BLAXEL_API_KEY,
    workspace: process.env.BLAXEL_WORKSPACE
  })
});
```

## Common Patterns

### Code Execution with Result Processing

```typescript
const processCode = async (code: string, runtime?: 'python' | 'node') => {
  const sandbox = await compute.sandbox.create();
  
  try {
    const result = await sandbox.runCode(code, runtime);
    
    return {
      success: result.exitCode === 0,
      output: result.stdout,
      error: result.stderr,
      executionTime: result.executionTime
    };
  } finally {
    await compute.sandbox.destroy(sandbox.sandboxId);
  }
};

// Usage
const result = await processCode('print("Hello World!")', 'python');
if (result.success) {
  console.log('Output:', result.output);
} else {
  console.error('Error:', result.error);
}
```

### File Processing Workflow

```typescript
const processFile = async (inputData: string, processScript: string) => {
  const sandbox = await compute.sandbox.create();
  
  try {
    // Write input data
    await sandbox.filesystem.writeFile('/tmp/input.txt', inputData);
    
    // Write processing script
    await sandbox.filesystem.writeFile('/tmp/process.py', processScript);
    
    // Execute processing
    const result = await sandbox.runCommand('python', ['/tmp/process.py']);
    
    // Read output
    const output = await sandbox.filesystem.readFile('/tmp/output.txt');
    
    return {
      success: result.exitCode === 0,
      output,
      logs: result.stdout,
      error: result.stderr
    };
  } finally {
    await compute.sandbox.destroy(sandbox.sandboxId);
  }
};
```

## Next Steps

Explore the detailed API documentation:

- **[Configuration](./configuration.md)** - Provider setup and global config
- **[Sandbox Management](./sandbox-management.md)** - Creating and managing sandboxes
- **[Code Execution](./code-execution.md)** - Running code and commands
- **[Filesystem](./filesystem.md)** - File and directory operations
- **[Terminal](./terminal.md)** - Interactive terminal sessions
- **[UI Package](./ui-package.md)** - Frontend integration
- **[API Integration](./api-integration.md)** - Web framework integration

For provider-specific features, see:
- **[Provider Documentation](../providers/)** - Detailed provider guides
- **[Framework Integration](../frameworks/)** - Web framework examples