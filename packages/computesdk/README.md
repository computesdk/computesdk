# ComputeSDK

A unified abstraction layer for executing code in secure, isolated sandboxed environments across multiple cloud providers.

## Installation

```bash
npm install computesdk
```

## Quick Start

```typescript
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

// Set default provider
compute.setConfig({ 
  provider: e2b({ apiKey: process.env.E2B_API_KEY }) 
});

// Create a sandbox
const sandbox = await compute.sandbox.create({});

// Execute code
const result = await sandbox.runCode('print("Hello World!")');
console.log(result.stdout); // "Hello World!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

## Core API

### Configuration

```typescript
import { compute } from 'computesdk';

// Set default provider
compute.setConfig({ provider: myProvider });

// Get current config
const config = compute.getConfig();

// Clear config
compute.clearConfig();
```

### Sandbox Management

```typescript
// Create sandbox with explicit provider
const sandbox = await compute.sandbox.create({
  provider: e2b({ apiKey: 'your-key' }),
  options: { runtime: 'python', timeout: 300000 }
});

// Create sandbox with default provider
const sandbox = await compute.sandbox.create({
  options: { runtime: 'python' }
});

// Get existing sandbox
const sandbox = await compute.sandbox.getById('sandbox-id');

// List all sandboxes
const sandboxes = await compute.sandbox.list();

// Destroy sandbox
await compute.sandbox.destroy('sandbox-id');
```

### Code Execution

```typescript
// Run code
const result = await sandbox.runCode('print("Hello")', 'python');

// Run shell command
const result = await sandbox.runCommand('ls', ['-la']);

// Result structure
interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  sandboxId: string;
  provider: string;
}
```

### Filesystem Operations

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

### Terminal Operations

```typescript
// Create terminal
const terminal = await sandbox.terminal.create({
  command: 'bash',
  cols: 80,
  rows: 24
});

// Write to terminal
await terminal.write('ls -la\n');

// Resize terminal
await terminal.resize(120, 30);

// Kill terminal
await terminal.kill();

// List terminals
const terminals = await sandbox.terminal.list();

// Get terminal by ID
const terminal = await sandbox.terminal.getById('terminal-id');
```

## Web Framework Integration

ComputeSDK provides built-in request handlers for web frameworks:

```typescript
import { handleHttpComputeRequest } from 'computesdk';
import { e2b } from '@computesdk/e2b';

// Next.js API route
export async function POST(request: Request) {
  return handleHttpComputeRequest({
    request,
    provider: e2b({ apiKey: process.env.E2B_API_KEY })
  });
}

// Client usage
const response = await fetch('/api/compute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'compute.sandbox.runCode',
    code: 'print("Hello from web!")',
    runtime: 'python'
  })
});

const result = await response.json();
console.log(result.result.stdout);
```

### Supported Actions

- `compute.sandbox.create` - Create new sandbox
- `compute.sandbox.destroy` - Destroy sandbox
- `compute.sandbox.getInfo` - Get sandbox information
- `compute.sandbox.list` - List all sandboxes
- `compute.sandbox.runCode` - Execute code
- `compute.sandbox.runCommand` - Run shell command
- `compute.sandbox.filesystem.readFile` - Read file
- `compute.sandbox.filesystem.writeFile` - Write file
- `compute.sandbox.filesystem.mkdir` - Create directory
- `compute.sandbox.filesystem.readdir` - List directory
- `compute.sandbox.filesystem.exists` - Check if path exists
- `compute.sandbox.filesystem.remove` - Remove file/directory
- `compute.sandbox.terminal.create` - Create terminal
- `compute.sandbox.terminal.list` - List terminals
- `compute.sandbox.terminal.getById` - Get terminal by ID
- `compute.sandbox.terminal.destroy` - Destroy terminal
- `compute.sandbox.terminal.write` - Write to terminal
- `compute.sandbox.terminal.resize` - Resize terminal
- `compute.sandbox.terminal.kill` - Kill terminal

## Provider Packages

ComputeSDK uses separate provider packages:

```bash
npm install @computesdk/e2b        # E2B provider
npm install @computesdk/vercel     # Vercel provider  
npm install @computesdk/daytona    # Daytona provider
```

Each provider implements the same interface but may support different capabilities (filesystem, terminal, etc.).

## Custom Providers

Create custom providers using the factory:

```typescript
import { createProvider } from 'computesdk';

const myProvider = createProvider({
  name: 'my-provider',
  create: async (options) => {
    // Implementation
  },
  getById: async (id) => {
    // Implementation  
  },
  list: async () => {
    // Implementation
  },
  destroy: async (id) => {
    // Implementation
  }
});
```

## TypeScript Support

ComputeSDK is fully typed with comprehensive TypeScript definitions:

```typescript
import type { 
  Sandbox, 
  Provider, 
  ExecutionResult,
  ComputeConfig,
  Runtime 
} from 'computesdk';
```

## Error Handling

```typescript
try {
  const sandbox = await compute.sandbox.create({});
  const result = await sandbox.runCode('invalid code');
} catch (error) {
  console.error('Execution failed:', error.message);
}
```

## Examples

Check out the [examples directory](../../examples) for complete implementations with different web frameworks:

- [Next.js](../../examples/nextjs)
- [Nuxt](../../examples/nuxt) 
- [SvelteKit](../../examples/sveltekit)
- [Remix](../../examples/remix)
- [Astro](../../examples/astro)

## License

MIT