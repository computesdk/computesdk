# @computesdk/client

Universal sandbox client for ComputeSDK - connect to sandboxes from browser, Node.js, and edge runtimes.

## Features

- 🌐 **Universal** - Works in browser, Node.js, Deno, Bun, Cloudflare Workers, and edge runtimes
- 🔌 **WebSocket Support** - Real-time terminals, file watchers, and signal monitoring
- 📁 **File Operations** - Read, write, and manage files in remote sandboxes
- ⚡ **Command Execution** - Run commands with PTY or exec mode
- 🖥️ **Server Management** - Start, stop, and manage long-running servers
- 🔐 **Authentication** - Access tokens and session tokens with magic link support
- 🎯 **Type-Safe** - Full TypeScript support with comprehensive types
- 📦 **Binary Protocol** - Efficient binary WebSocket protocol (50-90% size reduction)
- 🛡️ **Production Ready** - Battle-tested in production environments

## Installation

```bash
npm install @computesdk/client
```

**Node.js < 21:** You'll need the `ws` package for WebSocket support:

```bash
npm install ws
```

**Node.js 21+:** Native WebSocket support is included, no additional packages needed!

## Quick Start

### Browser Usage

In the browser, the sandbox auto-detects configuration from URL parameters or localStorage:

```typescript
import { Sandbox } from '@computesdk/client';

// Provide configuration explicitly
const sandbox = new Sandbox({
  sandboxId: 'sandbox-123',
  provider: 'gateway',
  sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com',
  token: 'your-session-token'
});

// Execute commands
const result = await sandbox.runCommand('ls -la');
console.log(result.stdout);

// Work with files
await sandbox.writeFile('/home/project/hello.txt', 'Hello World!');
const content = await sandbox.readFile('/home/project/hello.txt');
console.log(content);
```

### Node.js Usage

**Node.js 21+** (native WebSocket):

```typescript
import { Sandbox } from '@computesdk/client';

const sandbox = new Sandbox({
  sandboxId: 'sandbox-123',
  provider: 'gateway',
  sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com',
  token: 'your-session-token'
});

const result = await sandbox.runCommand('node --version');
console.log(result.stdout);
```

**Node.js < 21** (requires `ws` package):

```typescript
import { Sandbox } from '@computesdk/client';
import WebSocket from 'ws';

const sandbox = new Sandbox({
  sandboxId: 'sandbox-123',
  provider: 'gateway',
  sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com',
  token: 'your-session-token',
  WebSocket // Required for Node.js < 21
});

const result = await sandbox.runCommand('node --version');
console.log(result.stdout);
```

## Resource Namespaces

The Sandbox class provides resource namespaces for organized API access:

### Terminals (`sandbox.terminals`)

```typescript
// Create a PTY terminal (interactive shell with WebSocket)
const ptyTerminal = await sandbox.terminals.create({
  pty: true,
  shell: '/bin/bash'
});
ptyTerminal.on('output', (data) => console.log(data));
ptyTerminal.write('ls -la\n');

// Create an exec terminal (command tracking without WebSocket)
const execTerminal = await sandbox.terminals.create({ pty: false });
const result = await execTerminal.execute('npm test');
console.log(result.data.stdout);

// List all terminals
const terminals = await sandbox.terminals.list();

// Retrieve a specific terminal
const terminal = await sandbox.terminals.retrieve('terminal-id');

// Destroy a terminal
await sandbox.terminals.destroy('terminal-id');
```

### Commands (`sandbox.commands`)

One-shot command execution without managing terminals:

```typescript
// Run a command and wait for completion
const result = await sandbox.commands.run('npm test');
console.log(result.stdout);
console.log(result.exitCode);
console.log(result.durationMs);

// Run in background (returns immediately)
const bgResult = await sandbox.commands.run('npm install', {
  background: true
});
```

### Servers (`sandbox.servers`)

Manage long-running server processes:

```typescript
// Start a server
const server = await sandbox.servers.start({
  name: 'api',
  command: 'npm start',
  path: '/app',
  env_file: '.env'
});

// List all servers
const servers = await sandbox.servers.list();

// Get server info
const info = await sandbox.servers.retrieve('api');
console.log(info.status); // 'starting' | 'running' | 'ready' | 'failed' | 'stopped'
console.log(info.url);    // Server URL when ready

// Stop a server
await sandbox.servers.stop('api');

// Restart a server
await sandbox.servers.restart('api');
```

### Environment Variables (`sandbox.env`)

Manage `.env` files in the sandbox:

