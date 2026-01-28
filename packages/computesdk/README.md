# computesdk

The gateway SDK for running code in remote sandboxes. Zero-config auto-detection with support for E2B, Modal, Railway, Daytona, Vercel, and more.

## Installation

```bash
npm install computesdk
```

## Quick Start

### Zero-Config Mode (Recommended)

Set your provider credentials as environment variables and ComputeSDK automatically detects and configures everything:

```bash
export E2B_API_KEY=your_e2b_api_key
```

```typescript
import { compute } from 'computesdk';

// Auto-detects E2B from environment
const sandbox = await compute.sandbox.create();

// Execute code
const result = await sandbox.runCode('print("Hello World!")');
console.log(result.output); // "Hello World!"

// Clean up
await sandbox.destroy();
```

### Explicit Configuration

For more control, use `setConfig()` to explicitly configure the provider:

```typescript
import { compute } from 'computesdk';

compute.setConfig({
  provider: 'your-provider',
  apiKey: process.env.COMPUTESDK_API_KEY,
  'your-provider': {
    apiKey: process.env.YOUR_PROVIDER_API_KEY
  }
});

const sandbox = await compute.sandbox.create();
```

## Supported Providers

ComputeSDK automatically detects providers based on environment variables:

| Provider | Environment Variables | Use Cases |
|----------|----------------------|-----------|
| **E2B** | `E2B_API_KEY` | Data science, Python/Node.js, interactive terminals |
| **Modal** | `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` | GPU computing, ML inference, Python workloads |
| **Railway** | `RAILWAY_TOKEN` | Full-stack deployments, persistent storage |
| **Daytona** | `DAYTONA_API_KEY` | Development workspaces, custom environments |
| **Runloop** | `RUNLOOP_API_KEY` | Code execution, automation |
| **Vercel** | `VERCEL_TOKEN` or `VERCEL_OIDC_TOKEN` | Serverless functions, web apps |
| **Cloudflare** | `CLOUDFLARE_API_TOKEN` | Edge computing |
| **CodeSandbox** | `CODESANDBOX_TOKEN` | Collaborative development |

### Provider Detection Order

When using zero-config mode, ComputeSDK detects providers in this order:

**E2B → Railway → Daytona → Modal → Runloop → Vercel → Cloudflare → CodeSandbox**

You can force a specific provider:

```bash
export COMPUTESDK_PROVIDER=modal
```

## API Reference

### Configuration

#### `compute.setConfig(config)`

Configure the gateway with explicit provider settings.

```typescript
compute.setConfig({
  provider: 'your-provider',
  apiKey: process.env.COMPUTESDK_API_KEY,
  'your-provider': {
    apiKey: process.env.YOUR_PROVIDER_API_KEY
  }
});
```

**Provider-specific configs:**

```typescript
// E2B
compute.setConfig({
  provider: 'e2b',
  apiKey: process.env.COMPUTESDK_API_KEY,
  e2b: { 
    apiKey: 'e2b_xxx',
    templateId: 'optional_template' 
  }
});

// Modal
compute.setConfig({
  provider: 'modal',
  apiKey: process.env.COMPUTESDK_API_KEY,
  modal: { 
    tokenId: 'ak-xxx',
    tokenSecret: 'as-xxx'
  }
});

// Railway
compute.setConfig({
  provider: 'railway',
  apiKey: process.env.COMPUTESDK_API_KEY,
  railway: { 
    apiToken: 'your_token',
    projectId: 'project_id',
    environmentId: 'env_id'
  }
});

// Daytona
compute.setConfig({
  provider: 'daytona',
  apiKey: process.env.COMPUTESDK_API_KEY,
  daytona: { apiKey: 'your_api_key' }
});

// Vercel
compute.setConfig({
  provider: 'vercel',
  apiKey: process.env.COMPUTESDK_API_KEY,
  vercel: { 
    token: 'your_token',
    teamId: 'team_xxx',
    projectId: 'prj_xxx'
  }
});
```

### Sandbox Management

#### `compute.sandbox.create(options?)`

Create a new sandbox.

```typescript
const sandbox = await compute.sandbox.create();

// With options
const sandbox = await compute.sandbox.create({
  timeout: 300000, // 5 minutes
  metadata: { userId: '123' },
  namespace: 'my-org',
  name: 'my-sandbox',
});
```

