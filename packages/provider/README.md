# @computesdk/provider

The provider framework for building custom compute providers in the ComputeSDK ecosystem.

## Overview

`@computesdk/provider` is the "Mother" layer in ComputeSDK's three-tier architecture:

- **computesdk** (Grandmother) - User-facing SDK with gateway HTTP + Sandbox client
- **@computesdk/provider** (Mother) - Provider framework for building custom providers  
- **Provider packages** (Children) - Individual providers (e2b, modal, vercel, etc.)

This package provides the tools and types needed to:
- Build custom compute providers
- Use providers in direct mode (without the gateway)
- Implement the Universal Sandbox interface

## Installation

```bash
npm install @computesdk/provider
```

## Quick Start

### Using Direct Mode

Direct mode lets you use providers without the gateway:

```typescript
import { createCompute } from '@computesdk/provider';
import { e2b } from '@computesdk/e2b';

const compute = createCompute({ 
  defaultProvider: e2b({ apiKey: process.env.E2B_API_KEY }) 
});

const sandbox = await compute.sandbox.create();
const result = await sandbox.runCode('print("Hello World!")');
console.log(result.stdout);

await sandbox.destroy();
```

### Building a Custom Provider

```typescript
import { defineProvider } from '@computesdk/provider';
import type { 
  ProviderConfig, 
  ProviderSandbox,
  CreateSandboxOptions 
} from '@computesdk/provider';

interface MyProviderConfig extends ProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

export const myProvider = defineProvider<MyProviderConfig>({
  name: 'my-provider',
  defaultMode: 'direct',
  
  sandbox: {
    create: async (config, options) => {
      // Create sandbox via your provider's API
      const response = await fetch(`${config.baseUrl}/sandboxes`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${config.apiKey}` },
        body: JSON.stringify(options)
      });
      
      const data = await response.json();
      
      return {
        sandboxId: data.id,
        provider: 'my-provider',
        status: 'running',
        createdAt: new Date(),
        
        // Implement sandbox methods
        runCode: async (code, runtime) => {
          // Execute code in sandbox
        },
        
        runCommand: async (command, args) => {
          // Run shell command
        },
        
        filesystem: {
          readFile: async (path) => { /* ... */ },
          writeFile: async (path, content) => { /* ... */ },
          mkdir: async (path) => { /* ... */ },
          readdir: async (path) => { /* ... */ },
          exists: async (path) => { /* ... */ },
          remove: async (path) => { /* ... */ },
        },
        
        getInfo: async () => ({
          id: data.id,
          provider: 'my-provider',
          status: 'running',
          createdAt: new Date()
        }),
        
        destroy: async () => {
          // Clean up sandbox
        }
      };
    },
    
    getById: async (config, id) => {
      // Reconnect to existing sandbox
    },
    
    list: async (config) => {
      // List all sandboxes (optional)
      return [];
    },
    
    destroy: async (config, id) => {
      // Destroy sandbox by ID
    }
  }
});

