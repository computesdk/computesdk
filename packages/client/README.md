# @computesdk/client

Universal client for ComputeSDK - connect to sandboxes from browser, Node.js, and edge runtimes.

## Features

- 🌐 **Universal** - Works in browser, Node.js, Deno, Bun, Cloudflare Workers, and edge runtimes
- 🔌 **WebSocket Support** - Real-time terminals, file watchers, and signal monitoring
- 📁 **File Operations** - Read, write, and manage files in remote sandboxes
- ⚡ **Command Execution** - Run commands and get execution results
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

In the browser, the client auto-detects configuration from URL parameters or localStorage:

```typescript
import { ComputeClient } from '@computesdk/client';

// Auto-detects sandboxUrl and token from:
// 1. URL params: ?sandbox_url=...&session_token=...
// 2. localStorage: sandbox_url, session_token
const client = new ComputeClient();

// Or provide configuration explicitly
const client = new ComputeClient({
  sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com',
  token: 'your-session-token'
});

// Execute commands
const result = await client.execute({ command: 'ls -la' });
console.log(result.data.stdout);

// Work with files
await client.writeFile('/home/project/hello.txt', 'Hello World!');
const content = await client.readFile('/home/project/hello.txt');
console.log(content);
```

### Node.js Usage

**Node.js 21+** (native WebSocket):

```typescript
import { ComputeClient } from '@computesdk/client';

const client = new ComputeClient({
  sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com',
  token: 'your-session-token'
  // WebSocket is automatically available in Node 21+
});

const result = await client.execute({ command: 'node --version' });
console.log(result.data.stdout);
```

**Node.js < 21** (requires `ws` package):

```typescript
import { ComputeClient } from '@computesdk/client';
import WebSocket from 'ws';

const client = new ComputeClient({
  sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com',
  token: 'your-session-token',
  WebSocket // Required for Node.js < 21
});

const result = await client.execute({ command: 'node --version' });
console.log(result.data.stdout);
```

## Authentication

The client supports two types of tokens:

### Access Tokens

Access tokens have full administrative permissions and are the **only tokens that can create session tokens**. They're typically obtained from your edge service or ComputeSDK provider.

```typescript
// Initialize client with access token
const adminClient = new ComputeClient({
  sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com',
  token: accessToken // REQUIRED: Must be an access token (not a session token)
});

// Create a session token for delegated access (requires access token)
const sessionToken = await adminClient.createSessionToken({
  description: 'My Application',
  expiresIn: 604800 // 7 days in seconds
});

console.log('Session token:', sessionToken.token);
```

**Important:** Only access tokens can create session tokens. Attempting to call `createSessionToken()` with a session token will throw a clear error:
```
Error: Access token required. This operation requires an access token, not a session token.
```

### Session Tokens

Session tokens are delegated credentials with limited permissions. They cannot create other session tokens.

```typescript
const client = new ComputeClient({
  sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com',
  token: sessionToken.token
});

// Use for regular operations
const result = await client.execute({ command: 'ls' });
```

### Magic Links

Magic links provide easy browser authentication:

```typescript
// Create magic link (requires access token)
const magicLink = await client.createMagicLink({
  redirectUrl: '/dashboard'
});

console.log('Magic URL:', magicLink.data.magic_url);
// Send this URL to users - they'll be automatically authenticated
```

## Core Operations

### Command Execution

Execute one-off commands without creating a persistent terminal:

```typescript
const result = await client.execute({
  command: 'npm install',
  shell: '/bin/bash' // optional
});

console.log('Exit code:', result.data.exit_code);
console.log('Output:', result.data.stdout);
console.log('Errors:', result.data.stderr);
console.log('Duration:', result.data.duration_ms, 'ms');
```

### File Operations

```typescript
// List files
const files = await client.listFiles('/home/project');
console.log(files.data.files);

// Read file
const content = await client.readFile('/home/project/package.json');
console.log(content);

// Write file
await client.writeFile('/home/project/hello.js', 'console.log("Hello!");');

// Create file
await client.createFile('/home/project/new.txt', 'Initial content');

// Delete file
await client.deleteFile('/home/project/old.txt');

// Get file metadata
const fileInfo = await client.getFile('/home/project/package.json');
console.log('Size:', fileInfo.data.file.size);
console.log('Modified:', fileInfo.data.file.modified_at);
```

