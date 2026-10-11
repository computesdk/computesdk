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

await sandbox.filesystem.writeFile('app.txt', 'hi');
console.log(await sandbox.filesystem.readFile('app.txt')); // "hi"

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
- **Filesystem access** — read, write, list, stat, and remove files.
- **Preview URLs** — expose any port over a public HTTPS URL with `getUrl({ port })`.
- **Flexible boot** — start from a catalogue template, a raw OCI image, a snapshot, or the platform default, with a name, env vars, size, and lifetime.
- **Snapshots** — save a running sandbox's memory and filesystem, then boot new sandboxes from it.
- **Templates** — list the sandbox template catalogue.

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

The command runs through a shell from the workspace root (`/workspace`), so pipes and redirection work. A relative `cwd` is resolved from the workspace root; an absolute one is used as is. Streamed output comes over the NeevCloud exec API, so no port inside the sandbox has to be reachable. A command that outruns its `timeout` returns exit code `124` with the output it produced so far.

### Filesystem Operations

```typescript
await sandbox.filesystem.writeFile('data/input.csv', csv);
const content = await sandbox.filesystem.readFile('data/input.csv');
await sandbox.filesystem.mkdir('data/output');
const entries = await sandbox.filesystem.readdir('data');
const present = await sandbox.filesystem.exists('data/input.csv');
await sandbox.filesystem.remove('data/input.csv');
```

Paths mean the same thing in `filesystem` calls and in `runCommand`: a relative path is resolved from the workspace root (`/workspace`), and an absolute path is used as is. Paths inside the workspace go through the NeevCloud file API; an absolute path outside it, such as `/tmp/x`, goes through the shell.

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

// Name, env vars, size (cpu cores, memory in MB) and lifetime (ms; deleted when it elapses)
const sandbox = await compute.sandbox.create({
  name: 'build-42',
  envs: { NODE_ENV: 'production' },
  cpu: 2,
  memory: 4096,
  timeout: 30 * 60 * 1000,
});

const info = await sandbox.getInfo(); // { id, provider, status, createdAt, timeout, metadata }
const all = await compute.sandbox.list();
const one = await compute.sandbox.getById(id); // null if not found
await sandbox.destroy();
```

`templateId` and `image` are mutually exclusive; omit both for the platform default. Passing an `AbortSignal` as `signal` cancels a create and deletes the sandbox if it was already requested.

### Snapshots

```typescript
// Save memory and filesystem; resolves once the snapshot is ready to restore
const snapshot = await compute.snapshot.create(sandbox.sandboxId, { name: 'after-install' });

// Boot a new sandbox from it
const copy = await compute.sandbox.create({ snapshotId: snapshot.id });

const forOne = await compute.snapshot.list({ sandboxId: sandbox.sandboxId });
const all = await compute.snapshot.list(); // visits every sandbox in the project
await compute.snapshot.delete(snapshot.id);
```

### Templates

```typescript
const templates = await compute.template.list();
```

The template catalogue is managed by NeevCloud, so `template.create` and `template.delete` throw. Boot from your own image with `create({ image })`, or save a configured sandbox with `snapshot.create`.

## Beyond the ComputeSDK Surface

For capabilities outside the ComputeSDK contract — pause/resume, interactive PTYs, process supervision, egress allow-lists, fork and rollback, and audit logs — reach the underlying [`@neevcloud/sdk`](https://github.com/NeevCloudAI/neev-sdk-js) handle:

```typescript
const native = sandbox.getInstance();
await native.pause();
await native.resume();
const copy = await native.fork('copy-of-build');
```

## License

MIT
