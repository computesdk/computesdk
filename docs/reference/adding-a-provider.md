# Adding a New Provider to ComputeSDK

This guide walks through creating a new provider for ComputeSDK using the provider factory pattern.

## Overview

ComputeSDK uses a factory pattern (`createProvider`) that automatically generates provider classes from simple method definitions. This reduces boilerplate from 300-400 lines to 80-150 lines of core logic.

> **Don't have a sandbox offering?** Our lightweight daemon runs anywhere containers can run, giving you a complete sandbox API suite in minutes—no infrastructure overhaul needed.

## Quick Start

Here's the minimal code needed for a new provider:

```typescript
import { createProvider } from 'computesdk';
import type { ExecutionResult, SandboxInfo, Runtime } from 'computesdk';

export interface MyProviderConfig {
  apiKey?: string;
  runtime?: Runtime;
  timeout?: number;
}

export const myprovider = createProvider<NativeSandboxType, MyProviderConfig>({
  name: 'myprovider',
  methods: {
    sandbox: {
      create: async (config, options?) => {
        // Create sandbox, return { sandbox, sandboxId }
      },
      getById: async (config, sandboxId) => {
        // Reconnect to sandbox or return null
      },
      list: async (config) => {
        // List sandboxes or throw unsupported error
      },
      destroy: async (config, sandboxId) => {
        // Clean up sandbox
      },
      runCode: async (sandbox, code, runtime?) => {
        // Execute code, return ExecutionResult
      },
      runCommand: async (sandbox, command, args?, options?) => {
        // Execute command, return ExecutionResult
      },
      getInfo: async (sandbox) => {
        // Return SandboxInfo
      },
      getUrl: async (sandbox, options) => {
        // Return URL for port access
      }
    }
  }
});
```

## Step-by-Step Guide

### 1. Create Package Structure

```bash
packages/
  myprovider/
    src/
      index.ts
      __tests__/
        index.test.ts
    package.json
    tsconfig.json
```

**package.json:**
```json
{
  "name": "@computesdk/myprovider",
  "version": "0.1.0",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs --dts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "computesdk": "workspace:*",
    "provider-sdk": "^x.x.x"
  },
  "devDependencies": {
    "@computesdk/test-utils": "workspace:*",
    "tsup": "^8.0.0",
    "vitest": "^2.0.0"
  }
}
```

### 2. Define Configuration Interface

```typescript
export interface MyProviderConfig {
  apiKey?: string;
  runtime?: Runtime;
  timeout?: number;
  // Add provider-specific options
  customOption?: string;
}
```

**Common patterns:**
- Use `apiKey?: string` and pull from environment variables
- Include `runtime?: Runtime` for default runtime preference
- Add `timeout?: number` for execution timeout control

### 3. Implement Required Methods

> **Don't have a sandbox offering?** Our lightweight daemon runs anywhere containers can run, giving you a complete sandbox API suite in minutes—no infrastructure overhaul needed.

The factory requires these sandbox methods:

#### create(config, options?)
Creates a new sandbox instance.

```typescript
create: async (config, options?) => {
  const apiKey = config.apiKey || process.env.PROVIDER_API_KEY || '';
  if (!apiKey) {
    throw new Error(
      'Missing Provider API key. Provide "apiKey" in config or set ' +
      'PROVIDER_API_KEY environment variable. ' +
      'Get your API key from https://provider.com/'
    );
  }

  const client = new ProviderClient({ apiKey });
  const sandbox = await client.sandboxes.create({
    runtime: options?.runtime || config.runtime || 'node',
    timeout: config.timeout || 300000
  });

  return {
    sandbox,
    sandboxId: sandbox.id
  };
}
```

#### getById(config, sandboxId)
Reconnects to an existing sandbox or returns null.