### Filesystem Interface

The client provides a convenient filesystem interface:

```typescript
// Read file
const content = await client.filesystem.readFile('/home/project/test.txt');

// Write file
await client.filesystem.writeFile('/home/project/test.txt', 'Hello!');

// Create directory
await client.filesystem.mkdir('/home/project/data');

// List directory
const files = await client.filesystem.readdir('/home/project');
for (const file of files) {
  console.log(file.name, file.isDirectory ? '(dir)' : '(file)');
}

// Check existence
const exists = await client.filesystem.exists('/home/project/test.txt');

// Remove file or directory
await client.filesystem.remove('/home/project/old.txt');
```

## Real-Time Features

### Terminals

Create interactive terminal sessions with real-time I/O:

```typescript
// Node.js < 21: import WebSocket from 'ws';

const client = new ComputeClient({
  sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com',
  token: sessionToken,
  // WebSocket // Only needed for Node.js < 21
});

// Create terminal
const terminal = await client.createTerminal('/bin/bash');

// Listen for output
terminal.on('output', (data) => {
  console.log('Terminal output:', data);
});

// Listen for terminal destruction
terminal.on('destroyed', () => {
  console.log('Terminal destroyed');
});

// Write to terminal
terminal.write('ls -la\n');
terminal.write('echo "Hello"\n');

// Execute command and wait for result
const result = await terminal.execute('npm --version');
console.log('npm version:', result.data.stdout);

// Clean up
await terminal.destroy();
```

### File Watchers

Monitor file system changes in real-time:

```typescript
const watcher = await client.createWatcher('/home/project', {
  ignored: ['node_modules', '.git', 'dist'],
  includeContent: true // Include file content in events
});

// Listen for changes
watcher.on('change', (event) => {
  console.log(`${event.event}: ${event.path}`);
  if (event.content) {
    console.log('New content:', event.content);
  }
});

// Stop watching
await watcher.destroy();
```

### Signal Service

Monitor system events like port openings:

```typescript
const signals = await client.startSignals();

// Listen for port events
signals.on('port', (event) => {
  console.log(`Port ${event.port} ${event.type}: ${event.url}`);
});

// Listen for errors
signals.on('error', (event) => {
  console.error('Error signal:', event.message);
});

// Emit custom signals
await client.emitPortSignal(3000, 'open', 'http://localhost:3000');
await client.emitServerReadySignal(3000, 'http://localhost:3000');
await client.emitErrorSignal('Something went wrong');

// Stop signal service
await signals.stop();
```

## WebSocket Protocol

The client supports two WebSocket protocols:

### Binary Protocol (Default, Recommended)

The binary protocol provides 50-90% size reduction compared to JSON:

```typescript
const client = new ComputeClient({
  sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com',
  token: sessionToken,
  protocol: 'binary' // Default - explicit for clarity
});
```

### JSON Protocol (Debugging)

Use JSON protocol for easier debugging with browser DevTools:

```typescript
const client = new ComputeClient({
  sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com',
  token: sessionToken,
  protocol: 'json' // Human-readable in DevTools
});
```

## Advanced Usage

### Sandbox Management

```typescript
// Get server info
const info = await client.getServerInfo();
console.log('Server version:', info.data.version);
console.log('Sandbox count:', info.data.sandbox_count);

// Create new sandbox
const sandbox = await client.createSandbox();
console.log('Sandbox URL:', sandbox.url);

// List all sandboxes
const sandboxes = await client.listSandboxes();

// Get sandbox details
const details = await client.getSandbox('subdomain');

// Delete sandbox
await client.deleteSandbox('subdomain', true); // deleteFiles = true
```

### Health Checks

```typescript
const health = await client.health();
console.log('Status:', health.status);
console.log('Timestamp:', health.timestamp);
```

### Authentication Management

