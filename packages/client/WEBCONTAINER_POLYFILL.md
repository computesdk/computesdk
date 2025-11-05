# WebContainer Polyfill

**Run the WebContainer API on remote sandboxes instead of in-browser.**

This polyfill provides a WebContainer-compatible API that's backed by ComputeSDK's remote sandbox infrastructure. Instead of running Node.js in the browser (which requires COEP headers and only works on Chromium), this works **anywhere** - browser, Node.js, edge runtimes - by proxying to your remote compute sandboxes.

## Why Use This?

### Problems with Native WebContainers:
- ❌ **Browser-only** - Can't run on server or edge
- ❌ **Requires COEP headers** - Hosting restrictions
- ❌ **Chromium-only** without origin trial
- ❌ **Single instance limit** - Only one WebContainer at a time
- ❌ **No Python** - JavaScript/Node.js only

### Benefits of the Polyfill:
- ✅ **Works everywhere** - Browser, Node.js, Deno, Cloudflare Workers
- ✅ **No COEP headers** needed
- ✅ **Multiple sandboxes** - Run many in parallel
- ✅ **Any language** - Python, Node.js, etc. (whatever your backend supports)
- ✅ **More powerful** - Full Linux environment, not limited to browser
- ✅ **Drop-in replacement** - Same API as `@webcontainer/api`

## Installation

```bash
npm install @computesdk/client
```

## Usage

### Basic Example (Auto-Create Sandbox)

```typescript
import { WebContainer } from '@computesdk/client/webcontainer';

// Automatically creates a new sandbox for you!
const wc = await WebContainer.boot({
  sandboxUrl: 'https://sandbox-abc123.preview.computesdk.com'
});

// Use the same API as WebContainer
await wc.fs.writeFile('/hello.js', 'console.log("Hello World!")');
const process = await wc.spawn('node', ['hello.js']);

// Listen for output
const reader = process.output.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log(value);
}

// Automatically deletes the sandbox on teardown
await wc.teardown();
```

### Using an Existing Sandbox

```typescript
// If you want to use an existing sandbox instead
const wc = await WebContainer.boot({
  apiUrl: 'https://sandbox-abc123.preview.computesdk.co',
  createSandbox: false
});
```

### Mounting a File Tree

```typescript
const wc = await WebContainer.boot({
  sandboxUrl: 'https://sandbox-abc123.preview.computesdk.com'
});

// Mount files using WebContainer's FileSystemTree format
await wc.mount({
  'package.json': {
    file: {
      contents: JSON.stringify({
        name: 'my-app',
        dependencies: {
          'express': '^4.18.0'
        }
      })
    }
  },
  'src': {
    directory: {
      'index.js': {
        file: {
          contents: `
            const express = require('express');
            const app = express();

            app.get('/', (req, res) => {
              res.send('Hello from WebContainer polyfill!');
            });

            app.listen(3000, () => {
              console.log('Server running on port 3000');
            });
          `
        }
      }
    }
  }
});

// Install dependencies
const install = await wc.spawn('npm', ['install']);
await install.exit;

// Start the server
const server = await wc.spawn('node', ['src/index.js']);

// Listen for port events
wc.on('server-ready', (port, url) => {
  console.log(`Server ready at ${url}`);
});
```

### Migrating from @webcontainer/api

**Before (native WebContainer):**
```typescript
import { WebContainer } from '@webcontainer/api';

const wc = await WebContainer.boot();
// ... rest of your code
await wc.teardown();
```

**After (polyfill):**
```typescript
import { WebContainer } from '@computesdk/client/webcontainer';

const wc = await WebContainer.boot({
  sandboxUrl: 'https://your-sandbox.preview.computesdk.com'
});
// ... rest of your code stays the same!
await wc.teardown(); // Automatically cleans up the sandbox
```

That's it! The API is identical, and sandboxes are managed automatically for you.

## API Reference

### `WebContainer.boot(options)`

Boot a WebContainer instance. By default, automatically creates a new sandbox.

**Options:**
- `sandboxUrl` (required): Your ComputeSDK sandbox URL
- `token` (optional): JWT token for authentication
- `headers` (optional): Additional headers for requests
- `timeout` (optional): Request timeout in milliseconds
- `WebSocket` (optional): WebSocket implementation (for Node.js)

**Returns:** `Promise<WebContainer>`

**Examples:**
```typescript
// Auto-create sandbox (default)
const wc = await WebContainer.boot({
  apiUrl: 'https://api.computesdk.co'
});

// Use existing sandbox
const wc = await WebContainer.boot({
  apiUrl: 'https://sandbox-123.preview.computesdk.co',
  createSandbox: false
});

// Create sandbox but keep it after teardown
const wc = await WebContainer.boot({
  apiUrl: 'https://api.computesdk.co',
  deleteSandboxOnTeardown: false
});
```

### `webContainer.fs`

File system API - matches `fs.promises` from Node.js.