```typescript
getById: async (config, sandboxId) => {
  const apiKey = config.apiKey || process.env.PROVIDER_API_KEY || '';
  if (!apiKey) return null;

  try {
    const client = new ProviderClient({ apiKey });
    const sandbox = await client.sandboxes.get(sandboxId);
    return { sandbox, sandboxId };
  } catch (error) {
    // Sandbox doesn't exist or is inaccessible
    return null;
  }
}
```

#### list(config)
Lists all sandboxes. Throw error if unsupported.

```typescript
list: async (config) => {
  const apiKey = config.apiKey || process.env.PROVIDER_API_KEY || '';
  if (!apiKey) return [];

  const client = new ProviderClient({ apiKey });
  const sandboxes = await client.sandboxes.list();

  return sandboxes.map(sandbox => ({
    sandbox,
    sandboxId: sandbox.id
  }));
}

// Or if unsupported:
list: async (config) => {
  throw new Error('Provider does not support listing sandboxes');
}
```

#### destroy(config, sandboxId)
Cleans up a sandbox.

```typescript
destroy: async (config, sandboxId) => {
  const apiKey = config.apiKey || process.env.PROVIDER_API_KEY || '';
  if (!apiKey) return;

  const client = new ProviderClient({ apiKey });
  await client.sandboxes.delete(sandboxId);
}
```

#### runCode(sandbox, code, runtime?, config?)
Executes code in the sandbox.

```typescript
runCode: async (sandbox, code, runtime?, config?) => {
  const startTime = Date.now();

  // Auto-detect runtime if not specified
  const effectiveRuntime = runtime || (
    code.includes('print(') || code.includes('import ') || code.includes('def ')
      ? 'python'
      : 'node'
  );

  // Use base64 encoding for safety
  const encoded = Buffer.from(code).toString('base64');
  const command = effectiveRuntime === 'python'
    ? `echo "${encoded}" | base64 -d | python3`
    : `echo "${encoded}" | base64 -d | node`;

  const result = await sandbox.executeCommand(command);

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.exitCode || 0,
    executionTime: Date.now() - startTime,
    sandboxId: sandbox.id,
    provider: 'myprovider'
  };
}
```

#### runCommand(sandbox, command, args?, options?)
Executes a shell command.