// Export factory function
export function createMyProvider(config: Omit<MyProviderConfig, 'name'>): MyProviderConfig {
  return {
    name: 'my-provider',
    baseUrl: 'https://api.myprovider.com',
    ...config
  };
}
```

## Architecture

### Why "defineProvider"?

We use `defineProvider()` instead of `createProvider()` to match modern framework conventions:

**Pattern Recognition:**
- Vite: `defineConfig()`
- Nuxt: `defineNuxtConfig()`
- Vue: `defineComponent()`

**Better Semantics:**
- `createProvider` implies creating an instance (misleading)
- `defineProvider` means "define what this provider is" (accurate)
- More intuitive for developers familiar with modern frameworks

### Provider Modes

Providers can operate in two modes:

1. **Gateway Mode** (default for users)
   - Uses HTTP gateway for provider communication
   - Auto-detects providers from environment variables
   - Managed by the `computesdk` package

2. **Direct Mode** (for advanced users)
   - Direct SDK-to-provider communication
   - Uses `createCompute()` from this package
   - Provides better type inference for `getInstance()`

## API Reference

### defineProvider()

Define a custom provider with sandbox lifecycle methods.

```typescript
function defineProvider<TConfig extends ProviderConfig>(
  definition: ProviderDefinition<TConfig>
): Provider<TConfig>
```

**Parameters:**

- `definition.name` - Provider name (e.g., 'e2b', 'modal')
- `definition.defaultMode` - Default mode: 'gateway' or 'direct'
- `definition.sandbox.create` - Create new sandbox
- `definition.sandbox.getById` - Get existing sandbox by ID
- `definition.sandbox.list` - List all sandboxes (optional)
- `definition.sandbox.destroy` - Destroy sandbox by ID

**Returns:** Provider instance

### createCompute()

Create a compute instance for direct mode usage.

```typescript
function createCompute<TProvider extends Provider>(
  config: ComputeConfig<TProvider>
): Compute
```

**Parameters:**

- `config.defaultProvider` - The provider to use
- `config.apiKey` - Optional API key for gateway mode

**Returns:** Compute instance with properly typed `getInstance()`

## Types

### ProviderConfig

Base configuration interface that all provider configs must extend:

```typescript
interface ProviderConfig {
  name: string;
  [key: string]: any;
}
```

### ProviderSandbox

The Universal Sandbox interface that all providers must implement:

```typescript
interface ProviderSandbox {
  sandboxId: string;
  provider: string;
  status: 'running' | 'stopped' | 'error';
  createdAt: Date;
  
  // Code execution
  runCode(code: string, runtime?: string): Promise<ExecutionResult>;
  runCommand(command: string, args?: string[]): Promise<ExecutionResult>;
  
  // Filesystem operations
  filesystem: {
    readFile(path: string): Promise<string>;
    writeFile(path: string, content: string): Promise<void>;
    mkdir(path: string): Promise<void>;
    readdir(path: string): Promise<string[]>;
    exists(path: string): Promise<boolean>;
    remove(path: string): Promise<void>;
  };
  
  // Sandbox management
  getInfo(): Promise<SandboxInfo>;
  destroy(): Promise<void>;
  
  // Optional: Terminal support
  terminal?: {
    create(options: TerminalOptions): Promise<Terminal>;
    list(): Promise<Terminal[]>;
    getById(id: string): Promise<Terminal>;
  };
}
```

### ExecutionResult

```typescript
interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime?: number;
}
```

### CreateSandboxOptions

```typescript
interface CreateSandboxOptions {
  runtime?: string;
  timeout?: number;
  metadata?: Record<string, any>;
  [key: string]: any;
}
```

## Examples

### Minimal Provider

A minimal provider that implements only the required methods:

```typescript
import { defineProvider } from '@computesdk/provider';

export const minimal = defineProvider({
  name: 'minimal',
  defaultMode: 'direct',
  
  sandbox: {
    create: async (config, options) => ({
      sandboxId: 'minimal-' + Date.now(),
      provider: 'minimal',
      status: 'running',
      createdAt: new Date(),
      
      runCode: async (code) => ({
        stdout: `Executed: ${code}`,
        stderr: '',
        exitCode: 0
      }),
      
      runCommand: async (command, args) => ({
        stdout: `Ran: ${command} ${args?.join(' ')}`,
        stderr: '',
        exitCode: 0
      }),
      
      filesystem: {
        readFile: async () => '',
        writeFile: async () => {},
        mkdir: async () => {},
        readdir: async () => [],
        exists: async () => false,
        remove: async () => {},
      },
      
      getInfo: async () => ({
        id: 'minimal-sandbox',
        provider: 'minimal',
        status: 'running',
        createdAt: new Date()
      }),
      
      destroy: async () => {}
    }),
    
    getById: async (config, id) => {
      throw new Error('Not implemented');
    },
    
    destroy: async (config, id) => {}
  }
});
```

### Provider with HTTP Client

A realistic provider using fetch for API communication:

```typescript
import { defineProvider } from '@computesdk/provider';
import type { ProviderConfig } from '@computesdk/provider';

interface CloudProviderConfig extends ProviderConfig {
  apiKey: string;
  region?: string;
}

