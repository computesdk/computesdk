# ComputeSDK Client

ComputeSDK comes with a universal adapter that works in browser, Node.js, and edge runtimes. Provides direct API access for use when you want direct interaction with the sandbox from the browser or server.

## Installation

```bash
npm install @computesdk/client

# For Node.js, also install ws
npm install ws
```

## Quick Start

### Browser

```typescript
import { ComputeClient } from '@computesdk/client';

const client = new ComputeClient({
  sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com'
});

await client.generateToken();
const result = await client.execute({ command: 'ls -la' });
```

### Node.js

```typescript
import { ComputeClient } from '@computesdk/client';
import WebSocket from 'ws';

const client = new ComputeClient({
  sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com',
  WebSocket // Required for Node.js
});

await client.generateToken();
const result = await client.execute({ command: 'ls -la' });
```

## Configuration

```typescript
interface ComputeClientConfig {
  sandboxUrl: string;                    // Sandbox endpoint URL
  token?: string;                    // Optional JWT token
  headers?: Record<string, string>;  // Additional headers
  timeout?: number;                  // Request timeout (default: 30000ms)
  WebSocket?: WebSocketConstructor;  // WebSocket implementation (Node.js)
}
```

## Core API

### Health Check

```typescript
// Check service health
const health = await client.health();
console.log(health.status); // "ok"
```

### Authentication

```typescript
// Generate token (first-come-first-served)
const tokenResponse = await client.generateToken();

// Check token status
const status = await client.getTokenStatus();

// Get authentication information
const authInfo = await client.getAuthInfo();

// Set token manually
client.setToken('your-jwt-token');

// Get current token
const currentToken = client.getToken();
```

### Command Execution

```typescript
// Execute one-off command
const result = await client.execute({ 
  command: 'echo "Hello World"',
  shell: '/bin/bash' // optional
});

console.log(result.data.stdout); // "Hello World"
console.log(result.data.exit_code); // 0
```

### File Operations

```typescript
// List files
const files = await client.listFiles('/home/project');

// Create file
await client.createFile('/path/to/file.txt', 'Initial content');

// Get file metadata
const fileInfo = await client.getFile('/path/to/file.txt');

// Read file
const content = await client.readFile('/path/to/file.txt');

// Write file
await client.writeFile('/path/to/file.txt', 'Hello, World!');

// Delete file
await client.deleteFile('/path/to/file.txt');
```

### Terminal Sessions

```typescript
// Create persistent terminal
const terminal = await client.createTerminal();

// List all terminals
const terminals = await client.listTerminals();

// Get specific terminal
const terminalInfo = await client.getTerminal(terminal.getId());

// Listen for output
terminal.on('output', (data) => console.log(data));

// Send input
terminal.write('ls -la\n');

// Execute command and wait for result
const result = await terminal.execute('echo "test"');

// Cleanup
await terminal.destroy();
```

### File Watching

```typescript
// Create file watcher
const watcher = await client.createWatcher('/home/project', {
  ignored: ['node_modules', '.git'],
  includeContent: false
});

// List all watchers
const watchers = await client.listWatchers();

// Get specific watcher
const watcherInfo = await client.getWatcher(watcher.getId());

// Listen for changes
watcher.on('change', (event) => {
  console.log(`${event.event}: ${event.path}`);
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
  console.log(`Port ${event.port}: ${event.url}`);
});

// Emit signals manually
await client.emitPortSignal(3000, 'open', 'http://localhost:3000');
await client.emitErrorSignal('Something went wrong');
await client.emitServerReadySignal(3000, 'http://localhost:3000');

// Stop service
await signals.stop();
```

### Sandbox Management

```typescript
// Create a new sandbox
const sandbox = await client.createSandbox();

// List all sandboxes
const sandboxes = await client.listSandboxes();

// Get specific sandbox
const sandboxInfo = await client.getSandbox('sandbox-123');

// Delete sandbox
await client.deleteSandbox('sandbox-123', true); // deleteFiles = true
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
```

## Additional API Methods

### Helper Functions

```typescript
// Create client instance (alternative to constructor)
import { createClient } from '@computesdk/client';
const client = createClient({ sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com' });

// Backwards compatibility aliases
import { createClient, ComputeClient } from '@computesdk/client';
const client = createClient({ sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com' });

// Alternative port signal emission (using path parameters)
await client.emitPortSignalAlt(3000, 'open');
```

### Type Exports

The package exports comprehensive TypeScript types for all API responses:

```typescript
import type {
  ComputeClientConfig,
  HealthResponse,
  TokenResponse,
  TokenStatusResponse,
  AuthInfoResponse,
  FileInfo,
  FilesListResponse,
  FileResponse,
  CommandExecutionResponse,
  TerminalResponse,
  FileChangeEvent,
  WatcherResponse,
  SignalEvent,
  PortSignalEvent,
  ErrorSignalEvent,
  SandboxInfo,
  SandboxesListResponse
} from '@computesdk/client';
```

## Error Handling

The client throws errors for:
- Network failures
- Authentication issues
- Invalid requests
- File not found
- Permission denied

Always wrap calls in try-catch blocks for production use.
