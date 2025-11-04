# ComputeSDK Adapter

ComputeSDK comes with a universal adapter that works in browser, Node.js, and edge runtimes. Provides direct API access for use when you want direct interaction with the sandbox from the browser or server.

## Installation

```bash
npm install @computesdk/adapter

# For Node.js, also install ws
npm install ws
```

## Quick Start

### Browser

```typescript
import { ComputeAdapter } from '@computesdk/adapter';

const adapter = new ComputeAdapter({
  sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com'
});

await adapter.generateToken();
const result = await adapter.execute({ command: 'ls -la' });
```

### Node.js

```typescript
import { ComputeAdapter } from '@computesdk/adapter';
import WebSocket from 'ws';

const adapter = new ComputeAdapter({
  sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com',
  WebSocket // Required for Node.js
});

await adapter.generateToken();
const result = await adapter.execute({ command: 'ls -la' });
```

## Configuration

```typescript
interface ComputeAdapterConfig {
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
const health = await adapter.health();
console.log(health.status); // "ok"
```

### Authentication

```typescript
// Generate token (first-come-first-served)
const tokenResponse = await adapter.generateToken();

// Check token status
const status = await adapter.getTokenStatus();

// Get authentication information
const authInfo = await adapter.getAuthInfo();

// Set token manually
adapter.setToken('your-jwt-token');

// Get current token
const currentToken = adapter.getToken();
```

### Command Execution

```typescript
// Execute one-off command
const result = await adapter.execute({ 
  command: 'echo "Hello World"',
  shell: '/bin/bash' // optional
});

console.log(result.data.stdout); // "Hello World"
console.log(result.data.exit_code); // 0
```

### File Operations

```typescript
// List files
const files = await adapter.listFiles('/home/project');

// Create file
await adapter.createFile('/path/to/file.txt', 'Initial content');

// Get file metadata
const fileInfo = await adapter.getFile('/path/to/file.txt');

// Read file
const content = await adapter.readFile('/path/to/file.txt');

// Write file
await adapter.writeFile('/path/to/file.txt', 'Hello, World!');

// Delete file
await adapter.deleteFile('/path/to/file.txt');
```

### Terminal Sessions

```typescript
// Create persistent terminal
const terminal = await adapter.createTerminal();

// List all terminals
const terminals = await adapter.listTerminals();

// Get specific terminal
const terminalInfo = await adapter.getTerminal(terminal.getId());

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
const watcher = await adapter.createWatcher('/home/project', {
  ignored: ['node_modules', '.git'],
  includeContent: false
});

// List all watchers
const watchers = await adapter.listWatchers();

// Get specific watcher
const watcherInfo = await adapter.getWatcher(watcher.getId());

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
const signals = await adapter.startSignals();

// Get signal service status
const status = await adapter.getSignalStatus();

// Listen for port events
signals.on('port', (event) => {
  console.log(`Port ${event.port}: ${event.url}`);
});

// Emit signals manually
await adapter.emitPortSignal(3000, 'open', 'http://localhost:3000');
await adapter.emitErrorSignal('Something went wrong');
await adapter.emitServerReadySignal(3000, 'http://localhost:3000');

// Stop service
await signals.stop();
```

### Sandbox Management

```typescript
// Create a new sandbox
const sandbox = await adapter.createSandbox();

// List all sandboxes
const sandboxes = await adapter.listSandboxes();

// Get specific sandbox
const sandboxInfo = await adapter.getSandbox('sandbox-123');

// Delete sandbox
await adapter.deleteSandbox('sandbox-123', true); // deleteFiles = true
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
await adapter.disconnect();
```

## Additional API Methods

### Helper Functions

```typescript
// Create adapter instance (alternative to constructor)
import { createAdapter } from '@computesdk/adapter';
const adapter = createAdapter({ sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com' });

// Backwards compatibility aliases
import { createClient, ComputeClient } from '@computesdk/adapter';
const client = createClient({ sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com' });

// Alternative port signal emission (using path parameters)
await adapter.emitPortSignalAlt(3000, 'open');
```

### Type Exports

The package exports comprehensive TypeScript types for all API responses:

```typescript
import type {
  ComputeAdapterConfig,
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
} from '@computesdk/adapter';
```

## Error Handling

The adapter throws errors for:
- Network failures
- Authentication issues
- Invalid requests
- File not found
- Permission denied

Always wrap calls in try-catch blocks for production use.
