# @computesdk/provider

The provider framework for building custom compute providers.

## Overview

This package provides the tools and types to build custom sandbox providers for the ComputeSDK ecosystem. Use it to add support for new compute platforms, cloud providers, or sandbox environments.

## Installation

```bash
npm install @computesdk/provider
```

## Quick Start

```typescript
import { defineProvider } from '@computesdk/provider';
import type { ProviderConfig } from '@computesdk/provider';

interface MyProviderConfig extends ProviderConfig {
  apiKey: string;
  region?: string;
}

export const myProvider = defineProvider<any, MyProviderConfig>({
  name: 'my-provider',
  defaultMode: 'direct',
  methods: {
    sandbox: {
      create: async (config, options) => {
        // Create sandbox via your provider's API
        const response = await fetch(`https://api.example.com/sandboxes`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${config.apiKey}` },
          body: JSON.stringify(options)
        });
        
        const data = await response.json();
        
        return {
          sandbox: data, // Your provider's sandbox object
          sandboxId: data.id
        };
      },
      
      getById: async (config, sandboxId) => {
        const response = await fetch(
          `https://api.example.com/sandboxes/${sandboxId}`,
          { headers: { 'Authorization': `Bearer ${config.apiKey}` } }
        );
        
        if (!response.ok) return null;
        
        const data = await response.json();
        return { sandbox: data, sandboxId: data.id };
      },
      
      list: async (config) => {
        const response = await fetch(
          `https://api.example.com/sandboxes`,
          { headers: { 'Authorization': `Bearer ${config.apiKey}` } }
        );
        
        const data = await response.json();
        return data.map((s: any) => ({ sandbox: s, sandboxId: s.id }));
      },
      
      destroy: async (config, sandboxId) => {
        await fetch(
          `https://api.example.com/sandboxes/${sandboxId}`,
          {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${config.apiKey}` }
          }
        );
      },
      
      runCode: async (sandbox, code, runtime) => {
        // Execute code in the sandbox
        const response = await fetch(
          `https://api.example.com/sandboxes/${sandbox.id}/execute`,
          {
            method: 'POST',
            body: JSON.stringify({ code, runtime })
          }
        );
        
        const result = await response.json();
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode
        };
      },
      
      runCommand: async (sandbox, command, args) => {
        // Run shell command
        const response = await fetch(
          `https://api.example.com/sandboxes/${sandbox.id}/command`,
          {
            method: 'POST',
            body: JSON.stringify({ command, args })
          }
        );
        
        const result = await response.json();
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode
        };
      },
      
      getInfo: async (sandbox) => {
        return {
          id: sandbox.id,
          status: sandbox.status,
          createdAt: new Date(sandbox.created_at)
        };
      },
      
      getUrl: async (sandbox, options) => {
        return `https://${sandbox.id}.example.com:${options.port}`;
      }
    }
  }
});
```

## API Reference

### `defineProvider(config)`

Define a new provider with sandbox lifecycle methods.

**Parameters:**

```typescript
interface ProviderConfig<TSandbox, TConfig> {
  name: string;
  defaultMode?: 'direct' | 'gateway';
  methods: {
    sandbox: SandboxMethods<TSandbox, TConfig>;
    template?: TemplateMethods<TTemplate, TConfig>;
    snapshot?: SnapshotMethods<TSnapshot, TConfig>;
  };
}
```

**Returns:** A factory function `(config: TConfig) => Provider`

### Required Sandbox Methods

#### Collection Operations

These methods manage sandboxes at the collection level:

##### `create(config, options?)`

Create a new sandbox.

```typescript
create: async (config, options) => {
  // Return: { sandbox: YourSandboxObject, sandboxId: string }
  return {
    sandbox: mySandboxInstance,
    sandboxId: 'sandbox-123'
  };
}
```

##### `getById(config, sandboxId)`

Get an existing sandbox by ID.

```typescript
getById: async (config, sandboxId) => {
  // Return: { sandbox, sandboxId } or null if not found
  return { sandbox: mySandboxInstance, sandboxId };
}
```

##### `list(config)`

List all sandboxes.

```typescript
list: async (config) => {
  // Return: Array of { sandbox, sandboxId }
  return [
    { sandbox: sandbox1, sandboxId: 'id1' },
    { sandbox: sandbox2, sandboxId: 'id2' }
  ];
}
```

##### `destroy(config, sandboxId)`

Destroy a sandbox.

```typescript
destroy: async (config, sandboxId) => {
  await yourApi.deleteSandbox(sandboxId);
}
```

#### Instance Operations

These methods operate on individual sandbox instances:

##### `runCode(sandbox, code, runtime?, config?)`

Execute code in the sandbox.

```typescript
runCode: async (sandbox, code, runtime) => {
  const result = await yourApi.executeCode(sandbox.id, code);
  return {
    stdout: result.output,
    stderr: result.errors,
    exitCode: result.code
  };
}
```

##### `runCommand(sandbox, command, args?, options?)`

Run a shell command.

```typescript
runCommand: async (sandbox, command, args) => {
  const result = await yourApi.runCommand(sandbox.id, command, args);
  return {
    stdout: result.output,
    stderr: result.errors,
    exitCode: result.code
  };
}
```

##### `getInfo(sandbox)`

Get sandbox information.

```typescript
getInfo: async (sandbox) => {
  return {
    id: sandbox.id,
    status: 'running', // 'running' | 'stopped' | 'error'
    createdAt: new Date(sandbox.created_at)
  };
}
```

##### `getUrl(sandbox, options)`

Get URL for accessing sandbox services.

```typescript
getUrl: async (sandbox, options) => {
  return `https://${sandbox.id}.example.com:${options.port}`;
}
```

### Optional Filesystem Methods

Add filesystem support by implementing the `filesystem` methods:

```typescript
methods: {
  sandbox: {
    // ... required methods
    
    filesystem: {
      readFile: async (sandbox, path, runCommand) => {
        const result = await runCommand(sandbox, 'cat', [path]);
        return result.stdout;
      },
      
      writeFile: async (sandbox, path, content, runCommand) => {
        const escaped = content.replace(/'/g, "'\\''");
        await runCommand(sandbox, 'sh', ['-c', `cat > '${path}' << 'EOF'\n${content}\nEOF`]);
      },
      
      mkdir: async (sandbox, path, runCommand) => {
        await runCommand(sandbox, 'mkdir', ['-p', path]);
      },
      
      readdir: async (sandbox, path, runCommand) => {
        const result = await runCommand(sandbox, 'ls', ['-la', path]);
        // Parse ls output and return FileEntry[]
        return parseFileList(result.stdout);
      },
      
      exists: async (sandbox, path, runCommand) => {
        const result = await runCommand(sandbox, 'test', ['-e', path]);
        return result.exitCode === 0;
      },
      
      remove: async (sandbox, path, runCommand) => {
        await runCommand(sandbox, 'rm', ['-rf', path]);
      }
    }
  }
}
```

**Note:** If you don't implement `filesystem`, the sandbox will still work but filesystem operations will throw helpful "not supported" errors.

### Optional Named Sandbox Methods

Support named sandboxes (useful for gateway providers):

```typescript
methods: {
  sandbox: {
    // ... required methods
    
    findOrCreate: async (config, options) => {
      // Find sandbox by name or create it
      const existing = await findByName(config, options.name);
      if (existing) return existing;
      
      return await create(config, options);
    },
    
    find: async (config, options) => {
      // Find sandbox by name
      const sandbox = await findByName(config, options.name);
      return sandbox ? { sandbox, sandboxId: sandbox.id } : null;
    },
    
    extendTimeout: async (config, sandboxId, options) => {
      // Extend sandbox timeout
      await yourApi.extendTimeout(sandboxId, options.duration);
    }
  }
}
```

## Type Definitions

### Core Types

```typescript
import type {
  // Provider types
  Provider,
  ProviderConfig,
  ProviderSandbox,
  
  // Method definitions
  SandboxMethods,
  TemplateMethods,
  SnapshotMethods,
  
  // Result types
  CodeResult,
  CommandResult,
  SandboxInfo,
  
  // Options
  CreateSandboxOptions,
  RunCommandOptions,
  
  // Filesystem
  FileEntry,
  SandboxFileSystem
} from '@computesdk/provider';
```

### Provider Modes

Providers can operate in different modes:

- **`direct`** - Provider has native sandbox capabilities (e.g., E2B, Modal)
- **`gateway`** - Provider only has infrastructure (e.g., Railway) - routes through gateway

Set the default mode in your provider config:

```typescript
export const myProvider = defineProvider({
  name: 'my-provider',
  defaultMode: 'direct', // or 'gateway'
  methods: { /* ... */ }
});
```

## Complete Example

Here's a complete minimal provider implementation:

```typescript
import { defineProvider } from '@computesdk/provider';

interface MinimalConfig {
  apiKey: string;
}

export const minimal = defineProvider<any, MinimalConfig>({
  name: 'minimal',
  defaultMode: 'direct',
  methods: {
    sandbox: {
      create: async (config, options) => {
        const id = `sandbox-${Date.now()}`;
        return {
          sandbox: { id, status: 'running' },
          sandboxId: id
        };
      },
      
      getById: async (config, id) => {
        return {
          sandbox: { id, status: 'running' },
          sandboxId: id
        };
      },
      
      list: async (config) => {
        return [];
      },
      
      destroy: async (config, id) => {
        // Clean up sandbox
      },
      
      runCode: async (sandbox, code, runtime) => {
        return {
          stdout: `Executed: ${code}`,
          stderr: '',
          exitCode: 0
        };
      },
      
      runCommand: async (sandbox, command, args) => {
        return {
          stdout: `Ran: ${command} ${args?.join(' ')}`,
          stderr: '',
          exitCode: 0
        };
      },
      
      getInfo: async (sandbox) => {
        return {
          id: sandbox.id,
          status: 'running',
          createdAt: new Date()
        };
      },
      
      getUrl: async (sandbox, options) => {
        return `http://localhost:${options.port}`;
      }
    }
  }
});

// Export factory function
export function createMinimal(config: MinimalConfig) {
  return minimal(config);
}
```

## Usage in Provider Packages

Once you've defined your provider, export it from your package:

```typescript
// In @computesdk/my-provider/src/index.ts
import { defineProvider } from '@computesdk/provider';

export const myProvider = defineProvider({ /* ... */ });

// Users can then use it directly
import { myProvider } from '@computesdk/my-provider';

const compute = myProvider({ apiKey: 'xxx' });
const sandbox = await compute.sandbox.create();
```

## Best Practices

### 1. Validate Configuration Early

```typescript
create: async (config, options) => {
  if (!config.apiKey) {
    throw new Error(
      'Missing API key for my-provider.\n\n' +
      'Setup instructions:\n' +
      '1. Get your API key from https://example.com/keys\n' +
      '2. Set environment variable: export MY_PROVIDER_API_KEY=your_key\n' +
      '3. Or pass it directly: myProvider({ apiKey: "your_key" })'
    );
  }
  
  if (!config.apiKey.startsWith('mp_')) {
    throw new Error(
      'Invalid API key format for my-provider.\n' +
      'API keys should start with "mp_"'
    );
  }
  
  // Continue with creation
}
```

### 2. Provide Helpful Error Messages

```typescript
runCode: async (sandbox, code, runtime) => {
  try {
    return await yourApi.execute(sandbox.id, code);
  } catch (error) {
    if (error.code === 'QUOTA_EXCEEDED') {
      throw new Error(
        'API quota exceeded for my-provider.\n' +
        'Upgrade your plan at https://example.com/pricing'
      );
    }
    throw error;
  }
}
```

### 3. Handle Missing Features Gracefully

If your provider doesn't support certain features:

```typescript
// Don't implement filesystem methods - ComputeSDK will auto-generate
// helpful error messages for users
```

### 4. Document Provider-Specific Features

```typescript
/**
 * My Provider - Fast cloud sandboxes
 * 
 * Features:
 * - Python and Node.js runtimes
 * - Full filesystem support
 * - GPU acceleration (premium plans)
 * - No terminal support
 */
export const myProvider = defineProvider({ /* ... */ });
```

## Testing Your Provider

Create tests to verify your provider implementation:

```typescript
import { describe, it, expect } from 'vitest';
import { myProvider } from './index';

describe('MyProvider', () => {
  it('creates and destroys sandboxes', async () => {
    const compute = myProvider({ apiKey: process.env.MY_PROVIDER_API_KEY! });
    
    const sandbox = await compute.sandbox.create();
    expect(sandbox.sandboxId).toBeDefined();
    
    const info = await sandbox.getInfo();
    expect(info.status).toBe('running');
    
    await sandbox.destroy();
  });
  
  it('executes code', async () => {
    const compute = myProvider({ apiKey: process.env.MY_PROVIDER_API_KEY! });
    const sandbox = await compute.sandbox.create();
    
    const result = await sandbox.runCode('print("Hello")', 'python');
    expect(result.stdout).toContain('Hello');
    expect(result.exitCode).toBe(0);
    
    await sandbox.destroy();
  });
});
```

## Examples

See these provider implementations for reference:

- **[@computesdk/e2b](../e2b)** - Full-featured provider with filesystem and terminals
- **[@computesdk/modal](../modal)** - GPU-accelerated Python provider
- **[@computesdk/railway](../railway)** - Infrastructure provider using gateway mode

## Related Packages

- **[computesdk](../computesdk)** - User-facing gateway SDK
- **[@computesdk/e2b](../e2b)** - E2B provider implementation
- **[@computesdk/modal](../modal)** - Modal provider implementation

## License

MIT