**Methods:**
- `readFile(path, encoding?)` - Read file contents
- `writeFile(path, data)` - Write file contents
- `mkdir(path, options?)` - Create directory
- `readdir(path, options?)` - List directory contents
- `rm(path, options?)` - Remove file or directory
- `rename(oldPath, newPath)` - Rename/move file
- `watch(path, options, listener)` - Watch for changes

### `webContainer.spawn(command, args?, options?)`

Spawn a process.

**Parameters:**
- `command` (string): Command to execute
- `args` (string[], optional): Command arguments
- `options` (object, optional):
  - `cwd` (string): Working directory
  - `env` (object): Environment variables
  - `terminal` (object): Terminal size (`{ cols, rows }`)

**Returns:** `Promise<WebContainerProcess>`

### `webContainer.mount(tree, options?)`

Mount a file system tree.

**Parameters:**
- `tree` (FileSystemTree): Tree structure to mount
- `options` (object, optional):
  - `mountPoint` (string): Where to mount (default: `/home/project`)

### `webContainer.on(event, listener)`

Listen for events.

**Events:**
- `port` - Port opened/closed: `(port, type, url) => void`
- `server-ready` - Server started: `(port, url) => void`
- `error` - Error occurred: `(error) => void`

**Returns:** Function to unsubscribe

### `webContainer.teardown()`

Destroy the WebContainer instance.

## Use Cases

### 1. Server-Side Code Execution

Run user code safely on your server instead of in the browser:

```typescript
// In your API route (Next.js, Express, etc.)
export async function POST(req: Request) {
  const { code } = await req.json();

  const wc = await WebContainer.boot({
    sandboxUrl: process.env.SANDBOX_URL!
  });

  await wc.fs.writeFile('/code.js', code);
  const process = await wc.spawn('node', ['code.js']);

  // Stream output back to client
  return new Response(process.output);
}
```

### 2. Edge Runtime Code Execution

Works in Cloudflare Workers, Vercel Edge, etc.:

```typescript
export default {
  async fetch(request: Request) {
    const wc = await WebContainer.boot({
      sandboxUrl: 'https://sandbox.example.com'
    });

    // Execute code in edge runtime
    const process = await wc.spawn('node', ['-e', 'console.log("Hello from edge!")']);
    const output = await process.output.getReader().read();

    return new Response(output.value);
  }
}
```

### 3. Multi-Sandbox Orchestration

Unlike native WebContainers, run multiple sandboxes:

```typescript
const sandbox1 = await WebContainer.boot({ sandboxUrl: 'https://sandbox-1.example.com' });
const sandbox2 = await WebContainer.boot({ sandboxUrl: 'https://sandbox-2.example.com' });

// Run different code in parallel
const [result1, result2] = await Promise.all([
  sandbox1.spawn('node', ['task1.js']).then(p => p.exit),
  sandbox2.spawn('python3', ['task2.py']).then(p => p.exit)
]);
```

### 4. Python Support

Run Python code (not possible with native WebContainers):

```typescript
const wc = await WebContainer.boot({
  sandboxUrl: 'https://sandbox.example.com'
});

await wc.fs.writeFile('/analysis.py', `
import pandas as pd
import numpy as np

data = {'A': [1, 2, 3], 'B': [4, 5, 6]}
df = pd.DataFrame(data)
print(df)
`);

const process = await wc.spawn('python3', ['analysis.py']);
```

## Limitations & Differences

### Not Yet Supported:
- Binary snapshots (from `@webcontainer/snapshot`)
- Symlinks in file trees
- Some advanced terminal features

### Differences from Native WebContainer:
- **Network requests** from sandbox go through your infrastructure, not browser
- **Performance** depends on your sandbox backend (can be faster or slower)
- **Security** is your responsibility (sandboxes must be properly isolated)

## Architecture

```
┌─────────────────┐
│  Your App       │
│  (Browser/Node) │
└────────┬────────┘
         │ WebContainer API (polyfill)
         ↓
┌─────────────────┐
│ @computesdk/    │
│   client       │ → REST API + WebSocket
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│  Your Sandbox   │
│  Infrastructure │
│  (E2B, etc.)    │
└─────────────────┘
```

Instead of running Node.js in the browser, the polyfill:
1. Translates WebContainer API calls to REST/WebSocket
2. Sends them to your remote sandbox
3. Streams responses back

## Comparison

| Feature | Native WebContainer | Polyfill |
|---------|---------------------|----------|
| **Runs in** | Browser only | Anywhere |
| **Languages** | Node.js only | Any |
| **Headers** | Requires COEP | None |
| **Instances** | One at a time | Unlimited |
| **Performance** | Fast (local) | Network latency |
| **Cost** | Free | Your infrastructure |
| **Security** | Browser sandbox | Your responsibility |

## Examples

Check out complete examples:

- [Basic Usage](./examples/webcontainer-polyfill-basic.ts)
- [Express Server](./examples/webcontainer-polyfill-express.ts)
- [Migration Guide](./examples/webcontainer-migration.md)

## Contributing

Found a bug or want to add a feature? Contributions welcome!

## License

MIT