**Options:**
- `timeout?: number` - Timeout in milliseconds
- `metadata?: Record<string, any>` - Custom metadata
- `envs?: Record<string, string>` - Environment variables
- `namespace?: string` - Namespace for organizing sandboxes
- `name?: string` - Name for the sandbox (enables findOrCreate)
- `overlays?: SetupOverlayConfig[]` - Template overlays to apply
- `servers?: ServerStartOptions[]` - Servers to start automatically

#### `compute.sandbox.getById(sandboxId)`

Get an existing sandbox by ID.

```typescript
const sandbox = await compute.sandbox.getById('sandbox-id');
```

#### `compute.sandbox.findOrCreate(options)`

Find an existing sandbox by namespace and name, or create a new one.

```typescript
const sandbox = await compute.sandbox.findOrCreate({
  namespace: 'my-org',
  name: 'my-project',
});
```

#### `compute.sandbox.find(options)`

Find an existing sandbox by namespace and name (returns null if not found).

```typescript
const sandbox = await compute.sandbox.find({
  namespace: 'my-org',
  name: 'my-project',
});
```

### Sandbox Operations

#### `sandbox.runCode(code, language?)`

Execute code in the sandbox.

```typescript
const result = await sandbox.runCode('print("Hello")', 'python');
console.log(result.output); // "Hello"
console.log(result.exitCode);
```

#### `sandbox.runCommand(command, options?)`

Run a shell command.

```typescript
const result = await sandbox.runCommand('npm install express');
console.log(result.stdout);
console.log(result.exitCode);

// With options
const result = await sandbox.runCommand('npm install', {
  cwd: '/app',
  env: { NODE_ENV: 'production' },
  background: true,
});
```

#### `sandbox.destroy()`

Destroy the sandbox and clean up resources.

```typescript
await sandbox.destroy();
```

### Filesystem Operations

The sandbox provides full filesystem access:

#### `sandbox.filesystem.writeFile(path, content)`

Write a file to the sandbox.

```typescript
await sandbox.filesystem.writeFile('/tmp/hello.py', 'print("Hello World")');
```

#### `sandbox.filesystem.readFile(path)`

Read a file from the sandbox.

```typescript
const content = await sandbox.filesystem.readFile('/tmp/hello.py');
console.log(content); // 'print("Hello World")'
```

#### `sandbox.filesystem.mkdir(path)`

Create a directory.

```typescript
await sandbox.filesystem.mkdir('/tmp/mydir');
```

#### `sandbox.filesystem.readdir(path)`

List directory contents.

```typescript
const files = await sandbox.filesystem.readdir('/tmp');
console.log(files); // [{ name: 'hello.py', type: 'file', size: 123 }, ...]
```

#### `sandbox.filesystem.exists(path)`

Check if a file or directory exists.

```typescript
const exists = await sandbox.filesystem.exists('/tmp/hello.py');
console.log(exists); // true
```

#### `sandbox.filesystem.remove(path)`

Remove a file or directory.

```typescript
await sandbox.filesystem.remove('/tmp/hello.py');
```

### Terminal Operations

The sandbox provides terminal access in two modes: **PTY mode** (interactive shell) and **Exec mode** (command tracking).

#### `sandbox.terminal.create(options?)`

Create a new terminal session.

```typescript
// PTY mode - Interactive shell
const pty = await sandbox.terminal.create({ pty: true, shell: '/bin/bash' });

// Exec mode - Command tracking (default)
const exec = await sandbox.terminal.create({ pty: false });
```

**Options:**
- `pty?: boolean` - Terminal mode: `true` = PTY (interactive), `false` = exec (command tracking). Default: `false`
- `shell?: string` - Shell to use (e.g., '/bin/bash'). PTY mode only
- `encoding?: 'raw' | 'base64'` - Output encoding. Default: `'raw'`

**Returns:** `TerminalInstance`

#### `sandbox.terminal.list()`

List all active terminals.

```typescript
const terminals = await sandbox.terminal.list();
console.log(terminals); // [{ id: 'term-1', pty: true, status: 'running', ... }]
```

#### `sandbox.terminal.retrieve(id)`

Retrieve a specific terminal by ID.

```typescript
const terminal = await sandbox.terminal.retrieve('term-123');
console.log(terminal.id, terminal.status);
```

#### `sandbox.terminal.destroy(id)`

Destroy a terminal by ID.

```typescript
await sandbox.terminal.destroy('term-123');
```

### PTY Mode (Interactive Shell)

PTY mode creates an interactive shell session with real-time input/output over WebSocket.

