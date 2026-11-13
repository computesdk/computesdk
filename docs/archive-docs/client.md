# ComputeSDK Client

ComputeSDK comes with a universal adapter that works in browser, Node.js, and edge runtimes. Provides direct API access for use when you want direct interaction with the sandbox from the browser or server.

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

### Browser

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
```

### Node.js

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

## Configuration

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

## Core API

### Health Check

```typescript
// Check service health
const health = await client.health();
console.log(health.status);
console.log(health.timestamp);
```

### Authentication

```typescript
// Create session token (requires access token)
const sessionToken = await client.createSessionToken({
  description: 'My Application',
  expiresIn: 604800 // 7 days in seconds
});

// List session tokens (requires access token)
const tokens = await client.listSessionTokens();

// Get specific session token (requires access token)
const tokenDetails = await client.getSessionToken(tokenId);

// Revoke session token (requires access token)
await client.revokeSessionToken(tokenId);

// Create magic link for browser authentication (requires access token)
const magicLink = await client.createMagicLink({
  redirectUrl: '/dashboard'
});
console.log('Magic link URL:', magicLink.data.magic_url);
console.log('Expires at:', magicLink.data.expires_at);

// Check authentication status
const status = await client.getAuthStatus();
console.log('Authenticated:', status.data.authenticated);
console.log('Token type:', status.data.token_type);

// Get authentication information
const authInfo = await client.getAuthInfo();

// Set token manually
client.setToken('your-access-or-session-token');

// Get current token
const currentToken = client.getToken();
```

### Command Execution

```typescript
// Execute one-off command
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

// Create file
await client.createFile('/path/to/file.txt', 'Initial content');

// Get file metadata
const fileInfo = await client.getFile('/path/to/file.txt');
console.log('Size:', fileInfo.data.file.size);
console.log('Modified:', fileInfo.data.file.modified_at);

// Read file
const content = await client.readFile('/path/to/file.txt');

// Write file
await client.writeFile('/path/to/file.txt', 'Hello, World!');

// Delete file
await client.deleteFile('/path/to/file.txt');

// Filesystem interface (convenient methods)
const content = await client.filesystem.readFile('/home/project/test.txt');
await client.filesystem.writeFile('/home/project/test.txt', 'Hello!');
await client.filesystem.mkdir('/home/project/data');

const files = await client.filesystem.readdir('/home/project');
for (const file of files) {
  console.log(file.name, file.isDirectory ? '(dir)' : '(file)');
}

const exists = await client.filesystem.exists('/home/project/test.txt');
await client.filesystem.remove('/home/project/old.txt');
```

### Terminal Sessions

```typescript
// Create persistent terminal
const terminal = await client.createTerminal('/bin/bash');

// List all terminals
const terminals = await client.listTerminals();

// Get specific terminal
const terminalInfo = await client.getTerminal(terminal.getId());

// Listen for output
terminal.on('output', (data) => {
  console.log('Terminal output:', data);
});

// Listen for terminal destruction
terminal.on('destroyed', () => {
  console.log('Terminal destroyed');
});

// Listen for errors
terminal.on('error', (error) => {
  console.error('Terminal error:', error);
});

// Write to terminal
terminal.write('ls -la\n');
terminal.write('echo "Hello"\n');

// Execute command and wait for result
const result = await terminal.execute('npm --version');
console.log('npm version:', result.data.stdout);

// Cleanup
await terminal.destroy();
```

### File Watching

```typescript
// Create file watcher
const watcher = await client.createWatcher('/home/project', {
  ignored: ['node_modules', '.git', 'dist'],
  includeContent: true // Include file content in events
});

// List all watchers
const watchers = await client.listWatchers();

// Get specific watcher
const watcherInfo = await client.getWatcher(watcher.getId());

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

```typescript
// Start signal service for port monitoring
const signals = await client.startSignals();

// Get signal service status
const status = await client.getSignalStatus();

// Listen for port events
signals.on('port', (event) => {
  console.log(`Port ${event.port} ${event.type || 'detected'}: ${event.url}`);
});

// Listen for error signals
signals.on('error', (event) => {
  console.error('Error signal:', event.message);
});

// Listen for all signals
signals.on('signal', (event) => {
  console.log('Signal:', event);
});

// Emit signals manually
await client.emitPortSignal(3000, 'open', 'http://localhost:3000');
await client.emitServerReadySignal(3000, 'http://localhost:3000');
await client.emitErrorSignal('Something went wrong');

// Alternative port signal emission (using path parameters)
await client.emitPortSignalAlt(3000, 'open');

// Stop service
await signals.stop();
```

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

## Event Handling

### Terminal Events
- `output` - Terminal output data
- `error` - Terminal errors  
- `destroyed` - Terminal destroyed

### File Watcher Events
- `change` - File change events (add, change, unlink, addDir, unlinkDir)
- `destroyed` - Watcher destroyed

### Signal Service Events
- `port` - Port opened/closed events
- `error` - Error signals
- `signal` - Generic signal events

## Cleanup

```typescript
// Disconnect WebSocket connections
await client.disconnect();

// Destroy terminals
await terminal.destroy();

// Destroy watchers
await watcher.destroy();

// Stop signals
await signals.stop();
```

## Additional API Methods

### Helper Functions

```typescript
// Create client instance (alternative to constructor)
import { createClient } from '@computesdk/client';
const client = createClient({ 
  sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com',
  token: 'your-session-token'
});
```

### Type Exports

The package exports comprehensive TypeScript types for all API responses:

```typescript
import type {
  ComputeClientConfig,
  WebSocketConstructor,
  HealthResponse,
  InfoResponse,
  SessionTokenResponse,
  SessionTokenListResponse,
  MagicLinkResponse,
  AuthStatusResponse,
  AuthInfoResponse,
  FileInfo,
  FilesListResponse,
  FileResponse,
  CommandExecutionResponse,
  TerminalResponse,
  WatcherResponse,
  WatchersListResponse,
  SignalServiceResponse,
  PortSignalResponse,
  GenericSignalResponse,
  FileChangeEvent,
  PortSignalEvent,
  ErrorSignalEvent,
  SignalEvent,
  SandboxInfo,
  SandboxesListResponse
} from '@computesdk/client';
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

// Handle signal errors
signals.on('error', (event) => {
  console.error('Signal error:', event.message);
});
```

The client throws errors for:
- Network failures
- Authentication issues (403 Forbidden when access token required)
- Invalid requests
- File not found
- Permission denied
- Request timeouts

Always wrap calls in try-catch blocks for production use.