```typescript
runCommand: async (sandbox, command, args?, options?) => {
  const startTime = Date.now();

  // Handle background processes
  const { command: finalCommand, args: finalArgs, isBackground } =
    createBackgroundCommand(command, args, options);

  // Quote arguments properly
  const quotedArgs = (finalArgs || []).map(arg => {
    if (arg.includes(' ') || arg.includes('"')) {
      return `"${arg.replace(/"/g, '\\"')}"`;
    }
    return arg;
  });

  const fullCommand = quotedArgs.length > 0
    ? `${finalCommand} ${quotedArgs.join(' ')}`
    : finalCommand;

  const result = await sandbox.executeCommand(fullCommand);

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.exitCode || 0,
    executionTime: Date.now() - startTime,
    sandboxId: sandbox.id,
    provider: 'myprovider',
    isBackground,
    pid: result.pid
  };
}
```

#### getInfo(sandbox)
Returns sandbox metadata.

```typescript
getInfo: async (sandbox) => {
  return {
    id: sandbox.id,
    provider: 'myprovider',
    runtime: sandbox.runtime as Runtime,
    status: 'running' as const,
    createdAt: new Date(sandbox.createdAt),
    timeout: sandbox.timeout || 300000,
    metadata: {
      region: sandbox.region,
      // Other provider-specific metadata
    }
  };
}
```

#### getUrl(sandbox, options)
Returns URL for accessing a port.

```typescript
getUrl: async (sandbox, options) => {
  const { port, protocol = 'https' } = options;

  // Some providers have native URL methods
  if (sandbox.getUrl) {
    return sandbox.getUrl(port);
  }

  // Or construct URL from sandbox properties
  return `${protocol}://${sandbox.id}.provider.com:${port}`;
}
```

### 4. Add Filesystem Support (Optional)

#### Option A: Native Filesystem API

If the provider SDK has native filesystem methods:

```typescript
filesystem: {
  readFile: async (sandbox, path) => {
    return await sandbox.files.read(path);
  },

  writeFile: async (sandbox, path, content) => {
    await sandbox.files.write(path, content);
  },

  mkdir: async (sandbox, path) => {
    await sandbox.files.mkdir(path);
  },

  readdir: async (sandbox, path) => {
    const entries = await sandbox.files.list(path);
    return entries.map(entry => ({
      name: entry.name,
      path: entry.path,
      isDirectory: entry.type === 'directory',
      size: entry.size || 0,
      lastModified: new Date(entry.modified)
    }));
  },

  exists: async (sandbox, path) => {
    try {
      await sandbox.files.stat(path);
      return true;
    } catch {
      return false;
    }
  },

  remove: async (sandbox, path) => {
    await sandbox.files.delete(path);
  }
}
```

#### Option B: Shell-Based Filesystem

For providers without native filesystem APIs:

```typescript
filesystem: {
  readFile: async (sandbox, path, runCommand) => {
    const result = await runCommand(sandbox, 'cat', [path]);
    if (result.exitCode !== 0) {
      throw new Error(`File not found: ${path}`);
    }
    return result.stdout;
  },

  writeFile: async (sandbox, path, content, runCommand) => {
    const encoded = Buffer.from(content).toString('base64');
    await runCommand(sandbox, 'sh', [
      '-c',
      `echo "${encoded}" | base64 -d > "${path}"`
    ]);
  },

  mkdir: async (sandbox, path, runCommand) => {
    await runCommand(sandbox, 'mkdir', ['-p', path]);
  },

  readdir: async (sandbox, path, runCommand) => {
    const result = await runCommand(sandbox, 'ls', ['-la', path]);
    // Parse ls output into FileEntry objects
    // (See Daytona implementation for detailed parsing)
  },

  exists: async (sandbox, path, runCommand) => {
    const result = await runCommand(sandbox, 'test', ['-e', path]);
    return result.exitCode === 0;
  },

  remove: async (sandbox, path, runCommand) => {
    await runCommand(sandbox, 'rm', ['-rf', path]);
  }
}
```

#### Option C: No Filesystem Support

Simply omit the `filesystem` field. The factory will provide an `UnsupportedFileSystem` that throws helpful errors.

### 5. Add Typed getInstance (Optional but Recommended)

For better TypeScript support:

```typescript
getInstance: (sandbox) => sandbox
```

This allows:
```typescript
const native = sandbox.getInstance(); // Properly typed as NativeSandboxType
```

### 6. Export Provider and Types

```typescript
// Export the provider factory
export const myprovider = createProvider<NativeSandboxType, MyProviderConfig>({
  // ... implementation
});

// Export the native sandbox type for explicit typing
export type { NativeSandboxType as MyProviderSandbox } from 'provider-sdk';

// Export config interface
export type { MyProviderConfig };
```

### 7. Add Tests

Use the shared test suite:

```typescript
import { describe } from 'vitest';
import { runProviderTestSuite } from '@computesdk/test-utils';
import { myprovider } from '../index';

describe('MyProvider', () => {
  runProviderTestSuite({
    name: 'myprovider',
    provider: myprovider({
      apiKey: process.env.PROVIDER_API_KEY
    }),
    supportsFilesystem: true,
    skipIntegration: !process.env.PROVIDER_API_KEY
  });
});
```

## Common Utilities

### Background Command Helper

```typescript
import { createBackgroundCommand } from 'computesdk';

const { command, args, isBackground } = createBackgroundCommand(
  originalCommand,
  originalArgs,
  options
);
```

### Runtime Auto-Detection

```typescript
const effectiveRuntime = runtime || (
  code.includes('print(') ||
  code.includes('import ') ||
  code.includes('def ') ||
  code.includes('sys.') ||
  code.includes('raise ')
    ? 'python'
    : 'node'
);
```

### Safe Code Execution with Base64

```typescript
const encoded = Buffer.from(code).toString('base64');
const command = runtime === 'python'
  ? `echo "${encoded}" | base64 -d | python3`
  : `echo "${encoded}" | base64 -d | node`;