#### `terminal.write(input)`

Send input to the terminal shell.

```typescript
const pty = await sandbox.terminal.create({ pty: true });
pty.on('output', (data) => console.log(data));
pty.write('ls -la\n');
pty.write('pwd\n');
await pty.destroy();
```

#### `terminal.resize(cols, rows)`

Resize the terminal window.

```typescript
pty.resize(120, 40);
```

#### `terminal.on(event, handler)`

Register an event handler. Events: `'output'`, `'error'`, `'destroyed'`.

```typescript
pty.on('output', (data) => console.log('Output:', data));
pty.on('error', (error) => console.error('Error:', error));
pty.on('destroyed', () => console.log('Terminal destroyed'));
```

#### `terminal.off(event, handler)`

Unregister an event handler.

```typescript
const handler = (data) => console.log(data);
pty.on('output', handler);
pty.off('output', handler);
```

#### Terminal Properties

```typescript
console.log(pty.id);       // Terminal ID
console.log(pty.status);   // 'running' | 'stopped' | 'active' | 'ready'
console.log(pty.channel);  // WebSocket channel (PTY only)
console.log(pty.pty);      // true for PTY mode
```

### Exec Mode (Command Tracking)

Exec mode executes commands with structured result tracking, suitable for automation.

#### `terminal.command.run(command, options?)`

Execute a command in the terminal.

```typescript
const exec = await sandbox.terminal.create({ pty: false });

// Foreground execution (waits for completion)
const cmd = await exec.command.run('npm test');
console.log(cmd.stdout);
console.log(cmd.stderr);
console.log(cmd.exitCode);

// Background execution (returns immediately)
const bgCmd = await exec.command.run('npm install', { background: true });
console.log(bgCmd.status); // 'running'
await bgCmd.wait(); // Wait for completion
console.log(bgCmd.exitCode);
```

**Parameters:**
- `command: string` - The command to execute
- `options?: { background?: boolean }` - Execution options

**Returns:** `Command` object

#### `terminal.command.list()`

List all commands executed in this terminal.

```typescript
const commands = await exec.command.list();
commands.forEach(cmd => {
  console.log(cmd.id, cmd.command, cmd.status, cmd.exitCode);
});
```

#### `terminal.command.retrieve(cmdId)`

Retrieve a specific command by ID.

```typescript
const cmd = await exec.command.retrieve('cmd-123');
console.log(cmd.stdout);
```

### Command Object

The `Command` object represents a command execution result.

#### Command Properties

```typescript
console.log(cmd.id);          // Command ID
console.log(cmd.terminalId);  // Parent terminal ID
console.log(cmd.command);     // Executed command
console.log(cmd.status);      // 'running' | 'completed' | 'failed'
console.log(cmd.stdout);      // Standard output
console.log(cmd.stderr);      // Standard error
console.log(cmd.exitCode);    // Exit code (undefined if running)
console.log(cmd.durationMs);  // Execution time in milliseconds
console.log(cmd.startedAt);   // Start timestamp
console.log(cmd.finishedAt);  // Finish timestamp (undefined if running)
```

#### `command.wait(timeout?)`

Wait for a background command to complete.

```typescript
const cmd = await exec.command.run('sleep 5', { background: true });
await cmd.wait(); // Waits up to default timeout
console.log(cmd.exitCode);

// With custom timeout (in seconds, 0 = no timeout)
await cmd.wait(10);
```

#### `command.refresh()`

Refresh the command status from the server.

```typescript
const cmd = await exec.command.run('npm build', { background: true });
// ... later ...
await cmd.refresh();
console.log(cmd.status, cmd.exitCode);
```

#### `terminal.destroy()`

Destroy the terminal and clean up resources.

```typescript
await exec.destroy();
```

## Examples

### Multi-Step Build Process

```typescript
import { compute } from 'computesdk';

const sandbox = await compute.sandbox.create();

// Create project structure
await sandbox.filesystem.mkdir('/app');
await sandbox.filesystem.mkdir('/app/src');

// Write package.json
await sandbox.filesystem.writeFile('/app/package.json', JSON.stringify({
  name: 'my-app',
  version: '1.0.0',
  dependencies: {
    'express': '^4.18.0'
  }
}, null, 2));

// Write source code
await sandbox.filesystem.writeFile('/app/src/index.js', `
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.json({ message: 'Hello World!' });
});