```typescript
// Check auth status
const status = await client.getAuthStatus();
console.log('Authenticated:', status.data.authenticated);
console.log('Token type:', status.data.token_type);

// Get auth info
const authInfo = await client.getAuthInfo();
console.log('Available endpoints:', authInfo.data.endpoints);

// List session tokens (requires access token)
const tokens = await client.listSessionTokens();
console.log('Active tokens:', tokens.data.tokens);

// Revoke session token (requires access token)
await client.revokeSessionToken(tokenId);

// Note: All session token operations require an access token
// Using a session token will throw: "Access token required"
```

## Configuration Options

```typescript
interface ComputeClientConfig {
  // Sandbox URL (auto-detected in browser from URL/localStorage)
  sandboxUrl?: string;

  // Sandbox ID (for Sandbox interface compatibility)
  sandboxId?: string;

  // Provider name (for Sandbox interface compatibility)
  provider?: string;

  // Access or session token (auto-detected in browser from URL/localStorage)
  token?: string;

  // Custom headers for all requests
  headers?: Record<string, string>;

  // Request timeout in milliseconds (default: 30000)
  timeout?: number;

  // WebSocket implementation (required for Node.js < 21)
  WebSocket?: WebSocketConstructor;

  // WebSocket protocol: 'binary' (default) or 'json'
  protocol?: 'json' | 'binary';
}
```

## Error Handling

```typescript
try {
  const result = await client.execute({ command: 'invalid-command' });
} catch (error) {
  console.error('Command failed:', error.message);
}

// Handle terminal errors
terminal.on('error', (error) => {
  console.error('Terminal error:', error);
});

// Watchers only emit 'change' and 'destroyed' events

// Handle signal errors
signals.on('error', (event) => {
  console.error('Signal error:', event.message);
});
```

## Cleanup

```typescript
// Disconnect WebSocket
await client.disconnect();

// Destroy terminals
await terminal.destroy();

// Destroy watchers
await watcher.destroy();

// Stop signals
await signals.stop();
```

## TypeScript Types

All types are fully documented and exported:

```typescript
import type {
  ComputeClient,
  ComputeClientConfig,
  Terminal,
  FileWatcher,
  SignalService,
  FileInfo,
  TerminalResponse,
  WatcherResponse,
  SignalServiceResponse,
  FileChangeEvent,
  PortSignalEvent,
  ErrorSignalEvent,
  SignalEvent
} from '@computesdk/client';
```

## Examples

### Full Example: Interactive Code Editor

```typescript
import { ComputeClient } from '@computesdk/client';

async function runCodeEditor() {
  // Initialize client
  const client = new ComputeClient({
    sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com',
    token: sessionToken
  });

  // Create project structure
  await client.filesystem.writeFile(
    '/home/project/index.js',
    'console.log("Hello World!");'
  );

  // Watch for file changes
  const watcher = await client.createWatcher('/home/project', {
    ignored: ['node_modules'],
    includeContent: true
  });

  watcher.on('change', async (event) => {
    console.log(`File ${event.event}: ${event.path}`);

    // Auto-run on save
    if (event.path.endsWith('.js') && event.event === 'change') {
      const result = await client.execute({
        command: `node ${event.path}`
      });
      console.log('Output:', result.data.stdout);
    }
  });

  // Monitor for server ports
  const signals = await client.startSignals();
  signals.on('port', (event) => {
    if (event.type === 'open') {
      console.log(`Server started on ${event.url}`);
    }
  });

  // Create interactive terminal
  const terminal = await client.createTerminal();
  terminal.on('output', (data) => {
    process.stdout.write(data);
  });

  // Run initial code
  await terminal.execute('node /home/project/index.js');

  // Cleanup on exit
  process.on('SIGINT', async () => {
    await watcher.destroy();
    await signals.stop();
    await terminal.destroy();
    await client.disconnect();
    process.exit(0);
  });
}
```

## License

MIT

## Contributing

Contributions are welcome! Please check out the [contributing guide](../../CONTRIBUTING.md).

## Resources

- [ComputeSDK Documentation](https://computesdk.com)
- [GitHub Repository](https://github.com/computesdk/computesdk)
- [Examples](../../examples)