```typescript
// Get environment variables
const vars = await sandbox.env.retrieve('.env');
console.log(vars); // { API_KEY: 'secret', DEBUG: 'true' }

// Update environment variables (merges with existing)
await sandbox.env.update('.env', {
  API_KEY: 'new-secret',
  NEW_VAR: 'value'
});

// Remove environment variables
await sandbox.env.remove('.env', ['OLD_KEY', 'DEPRECATED']);

// Check if env file exists
const exists = await sandbox.env.exists('.env');
```

### Files (`sandbox.files`)

File operations via the resource namespace:

```typescript
// Read file
const content = await sandbox.files.read('/app/config.json');

// Write file
await sandbox.files.write('/app/config.json', '{"key": "value"}');

// List directory
const files = await sandbox.files.list('/app');

// Delete file
await sandbox.files.delete('/app/old-file.txt');
```

### Watchers (`sandbox.watchers`)

Real-time file system monitoring:

```typescript
// Create a file watcher
const watcher = await sandbox.watchers.create('/home/project', {
  ignored: ['node_modules', '.git'],
  includeContent: true
});

watcher.on('change', (event) => {
  console.log(`${event.event}: ${event.path}`);
  if (event.content) {
    console.log('New content:', event.content);
  }
});

// Destroy watcher
await sandbox.watchers.destroy(watcher.id);
```

### Signals (`sandbox.signals`)

Monitor system events:

```typescript
// Start signal monitoring
const signals = await sandbox.signals.start();

signals.on('port', (event) => {
  console.log(`Port ${event.port} ${event.type}: ${event.url}`);
});

signals.on('error', (event) => {
  console.error('Error:', event.message);
});

// Stop signal monitoring
await sandbox.signals.stop();
```

### Session Tokens (`sandbox.sessionTokens`)

Manage delegated access (requires access token):

```typescript
// Create a session token
const token = await sandbox.sessionTokens.create({
  description: 'My Application',
  expiresIn: 604800 // 7 days
});

// List session tokens
const tokens = await sandbox.sessionTokens.list();

// Revoke a token
await sandbox.sessionTokens.revoke(tokenId);
```

### Magic Links (`sandbox.magicLinks`)

Browser authentication (requires access token):

```typescript
// Create a magic link
const link = await sandbox.magicLinks.create({
  redirectUrl: '/dashboard'
});
console.log(link.magic_url);
```

## Direct Methods

The Sandbox class also provides direct methods for common operations:

### Command Execution

```typescript
// Run a shell command (supports string or array format)
const result = await sandbox.runCommand('npm install');
const result = await sandbox.runCommand(['npm', 'install', 'express']);

// With options
const result = await sandbox.runCommand('npm start', {
  cwd: '/app',
  background: true
});

// Execute in a specific terminal (low-level)
const response = await sandbox.execute({
  command: 'ls -la',
  shell: '/bin/bash'
});
```

### Code Execution

```typescript
// Run code with a specific runtime
const result = await sandbox.runCode('console.log("Hello!")', 'node');
const result = await sandbox.runCode('print("Hello!")', 'python');
```

### File Operations

```typescript
// Filesystem interface (ComputeSDK standard)
await sandbox.filesystem.writeFile('/tmp/hello.txt', 'Hello!');
const content = await sandbox.filesystem.readFile('/tmp/hello.txt');
await sandbox.filesystem.mkdir('/tmp/mydir');
const files = await sandbox.filesystem.readdir('/tmp');
const exists = await sandbox.filesystem.exists('/tmp/hello.txt');
await sandbox.filesystem.remove('/tmp/hello.txt');

// Direct methods
await sandbox.writeFile('/tmp/hello.txt', 'Hello!');
const content = await sandbox.readFile('/tmp/hello.txt');
const files = await sandbox.listFiles('/tmp');
await sandbox.deleteFile('/tmp/hello.txt');
```

## Terminal Modes

The client supports two terminal modes:

### PTY Mode (Interactive)

PTY terminals provide a full interactive shell with WebSocket streaming:

```typescript
const terminal = await sandbox.terminals.create({
  pty: true,
  shell: '/bin/bash',
  encoding: 'raw' // or 'base64' for binary-safe
});

// Real-time output via WebSocket
terminal.on('output', (data) => process.stdout.write(data));
terminal.on('destroyed', () => console.log('Terminal closed'));

// Write to terminal
terminal.write('ls -la\n');
terminal.write('cd /app && npm start\n');

// Clean up
await terminal.destroy();
```

### Exec Mode (Command Tracking)