export const cloudProvider = defineProvider<CloudProviderConfig>({
  name: 'cloud-provider',
  defaultMode: 'direct',
  
  sandbox: {
    create: async (config, options) => {
      const response = await fetch('https://api.cloud.com/v1/sandboxes', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          runtime: options?.runtime || 'python',
          region: config.region || 'us-east-1'
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to create sandbox: ${response.statusText}`);
      }
      
      const sandbox = await response.json();
      
      return {
        sandboxId: sandbox.id,
        provider: 'cloud-provider',
        status: 'running',
        createdAt: new Date(sandbox.created_at),
        
        runCode: async (code, runtime) => {
          const execResponse = await fetch(
            `https://api.cloud.com/v1/sandboxes/${sandbox.id}/execute`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ code, runtime })
            }
          );
          
          return execResponse.json();
        },
        
        runCommand: async (command, args) => {
          const execResponse = await fetch(
            `https://api.cloud.com/v1/sandboxes/${sandbox.id}/command`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ command, args })
            }
          );
          
          return execResponse.json();
        },
        
        filesystem: {
          readFile: async (path) => {
            const response = await fetch(
              `https://api.cloud.com/v1/sandboxes/${sandbox.id}/files?path=${encodeURIComponent(path)}`,
              { headers: { 'Authorization': `Bearer ${config.apiKey}` } }
            );
            return response.text();
          },
          
          writeFile: async (path, content) => {
            await fetch(
              `https://api.cloud.com/v1/sandboxes/${sandbox.id}/files`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${config.apiKey}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ path, content })
              }
            );
          },
          
          mkdir: async (path) => {
            await fetch(
              `https://api.cloud.com/v1/sandboxes/${sandbox.id}/directories`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${config.apiKey}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ path })
              }
            );
          },
          
          readdir: async (path) => {
            const response = await fetch(
              `https://api.cloud.com/v1/sandboxes/${sandbox.id}/directories?path=${encodeURIComponent(path)}`,
              { headers: { 'Authorization': `Bearer ${config.apiKey}` } }
            );
            const data = await response.json();
            return data.files;
          },
          
          exists: async (path) => {
            const response = await fetch(
              `https://api.cloud.com/v1/sandboxes/${sandbox.id}/files/exists?path=${encodeURIComponent(path)}`,
              { headers: { 'Authorization': `Bearer ${config.apiKey}` } }
            );
            const data = await response.json();
            return data.exists;
          },
          
          remove: async (path) => {
            await fetch(
              `https://api.cloud.com/v1/sandboxes/${sandbox.id}/files?path=${encodeURIComponent(path)}`,
              {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${config.apiKey}` }
              }
            );
          }
        },
        
        getInfo: async () => {
          const response = await fetch(
            `https://api.cloud.com/v1/sandboxes/${sandbox.id}`,
            { headers: { 'Authorization': `Bearer ${config.apiKey}` } }
          );
          const data = await response.json();
          
          return {
            id: data.id,
            provider: 'cloud-provider',
            status: data.status,
            createdAt: new Date(data.created_at)
          };
        },
        
        destroy: async () => {
          await fetch(
            `https://api.cloud.com/v1/sandboxes/${sandbox.id}`,
            {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${config.apiKey}` }
            }
          );
        }
      };
    },
    
    getById: async (config, id) => {
      // Reconnect to existing sandbox
      const response = await fetch(
        `https://api.cloud.com/v1/sandboxes/${id}`,
        { headers: { 'Authorization': `Bearer ${config.apiKey}` } }
      );
      
      if (!response.ok) {
        throw new Error(`Sandbox not found: ${id}`);
      }
      
      const sandbox = await response.json();
      
      // Return the same sandbox object structure as create()
      return {
        sandboxId: sandbox.id,
        provider: 'cloud-provider',
        status: sandbox.status,
        createdAt: new Date(sandbox.created_at),
        // ... (same methods as in create())
      };
    },
    
    list: async (config) => {
      const response = await fetch(
        'https://api.cloud.com/v1/sandboxes',
        { headers: { 'Authorization': `Bearer ${config.apiKey}` } }
      );
      
      const data = await response.json();
      return data.sandboxes.map((s: any) => s.id);
    },
    
    destroy: async (config, id) => {
      await fetch(
        `https://api.cloud.com/v1/sandboxes/${id}`,
        {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${config.apiKey}` }
        }
      );
    }
  }
});

// Export factory function
export function createCloudProvider(config: Omit<CloudProviderConfig, 'name'>) {
  return {
    name: 'cloud-provider',
    ...config
  };
}
```

### Using Your Provider

```typescript
import { createCompute } from '@computesdk/provider';
import { cloudProvider, createCloudProvider } from './cloud-provider';

// Create compute instance
const compute = createCompute({
  defaultProvider: createCloudProvider({
    apiKey: process.env.CLOUD_API_KEY,
    region: 'us-west-2'
  })
});

// Use it
const sandbox = await compute.sandbox.create({
  options: { runtime: 'python' }
});

const result = await sandbox.runCode('print("Hello from my provider!")');
console.log(result.stdout);

await sandbox.destroy();
```

## Testing Your Provider

Use `@computesdk/test-utils` to test your provider implementation:

```typescript
import { describe, it } from 'vitest';
import { providerTestSuite } from '@computesdk/test-utils';
import { myProvider, createMyProvider } from './my-provider';

describe('MyProvider', () => {
  const provider = createMyProvider({
    apiKey: process.env.MY_PROVIDER_API_KEY
  });
  
  providerTestSuite(myProvider, provider);
});
```

## Error Handling

Always provide helpful error messages with setup instructions:

```typescript
if (!config.apiKey) {
  throw new Error(
    'Missing API key for my-provider.\n\n' +
    'Setup instructions:\n' +
    '1. Get your API key from https://myprovider.com/keys\n' +
    '2. Set environment variable: export MY_PROVIDER_API_KEY=your_key\n' +
    '3. Or pass it directly: myProvider({ apiKey: "your_key" })'
  );
}

if (!config.apiKey.startsWith('mp_')) {
  throw new Error(
    'Invalid API key format for my-provider.\n' +
    'API keys should start with "mp_".\n' +
    'Get your API key from https://myprovider.com/keys'
  );
}
```

## Best Practices

1. **Validate Configuration Early** - Check API keys and required config in the factory function
2. **Helpful Error Messages** - Include setup instructions in error messages
3. **Type Safety** - Use TypeScript generics for proper type inference
4. **Consistent Naming** - Follow the naming pattern: `defineProvider()`, `createMyProvider()`
5. **Documentation** - Document provider-specific features and limitations
6. **Testing** - Use provider test suite to ensure compliance
7. **Resource Cleanup** - Always implement proper cleanup in `destroy()`

## Migration from createProvider()

If you have existing code using `createProvider()`, here's how to migrate:

### Before (old API):

```typescript
import { createProvider } from 'computesdk';

export const myProvider = createProvider({
  name: 'my-provider',
  methods: {
    sandbox: {
      create: async (config, options) => { /* ... */ }
    }
  }
});
```

### After (new API):

```typescript
import { defineProvider } from '@computesdk/provider';

export const myProvider = defineProvider({
  name: 'my-provider',
  defaultMode: 'direct',
  sandbox: {
    create: async (config, options) => { /* ... */ }
  }
});
```

**Key Changes:**
- Import from `@computesdk/provider` instead of `computesdk`
- Rename `createProvider()` to `defineProvider()`
- Rename `methods.sandbox` to just `sandbox`
- Add `defaultMode` property

## Related Packages

- **computesdk** - User-facing SDK with gateway mode
- **@computesdk/e2b** - E2B provider implementation
- **@computesdk/modal** - Modal provider implementation
- **@computesdk/test-utils** - Testing utilities for providers

## Support

- [ComputeSDK Documentation](https://computesdk.com)
- [GitHub Issues](https://github.com/computesdk/computesdk/issues)
- [Provider Examples](https://github.com/computesdk/computesdk/tree/main/packages)

## License

MIT
