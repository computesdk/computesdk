# @computesdk/adapter

Universal adapter for ComputeSDK - works in browser, Node.js, and edge runtimes.

**Now includes WebContainer API polyfill!** Run the WebContainer API on remote sandboxes instead of in-browser. Perfect drop-in replacement for `@webcontainer/api`. [Learn more →](./WEBCONTAINER_POLYFILL.md)

## Installation

```bash
npm install @computesdk/adapter

# For Node.js, also install ws
npm install ws
```

## Usage

### Browser

Works out of the box with native WebSocket:

```typescript
import { ComputeAdapter } from '@computesdk/adapter';

const adapter = new ComputeAdapter({
  apiUrl: 'https://sandbox-123.preview.computesdk.com'
});

await adapter.generateToken();
const result = await adapter.execute({ command: 'ls -la' });
```

### Node.js

Pass WebSocket implementation:

```typescript
import { ComputeAdapter } from '@computesdk/adapter';
import WebSocket from 'ws';

const adapter = new ComputeAdapter({
  apiUrl: 'https://sandbox-123.preview.computesdk.com',
  WebSocket // Pass ws implementation
});

await adapter.generateToken();
const result = await adapter.execute({ command: 'ls -la' });
```

### Features

- **REST API**: Files, terminals, watchers, signals, sandboxes
- **WebSocket**: Real-time terminal output, file watching, system signals
- **High-level API**: Terminal, FileWatcher, SignalService classes
- **Universal**: Browser, Node.js, Deno, Bun, Cloudflare Workers, etc.
- **WebContainer Polyfill**: Drop-in replacement for `@webcontainer/api` ✨

## WebContainer API Polyfill

Run the WebContainer API on remote sandboxes! Works everywhere, not just in browsers. **Sandboxes are automatically created and cleaned up for you.**

```typescript
import { WebContainer } from '@computesdk/adapter/webcontainer';

// Same API as @webcontainer/api - sandbox created automatically!
const wc = await WebContainer.boot({
  apiUrl: 'https://api.computesdk.co'
});

await wc.fs.writeFile('/hello.js', 'console.log("Hello!")');
const process = await wc.spawn('node', ['hello.js']);

// Listen for output
const reader = process.output.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log(value);
}

// Automatically cleans up the sandbox
await wc.teardown();
```

**Why use this over native WebContainers?**
- ✅ Works **anywhere** - Browser, Node.js, edge runtimes
- ✅ **No COEP headers** required
- ✅ **Multiple sandboxes** - Not limited to one
- ✅ **Any language** - Python, Node.js, etc.
- ✅ **More powerful** - Full Linux environment

**[Read the full WebContainer polyfill docs →](./WEBCONTAINER_POLYFILL.md)**

## API

See TypeScript types for full API documentation.

```typescript
// Execute commands
const result = await adapter.execute({ command: 'echo "Hello"' });

// Work with files
await adapter.writeFile('/path/to/file.txt', 'content');
const content = await adapter.readFile('/path/to/file.txt');

// Interactive terminal
const terminal = await adapter.createTerminal();
terminal.on('output', (data) => console.log(data));
terminal.write('ls -la\n');
await terminal.destroy();

// Watch files
const watcher = await adapter.createWatcher('/path', {
  ignored: ['node_modules', '.git']
});
watcher.on('change', (event) => {
  console.log(`${event.event}: ${event.path}`);
});
await watcher.destroy();

// Monitor signals
const signals = await adapter.startSignals();
signals.on('port', (event) => {
  console.log(`Port ${event.port}: ${event.url}`);
});
await signals.stop();
```

## License

MIT
