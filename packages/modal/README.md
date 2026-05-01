# @computesdk/modal

Modal provider for ComputeSDK — execute code in serverless Modal sandboxes with optional GPU support.

## Installation

```bash
npm install @computesdk/modal
```

This package uses the official [Modal JS SDK](https://www.npmjs.com/package/modal) (v0.7).

## Setup

1. Get your Modal token from [modal.com](https://modal.com/)
2. Set the credentials:

```bash
export MODAL_TOKEN_ID=your_token_id
export MODAL_TOKEN_SECRET=your_token_secret
```

## Quick Start

```typescript
import { modal } from '@computesdk/modal';

const compute = modal({
  tokenId: process.env.MODAL_TOKEN_ID,
  tokenSecret: process.env.MODAL_TOKEN_SECRET,
});

const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand(`python - <<'PY'
import sys
print(f"Python {sys.version}")
PY`);

console.log(result.stdout);
await sandbox.destroy();
```

## Configuration

### Environment Variables

```bash
export MODAL_TOKEN_ID=your_token_id
export MODAL_TOKEN_SECRET=your_token_secret
```

### Configuration Options

```typescript
interface ModalConfig {
  /** Modal token ID - falls back to MODAL_TOKEN_ID env var */
  tokenId?: string;
  /** Modal token secret - falls back to MODAL_TOKEN_SECRET env var */
  tokenSecret?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Modal environment name (e.g. 'main', 'sandbox') */
  environment?: string;
  /** Ports to expose (unencrypted tunnels by default) */
  ports?: number[];
  /** Modal App name (default: 'computesdk-modal') */
  appName?: string;
}
```

### Exposing Ports

Ports declared on the provider are exposed as public Modal tunnels and reachable via `getUrl()`:

```typescript
const compute = modal({
  tokenId: process.env.MODAL_TOKEN_ID,
  tokenSecret: process.env.MODAL_TOKEN_SECRET,
  ports: [3000, 8080],
});

const sandbox = await compute.sandbox.create();

await sandbox.runCommand(`node - <<'JS'
const http = require('http');
http.createServer((req, res) => {
  res.end('Hello from Modal sandbox\\n');
}).listen(3000);
JS`, { background: true });

const url = await sandbox.getUrl({ port: 3000 });
console.log(`Server reachable at: ${url}`);
```

> **Note:** Tunnels are unencrypted by default for maximum compatibility.

## Features

- ✅ **Command Execution** — shell commands via `Sandbox.exec()`
- ✅ **Filesystem Operations** — read, write, mkdir, ls, rm
- ✅ **GPU Support** — Modal's native GPU access for ML workloads
- ✅ **Serverless Scaling** — scale to thousands of concurrent sandboxes
- ✅ **Snapshots** — save and restore sandbox state
- ❌ **Interactive Terminals** — not exposed by the provider

## API Reference

### Command Execution

```typescript
// Run Python code via heredoc
const result = await sandbox.runCommand(`python - <<'PY'
import torch
print(f"CUDA available: {torch.cuda.is_available()}")
PY`);

// Run shell commands directly
await sandbox.runCommand('pip install numpy');
await sandbox.runCommand('ls -la');

// Background process
await sandbox.runCommand('python server.py', { background: true });

// With env vars and cwd
await sandbox.runCommand('python script.py', {
  cwd: '/app',
  env: { DEBUG: 'true' },
});
```

### Filesystem Operations

```typescript
await sandbox.filesystem.writeFile('/app/script.py', 'print("hello")');
const content = await sandbox.filesystem.readFile('/app/script.py');

await sandbox.filesystem.mkdir('/app/data');
const entries = await sandbox.filesystem.readdir('/app');

const exists = await sandbox.filesystem.exists('/app/script.py');
await sandbox.filesystem.remove('/app/script.py');
```

### Sandbox Management

```typescript
// Get sandbox info
const info = await sandbox.getInfo();
console.log(info.id, info.provider, info.status);

// Reconnect to existing sandbox
const existing = await compute.sandbox.getById('sandbox-id');

// Destroy sandbox
await sandbox.destroy();
```

## Error Handling

```typescript
import { modal } from '@computesdk/modal';

try {
  const compute = modal({
    tokenId: process.env.MODAL_TOKEN_ID,
    tokenSecret: process.env.MODAL_TOKEN_SECRET,
  });
  const sandbox = await compute.sandbox.create();
  const result = await sandbox.runCommand('python -c "import nonexistent"');

  if (result.exitCode !== 0) {
    console.error('Command failed:', result.stderr);
  }
} catch (error) {
  if (error.message.includes('Missing Modal')) {
    console.error('Set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET');
  } else if (error.message.includes('authentication')) {
    console.error('Check your Modal credentials');
  }
}
```

## Examples

### GPU-Accelerated Inference

```typescript
import { modal } from '@computesdk/modal';

const compute = modal({
  tokenId: process.env.MODAL_TOKEN_ID,
  tokenSecret: process.env.MODAL_TOKEN_SECRET,
});

const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand(`python - <<'PY'
import torch

device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
print(f"Using device: {device}")

x = torch.randn(1000, 1000, device=device)
y = torch.matmul(x, x.T)
print(f"Result shape: {y.shape}")
PY`);

console.log(result.stdout);
await sandbox.destroy();
```

### Parallel Task Processing

```typescript
import { modal } from '@computesdk/modal';

const compute = modal({
  tokenId: process.env.MODAL_TOKEN_ID,
  tokenSecret: process.env.MODAL_TOKEN_SECRET,
});

const tasks = ['task1.json', 'task2.json', 'task3.json'];

const results = await Promise.all(tasks.map(async (taskFile) => {
  const sandbox = await compute.sandbox.create();
  try {
    return await sandbox.runCommand(`python -c "import json; print(json.dumps({'task': '${taskFile}'}))"`);
  } finally {
    await sandbox.destroy();
  }
}));

console.log(results.map(r => r.stdout));
```

## Best Practices

1. **Resource Management** — destroy sandboxes when done; Modal scales but you still pay per use
2. **Error Handling** — check `exitCode` for command failures, catch for SDK/auth errors
3. **GPU Workloads** — leverage Modal's GPU offering for ML workloads
4. **Long Tasks** — set generous `timeout` for training or large-file workflows

## Limitations

- **Network Access** — subject to Modal's network policies
- **Billing** — pay-per-use Modal pricing applies
- **Tunnel Encryption** — exposed ports use unencrypted tunnels by default

## Support

- [Modal Documentation](https://modal.com/docs)
- [Modal JS SDK on npm](https://www.npmjs.com/package/modal)
- [ComputeSDK Issues](https://github.com/computesdk/computesdk/issues)

## License

MIT