Exec terminals track individual commands with status and output:

```typescript
const terminal = await sandbox.terminals.create({ pty: false });

// Run a command and get structured result
const result = await terminal.execute('npm test');
console.log(result.data.cmd_id);
console.log(result.data.status);  // 'running' | 'completed' | 'failed'
console.log(result.data.stdout);
console.log(result.data.stderr);
console.log(result.data.exit_code);

// Run in background
const bgResult = await terminal.execute('npm install', { background: true });
console.log(bgResult.data.cmd_id); // Track this command

// Check command status later
const cmdStatus = await sandbox.getCommand(terminal.getId(), bgResult.data.cmd_id);

// Wait for command to complete
const finalResult = await sandbox.waitForCommand(
  terminal.getId(),
  bgResult.data.cmd_id,
  { timeout: 60000 }
);

// List all commands in a terminal
const commands = await sandbox.listCommands(terminal.getId());

await terminal.destroy();
```

## Authentication

### Access Tokens

Access tokens have full permissions and can create session tokens:

```typescript
const sandbox = new Sandbox({
  sandboxId: 'sandbox-123',
  provider: 'gateway',
  sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com',
  token: accessToken // From your edge service
});

// Create delegated session token
const sessionToken = await sandbox.sessionTokens.create({
  description: 'My Application',
  expiresIn: 604800
});
```

### Session Tokens

Session tokens are delegated credentials with limited permissions:

```typescript
const sandbox = new Sandbox({
  sandboxId: 'sandbox-123',
  provider: 'gateway',
  sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com',
  token: sessionToken.token
});

// Regular operations work
const result = await sandbox.runCommand('ls');

// Cannot create session tokens (will throw)
// await sandbox.sessionTokens.create(...) // Error!
```

## Configuration Options

```typescript
interface SandboxConfig {
  // Sandbox ID (required)
  sandboxId: string;

  // Provider name, e.g., 'gateway', 'e2b' (required)
  provider: string;

  // API endpoint URL
  sandboxUrl?: string;

  // Access or session token
  token?: string;

  // Custom headers for all requests
  headers?: Record<string, string>;

  // Request timeout in milliseconds (default: 30000)
  timeout?: number;

  // WebSocket implementation (required for Node.js < 21)
  WebSocket?: WebSocketConstructor;

  // WebSocket protocol: 'binary' (default) or 'json'
  protocol?: 'json' | 'binary';

  // Optional metadata
  metadata?: Record<string, unknown>;
}
```

## WebSocket Protocol

### Binary Protocol (Default)

50-90% size reduction compared to JSON:

```typescript
const sandbox = new Sandbox({
  // ...
  protocol: 'binary' // Default
});
```

### JSON Protocol (Debugging)

Use for browser DevTools inspection:

```typescript
const sandbox = new Sandbox({
  // ...
  protocol: 'json'
});
```

## Error Handling

```typescript
try {
  const result = await sandbox.runCommand('invalid-command');
} catch (error) {
  console.error('Command failed:', error.message);
}

// Terminal errors
terminal.on('error', (error) => {
  console.error('Terminal error:', error);
});

// Signal errors
signals.on('error', (event) => {
  console.error('Signal error:', event.message);
});
```

## Cleanup

```typescript
// Disconnect WebSocket
await sandbox.disconnect();

// Destroy terminals
await terminal.destroy();

// Destroy watchers
await watcher.destroy();

// Stop signals
await signals.stop();
```

## TypeScript Types

```typescript
import type {
  Sandbox,
  SandboxConfig,
  Terminal,
  FileWatcher,
  SignalService,
  FileInfo,
  ServerInfo,
  ServerStatus,
  TerminalResponse,
  CommandExecutionResponse,
  CommandDetailsResponse,
  CommandResult,
  WatcherResponse,
  FileChangeEvent,
  PortSignalEvent,
  ErrorSignalEvent,
  SignalEvent
} from '@computesdk/client';
```

## Backward Compatibility

The `ComputeClient` name is still exported as an alias:

```typescript
// Both work
import { Sandbox } from '@computesdk/client';
import { ComputeClient } from '@computesdk/client';

// ComputeClient is an alias for Sandbox
const sandbox = new ComputeClient({ ... }); // Works
```

## License

MIT

## Contributing

Contributions are welcome! Please check out the [contributing guide](../../CONTRIBUTING.md).

## Resources

- [ComputeSDK Documentation](https://computesdk.com)
- [GitHub Repository](https://github.com/computesdk/computesdk)
- [Examples](../../examples)