console.log('Server ready!');
`);

// Install dependencies
const installResult = await sandbox.runCommand('npm install', { cwd: '/app' });
console.log('Install:', installResult.stdout);

// Run the app
const runResult = await sandbox.runCode(`
const { spawn } = require('child_process');
const proc = spawn('node', ['src/index.js'], { cwd: '/app' });
proc.stdout.on('data', (data) => console.log(data.toString()));
`);

console.log(runResult.output);

await sandbox.destroy();
```

### Terminal Command Execution

```typescript
import { compute } from 'computesdk';

const sandbox = await compute.sandbox.create();

// Create exec mode terminal for command tracking
const terminal = await sandbox.terminal.create({ pty: false });

// Run build commands with tracking
const install = await terminal.command.run('npm install');
console.log('Install exit code:', install.exitCode);

const build = await terminal.command.run('npm run build');
console.log('Build output:', build.stdout);

// Run tests in background
const tests = await terminal.command.run('npm test', { background: true });
console.log('Tests started:', tests.status);

// Wait for tests to complete
await tests.wait(60); // 60 second timeout
console.log('Tests completed:', tests.exitCode === 0 ? 'PASSED' : 'FAILED');
console.log('Test output:', tests.stdout);

// List all commands
const commands = await terminal.command.list();
console.log(`Executed ${commands.length} commands`);

await terminal.destroy();
await sandbox.destroy();
```

### Interactive Terminal Session

```typescript
import { compute } from 'computesdk';

const sandbox = await compute.sandbox.create();

// Create PTY terminal for interactive shell
const pty = await sandbox.terminal.create({ 
  pty: true, 
  shell: '/bin/bash' 
});

// Collect all output
let output = '';
pty.on('output', (data) => {
  output += data;
  console.log(data);
});

pty.on('error', (error) => {
  console.error('Terminal error:', error);
});

// Execute interactive commands
pty.write('echo "Starting project setup"\n');
pty.write('mkdir -p /workspace/myproject\n');
pty.write('cd /workspace/myproject\n');
pty.write('npm init -y\n');
pty.write('npm install express\n');
pty.write('echo "Setup complete"\n');

// Wait for operations to complete
await new Promise(resolve => setTimeout(resolve, 5000));

// Clean up
await pty.destroy();
await sandbox.destroy();

console.log('Complete output:', output);
```

### Using Different Providers

```typescript
import { compute } from 'computesdk';

// Use E2B for data science
compute.setConfig({
  provider: 'e2b',
  e2b: { apiKey: process.env.E2B_API_KEY }
});

const e2bSandbox = await compute.sandbox.create();
await e2bSandbox.runCode('import pandas as pd; print(pd.__version__)');
await e2bSandbox.destroy();

// Switch to Modal for GPU workloads
compute.setConfig({
  provider: 'modal',
  modal: { 
    tokenId: process.env.MODAL_TOKEN_ID,
    tokenSecret: process.env.MODAL_TOKEN_SECRET
  }
});

const modalSandbox = await compute.sandbox.create();
await modalSandbox.runCode('import torch; print(torch.cuda.is_available())');
await modalSandbox.destroy();
```

## Error Handling

```typescript
try {
  const sandbox = await compute.sandbox.create();
  const result = await sandbox.runCode('invalid python code');
} catch (error) {
  console.error('Execution failed:', error.message);
  
  // Check for specific error types
  if (error.message.includes('No provider detected')) {
    console.error('Set provider credentials in environment variables');
  }
}
```

## Direct Mode (Advanced)

For advanced use cases where you want to bypass the gateway and use provider SDKs directly, see individual provider packages:

- **[@computesdk/e2b](../e2b)** - E2B provider
- **[@computesdk/modal](../modal)** - Modal provider
- **[@computesdk/railway](../railway)** - Railway provider
- **[@computesdk/daytona](../daytona)** - Daytona provider

Example direct mode usage:

```typescript
import { e2b } from '@computesdk/e2b';

const compute = e2b({ apiKey: 'your_api_key' });
const sandbox = await compute.sandbox.create();
```

## Building Custom Providers

Want to add support for a new compute provider? See **[@computesdk/provider](../provider)** for the provider framework and documentation on building custom providers.

## TypeScript Support

Full TypeScript support with comprehensive type definitions:

```typescript
import type { 
  Sandbox,
  SandboxInfo,
  CodeResult,
  CommandResult,
  CreateSandboxOptions
} from 'computesdk';
```

## License

MIT
