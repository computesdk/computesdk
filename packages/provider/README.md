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
    instances: {
      create: async (config, options) => {
        // Create sandbox via your provider's API
        const response = await fetch(`https://api.example.com/sandboxes`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${config.apiKey}` },
          body: JSON.stringify(options)
        });
        
        const data = await response.json();
        
        return {
          instance: data, // Your provider's sandbox object
          instanceId: data.id
        };
      },
      
      getById: async (config, instanceId) => {
        const response = await fetch(
          `https://api.example.com/sandboxes/${instanceId}`,
          { headers: { 'Authorization': `Bearer ${config.apiKey}` } }
        );
        
        if (!response.ok) return null;
        
        const data = await response.json();
        return { instance: data, instanceId: data.id };
      },
      
      list: async (config) => {
        const response = await fetch(
          `https://api.example.com/sandboxes`,
          { headers: { 'Authorization': `Bearer ${config.apiKey}` } }
        );
        
        const data = await response.json();
        return data.map((s: any) => ({ instance: s, instanceId: s.id }));
      },
      
      destroy: async (config, instanceId) => {
        await fetch(
          `https://api.example.com/sandboxes/${instanceId}`,
          {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${config.apiKey}` }
          }
        );
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
interface ProviderConfig<TInstance, TConfig> {
  name: string;
  defaultMode?: 'direct' | 'gateway';
  methods: {
    instances: InstanceMethods<TInstance, TConfig>;
    template?: TemplateMethods<TTemplate, TConfig>;
    snapshot?: SnapshotMethods<TSnapshot, TConfig>;
  };
}
```

`methods.sandbox` remains a deprecated alias for `methods.instances` — use `instances` in new providers.

**Returns:** A factory function `(config: TConfig) => Provider`

### Optional resource operations

Template and snapshot managers require a `create` hook, but `list` and `delete`
hooks are optional. Omit unsupported hooks instead of returning an empty list or
resolving a deletion without performing it. Generated managers expose
`operations: { create, list, delete }`; calls to omitted operations reject with
`UnsupportedOperationError` (`code: 'unsupported'`). A supported list operation
can still return `[]` when the inventory is genuinely empty.

Snapshot providers whose inventory requires an instance must declare
`listScope: 'instance'`. Their `snapshot.list({ instanceId, limit })` rejects
unscoped calls before invoking the provider. The legacy `sandboxId` option remains
supported. The default list scope is `'provider'`.

`compute.snapshot.list({ instanceId })` routes only to that instance's owner.
With multiple providers, create or resolve the instance through `compute` first,
or use a single-provider `compute` client. Instance-scoped managers supply the
filtered inventory; provider-wide inventories must identify each snapshot's
`instanceId` (or legacy `sandboxId`) so the SDK can filter safely. An inventory
with unidentifiable snapshots rejects scoped listing instead of returning unrelated
snapshots or pretending the scoped inventory is empty.

`compute.snapshot.list({ limit })` caps the combined results across providers,
after instance filtering. Limits must be non-negative integers. A limit does not
hide unsupported inventory operations from configured providers.

### Required Instance Methods

#### Collection Operations

These methods manage sandboxes at the collection level:

##### `create(config, options?)`

Create a new sandbox.

```typescript
create: async (config, options) => {
  // Return: { instance: YourSandboxObject, instanceId: string }
  return { instance: myInstance, instanceId: 'sandbox-123'
  };
}
```

##### `getById(config, instanceId)`

Get an existing sandbox by ID.

```typescript
getById: async (config, instanceId) => {
  // Return: { instance, instanceId } or null if not found
  return { instance: myInstance, instanceId };
}
```

##### `list(config)`

List all sandboxes.

```typescript
list: async (config) => {
  // Return: Array of { instance, instanceId }
  return [
    { instance: sandbox1, instanceId: 'id1' },
    { instance: sandbox2, instanceId: 'id2' }
  ];
}
```

##### `destroy(config, instanceId)`

Destroy a sandbox.

```typescript
destroy: async (config, instanceId) => {
  await yourApi.deleteSandbox(instanceId);
}
```

#### Instance Operations

These methods operate on individual sandbox instances:

##### `runCommand(sandbox, command, args?, options?)`

Run a shell command.

```typescript
runCommand: async (sandbox, command, args) => {
  const result = await yourApi.runCommand(sandbox.id, command, args);
  return {
    stdout: result.stdout,
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

Add filesystem support by implementing the `filesystem` methods. Import `escapeShellArg` from `@computesdk/provider` and always interpolate it inside double quotes — the helper escapes `\`, `"`, `$`, and backticks but not spaces or shell metacharacters like `;` and `|`, so unquoted usage will break on paths with spaces and is unsafe for user-controlled input.

```typescript
import { defineProvider, escapeShellArg } from '@computesdk/provider';

// ...

methods: {
  instances: {
    // ... required methods
    
    filesystem: {
      readFile: async (sandbox, path, runCommand) => {
        const result = await runCommand(sandbox, `cat "${escapeShellArg(path)}"`);
        return result.stdout;
      },
      
      writeFile: async (sandbox, path, content, runCommand) => {
        await runCommand(sandbox, `cat > "${escapeShellArg(path)}" << 'EOF'\n${content}\nEOF`);
      },
      
      mkdir: async (sandbox, path, runCommand) => {
        await runCommand(sandbox, `mkdir -p "${escapeShellArg(path)}"`);
      },
      
      readdir: async (sandbox, path, runCommand) => {
        const result = await runCommand(sandbox, `ls -la "${escapeShellArg(path)}"`);
        // Parse ls output and return FileEntry[]
        return parseFileList(result.stdout);
      },
      
      exists: async (sandbox, path, runCommand) => {
        const result = await runCommand(sandbox, `test -e "${escapeShellArg(path)}"`);
        return result.exitCode === 0;
      },
      
      remove: async (sandbox, path, runCommand) => {
        await runCommand(sandbox, `rm -rf "${escapeShellArg(path)}"`);
      }
    }
  }
}
```

**Note:** If you don't implement `filesystem`, the sandbox will still work but filesystem operations will throw helpful "not supported" errors.

## Background processes and streaming

`instance.startProcess(...)` and `runCommand(cmd, { onStdout, onStderr })` use native hooks or a compatibility runtime where supported. The framework picks the runtime in this order:

1. **Native** — the provider's own `streamCommand` / `startProcess` hooks on `methods.instances`.
2. **Shell tier (default)** — POSIX-shell process records built only on the provider's plain `runCommand`. No Node, daemon or download in the instance, so it works on any image with `sh`, including Alpine and busybox.
3. **daemond (opt-in)** — the in-box daemon, only when the provider is configured with `processRuntime: 'daemond'`:

```typescript
const provider = e2b({ apiKey, processRuntime: 'daemond' });
```

`instance.processRuntime` reports which tier serves each capability, e.g. `{ streaming: 'native', processes: 'shell' }`. After the shell tier detects that an instance cannot preserve state across commands, `streaming` reports `'unsupported'` unless native streaming is available.

### Shell tier

Each job is a directory `${TMPDIR:-/tmp}/.computesdk/jobs/<jobId>/` (mode 0700). One exec writes the job's files and launches a supervisor with `nohup setsid`; the supervisor runs the command in its own process group with stdout/stderr through FIFOs into a framed log (`out.log`, records `O<len>\n…` / `E<len>\n…` at absolute byte offsets), then writes `pid` and `exit`.

- **Reads** (`status`, `wait`, streaming) are one exec each, take a byte cursor and return only new output, at most 16 KiB of log per exec (about 22 KB base64, under SSM's 24,000-character inline cap). `wait` long-polls in the box for up to 25s per exec.
- **stdin** (`stdin: true`): a FIFO kept open by a holder process; `write` is one exec appending to it, `closeStdin` kills the holder.
- **kill** signals the whole process group. A streaming `runCommand`'s `timeout` is enforced in the box by a watchdog that SIGKILLs the group (exit code 124), so the deadline holds when the client is gone. Without `timeout` nothing kills the command.
- **Reattach**: `instance.attachProcess(jobId)` rebuilds a handle in a new client.
- **Retention**: a job directory is removed 10 minutes after exit (60s after a kill).
- **Instances whose execs share no state** (a fresh container per command, e.g. archil disk exec): the first launch on an instance holds the command until a second exec confirms the job directory survived, so this is detected before the user command runs. Callback-based streaming and `startProcess` throw `ShellStateNotPersistentError` (`code: 'unsupported'`). Plain buffered `runCommand` remains available; completed output is never replayed as live callbacks.
- **Requirements**: `sh`, `setsid`, `mkfifo`, `kill`, `cat`, `dd`, `wc`, `tail`, `head`, `base64`, `mkdir`, `rm`, `mv`, `sleep`. A missing one fails with `ShellProcessUnsupportedError` naming it.

The egress router (`CreateInstanceOptions.egress`) stays on daemond: its shim is a Node program, and daemond's bootstrap is what installs Node on images without it.

## Type Definitions

### Core Types

```typescript
import type {
  // Provider types
  Provider,
  ProviderConfig,
  ProviderInstance,
  
  // Method definitions
  InstanceMethods,
  TemplateMethods,
  SnapshotMethods,
  
  // Result types
  CodeResult,
  CommandResult,
  InstanceInfo,
  
  // Options
  CreateInstanceOptions,
  RunCommandOptions,
  
  // Filesystem
  FileEntry,
  InstanceFileSystem
} from '@computesdk/provider';
```

### Provider Modes

Providers can operate in different modes:

- **`direct`** - Provider has native sandbox capabilities (e.g., E2B, Modal)
- **`gateway`** - Provider only has infrastructure - routes through gateway

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
    instances: {
      create: async (config, options) => {
        const id = `sandbox-${Date.now()}`;
        return {
          instance: { id, status: 'running' },
          instanceId: id
        };
      },
      
      getById: async (config, id) => {
        return {
          instance: { id, status: 'running' },
          instanceId: id
        };
      },
      
      list: async (config) => {
        return [];
      },
      
      destroy: async (config, id) => {
        // Clean up sandbox
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
const sandbox = await compute.instances.create();
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
runCommand: async (sandbox, command, args) => {
  try {
    return await yourApi.runCommand(sandbox.id, command, args);
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
    
    const sandbox = await compute.instances.create();
    expect(sandbox.instanceId).toBeDefined();
    
    const info = await sandbox.getInfo();
    expect(info.status).toBe('running');
    
    await sandbox.destroy();
  });
  
  it('executes code', async () => {
    const compute = myProvider({ apiKey: process.env.MY_PROVIDER_API_KEY! });
    const sandbox = await compute.instances.create();
    
    const result = await sandbox.runCommand('python -c "print(\"Hello\")"');
    expect(result.stdout).toContain('Hello');
    expect(result.exitCode).toBe(0);
    
    await sandbox.destroy();
  });
});
```

## Examples

See these provider implementations for reference:

- **[@computesdk/e2b](../e2b)** - Full-featured provider with filesystem operations
- **[@computesdk/modal](../modal)** - GPU-accelerated Python provider
- **[@computesdk/daytona](../daytona)** - Workspace-based development sandboxes

## Related Packages

- **[computesdk](../computesdk)** - User-facing gateway SDK
- **[@computesdk/e2b](../e2b)** - E2B provider implementation
- **[@computesdk/modal](../modal)** - Modal provider implementation

## License

MIT

## Pure standard-size capability hook

`defineProvider` accepts an optional synchronous `sizes(config, profile, options)`
hook. Legacy custom `Provider` implementations need not add this field. Factory
providers expose an immutable `provider.sizes.list(context?)` / `resolve(class,
context?)` manager; adapters without a hook report `unknown` and reject explicit
`sizeClass` requests instead of ignoring them. Context can include mode or
platform selectors, but must not combine standard and native size controls.

```ts
sizes: (_config, profile, options) => {
  if (options?.snapshotId) {
    return { status: 'unsupported', reason: 'Restores inherit resource sizing.' };
  }
  // Declare supported only after verifying exact CPU + RAM bounds and semantics.
  return {
    status: 'supported',
    nativeOptions: { vcpus: profile.vcpus, memoryMiB: profile.memoryMiB },
  };
},
```

The factory applies flat fields and merges the known Namespace
`instanceOptions.shape` resource path in
a copy of create options, strips `sizeClass`, and records immutable request
metadata as `instance.sizing`. Hooks must return only resource mapping fields,
never copy caller env/metadata/authorization/passthrough bodies into the patch.
This bounded merge preserves unrelated nested fields without freezing caller
objects; it does not recursively normalize arbitrary create options. Standard
resource contexts and emitted patches reject unsafe keys/accessors; plain and
null-prototype data objects are accepted. No-class requests are untouched.
Operational `resolution.nativeOptions` is separate from `instance.sizing`, which
contains only requested/resolved CPU/RAM/class and provenance.
They must be pure: no client construction, credentials checks, template listing,
network access, builds, or provisioning. Supported mappings are adapter-declared
requests, not measured resources or account/region availability guarantees.
Return `unconfigured`, `unavailable`, `requires-build`, `unknown`, or `unsupported`
with a reason when an exact mapping cannot be declared. No fallback or automatic
build occurs. Discovery results are copied and frozen (including nested native
options); caller inputs are not frozen or mutated.

`createCompute` guards legacy custom providers lacking a sizing contract.
`defineInfraProvider` currently rejects standard-size requests as `unknown`; its
legacy native create path is unchanged. Direct calls into a handwritten custom
provider remain that provider author's responsibility.

An `InstanceSizeManager` carries `contract: 'computesdk.instance-sizes.v1'` to make
opt-in explicit and distinguish unrelated legacy `sizes` properties. A handwritten
provider declaring this contract is responsible for actually consuming
`sizeClass` in its create method; the framework guarantees this for
`defineProvider` adapters. The core rejects incompatible/malformed declarations.

Standard options, the bounded native resource context, and emitted patches use
enumerable own string-key data descriptors. Symbol/non-enumerable/accessor fields
reject before hook/copy/create; a function carrying a defined `sizeClass` cannot
opt out of validation. Missing/undefined `sizeClass` retains legacy passthrough.

For source compatibility, base `Provider.sizes` / `DirectProvider.sizes` is an
optional `unknown` extension slot: legacy arrays, functions, or unrelated objects
remain assignable even without a standard request. Use `isInstanceSizeManager`
to narrow this slot before discovery. `defineProvider` and SDK adapter factories
still return a required, strongly typed `sizes` manager; a missing/incompatible
runtime contract still rejects a defined standard request before create.

Compiler-only legacy compatibility coverage is included by this package's
`tsconfig.json` (`src/**/*`, including `src/__tests__/legacy-size-types.ts`). Run
it explicitly from the workspace root without network/install:

```sh
pnpm exec tsc --noEmit --strict --target es2020 --moduleResolution node --esModuleInterop --skipLibCheck packages/provider/src/__tests__/legacy-size-types.ts
```

The normal mock suite also runs `legacy-size-types.test.ts`, which invokes the
already installed TypeScript compiler on this fixture offline (`--noEmit`); the
fixture's type-only example calls are never executed. No install/network step is
needed, so a structural legacy regression fails ordinary `pnpm test` too.