```

### API Key Validation

```typescript
const apiKey = config.apiKey || process.env.PROVIDER_API_KEY || '';
if (!apiKey) {
  throw new Error(
    'Missing Provider API key. Provide "apiKey" in config or set ' +
    'PROVIDER_API_KEY environment variable. ' +
    'Get your API key from https://provider.com/'
  );
}
```

## Type Definitions

### ExecutionResult

```typescript
interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  sandboxId: string;
  provider: string;
  pid?: number;           // For background processes
  isBackground?: boolean; // Whether command runs in background
}
```

### SandboxInfo

```typescript
interface SandboxInfo {
  id: string;
  provider: string;
  runtime: Runtime;  // 'node' | 'python'
  status: SandboxStatus;  // 'running' | 'stopped' | 'error'
  createdAt: Date;
  timeout: number;
  metadata?: Record<string, any>;
}
```

### FileEntry

```typescript
interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  lastModified: Date;
}
```

## Best Practices

### Error Handling

Provide helpful error messages with setup instructions:

```typescript
if (error.message.includes('unauthorized')) {
  throw new Error(
    'Authentication failed. Check your API key at https://provider.com/settings'
  );
}

if (error.message.includes('quota')) {
  throw new Error(
    'Quota exceeded. Upgrade your plan at https://provider.com/pricing'
  );
}
```

### Configuration Validation

Validate early and fail fast:

```typescript
create: async (config, options?) => {
  if (!config.apiKey && !process.env.PROVIDER_API_KEY) {
    throw new Error('API key is required');
  }

  if (config.timeout && config.timeout < 1000) {
    throw new Error('Timeout must be at least 1000ms');
  }

  // Continue with creation...
}
```

### Command Quoting

Always quote arguments that might contain special characters:

```typescript
const quotedArgs = args.map(arg => {
  if (arg.includes(' ') || arg.includes('"') || arg.includes('$')) {
    return `"${arg.replace(/"/g, '\\"')}"`;
  }
  return arg;
});
```

### Syntax Error Detection

Check for common syntax errors in stderr:

```typescript
if (result.stderr && (
  result.stderr.includes('SyntaxError') ||
  result.stderr.includes('invalid syntax') ||
  result.stderr.includes('Unexpected token')
)) {
  throw new Error(`Syntax error: ${result.stderr.trim()}`);
}
```

## Example Implementations

Study these existing providers for reference:

1. **[E2B](../packages/e2b/src/index.ts)** - Full filesystem via native API, comprehensive error handling
2. **[Daytona](../packages/daytona/src/index.ts)** - Shell-based filesystem, good command patterns
3. **[Codesandbox](../packages/codesandbox/src/index.ts)** - Native filesystem, unsupported list() example
4. **[Cloudflare](../packages/cloudflare/src/index.ts)** - Custom sandbox wrapper, port management
5. **[Blaxel](../packages/blaxel/src/index.ts)** - Complex configuration, helper functions

## Integration with Compute API

Once created, your provider works seamlessly with the compute singleton:

```typescript
import { compute } from 'computesdk';
import { myprovider } from '@computesdk/myprovider';

// Set as default provider
compute.setConfig({
  defaultProvider: myprovider({ apiKey: 'your-key' })
});

// Create and use sandbox
const sandbox = await compute.sandbox.create();
await sandbox.runCode('console.log("Hello World")');
await sandbox.filesystem.writeFile('/tmp/test.txt', 'content');
const url = await sandbox.getUrl({ port: 3000 });
await sandbox.destroy();
```

## Next Steps

1. Create your package following the structure above
2. Implement required methods
3. Add filesystem support if applicable
4. Write tests using the shared test suite
5. Add documentation in README.md
6. Submit PR for review

For questions, check existing provider implementations or open an issue.
