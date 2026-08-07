# @computesdk/neevcloud

[NeevCloud](https://neevcloud.com) provider for [ComputeSDK](https://github.com/computesdk/computesdk) — run commands and manage files in secure cloud sandboxes.

## Installation

```bash
npm install @computesdk/neevcloud
```

## Setup

Get an API key from the NeevCloud console and note the org and project the sandboxes should live in, then set:

```bash
export NEEV_API_KEY=sk-nc-...
export NEEV_ORG_ID=org-...
export NEEV_PROJECT_ID=prj-...
```

## Quick Start

```typescript
import { neevcloud } from '@computesdk/neevcloud';

const compute = neevcloud();
const sandbox = await compute.sandbox.create();

const res = await sandbox.runCommand('echo "Hello from NeevCloud!"');
console.log(res.stdout); // "Hello from NeevCloud!"

await sandbox.filesystem.writeFile('/app.txt', 'hi');
console.log(await sandbox.filesystem.readFile('/app.txt')); // "hi"

const url = await sandbox.getUrl({ port: 3000 });
console.log(url); // https://3000-<id>.<region>.neevsandbox.app

await sandbox.destroy();
```

## Configuration

`neevcloud(config)` accepts `{ apiKey?, orgId?, projectId?, timeout? }`. Every field is optional and is read from the matching environment variable when omitted, so most callers can use `neevcloud()` with no arguments.

```typescript
interface NeevCloudConfig {
  /** NeevCloud API key. Read from NEEV_API_KEY when omitted. */
  apiKey?: string;
  /** Org the sandboxes belong to. Read from NEEV_ORG_ID when omitted. */
  orgId?: string;
  /** Project the sandboxes belong to. Read from NEEV_PROJECT_ID when omitted. */
  projectId?: string;
  /** Request timeout in milliseconds. */
  timeout?: number;
}
```

## Features

- **Command execution** — run shell commands, buffered or streamed, foreground or background.
- **Filesystem access** — read, write, list, stat, and remove files rooted at the sandbox workspace.
- **Preview URLs** — expose any port over a public HTTPS URL with `getUrl({ port })`.
- **Flexible boot** — start from a catalogue template, a raw OCI image, or the platform default.

## API Reference

### Command Execution

```typescript
// Buffered — resolves with the full result
const res = await sandbox.runCommand('ls -la');
console.log(res.stdout, res.exitCode, res.durationMs);

// Streamed — pass output callbacks to receive chunks as they arrive
await sandbox.runCommand('npm install', {
  onStdout: (chunk) => process.stdout.write(chunk),
  onStderr: (chunk) => process.stderr.write(chunk),
});

// Background — returns immediately, leaves the process running
await sandbox.runCommand('python3 -m http.server 3000', { background: true });
```

The command runs through a shell, so pipes and redirection work. A `cwd` is resolved relative to the workspace root.

### Filesystem Operations

```typescript
await sandbox.filesystem.writeFile('/data/input.csv', csv);
const content = await sandbox.filesystem.readFile('/data/input.csv');
await sandbox.filesystem.mkdir('/data/output');
const entries = await sandbox.filesystem.readdir('/data');
const present = await sandbox.filesystem.exists('/data/input.csv');
await sandbox.filesystem.remove('/data/input.csv');
```

The filesystem is rooted at the sandbox workspace and takes workspace-relative paths; a leading `/` is treated as relative to the workspace root, so `filesystem` calls for `/app.txt` and `app.txt` hit the same file. Shell commands also run from the workspace root, so **relative paths address the same file across `runCommand` and `filesystem`**. Note that a leading-slash path inside a `runCommand` string is a real absolute path (e.g. `cat /app.txt` looks at the filesystem root, not the workspace) — use a relative path, or a `/workspace/...` prefix, to reach a workspace file from a command.

### Preview URLs

```typescript
// Start a server, then expose its port over public HTTPS
await sandbox.runCommand('python3 -m http.server 3000', { background: true });
const url = await sandbox.getUrl({ port: 3000 });
```

### Sandbox Management

```typescript
const sandbox = await compute.sandbox.create({ templateId: 'sb-ubuntu-24-04-minimal' });
const sandbox = await compute.sandbox.create({ image: 'docker.io/library/python:3.12' });

const info = await sandbox.getInfo(); // { id, provider, status, createdAt, timeout }
const all = await compute.sandbox.list();
const one = await compute.sandbox.getById(id); // null if not found
await sandbox.destroy();
```

`templateId` and `image` are mutually exclusive; omit both for the platform default.

## Beyond the ComputeSDK Surface

For capabilities outside the ComputeSDK contract — interactive PTYs, long-running process supervision, snapshots, and fork/restore — reach the underlying [`@neevcloud/sdk`](https://github.com/NeevCloudAI/neev-sdk-js) handle:

```typescript
const native = sandbox.getInstance();
const snapshot = await native.snapshot();
```

## License

MIT
