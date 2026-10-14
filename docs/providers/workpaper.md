---
description: >-
  Workpaper provider for ComputeSDK - persistent Linux computers in microVMs that
  keep their files and running processes when paused, and resume or fork in about
  a second.
layout:
  width: default
  title:
    visible: true
  description:
    visible: false
  tableOfContents:
    visible: true
  outline:
    visible: true
  pagination:
    visible: true
  metadata:
    visible: true
  tags:
    visible: true
  actions:
    visible: true
---

# Workpaper

[Workpaper](https://workpaper.co) provider for ComputeSDK - persistent Linux computers in microVMs that keep their files and running processes when paused, and resume or fork in about a second.

## Installation & Setup

```bash
npm install @computesdk/workpaper
```

Add your Workpaper API key to a `.env` file:

```bash
WORKPAPER_API_KEY=your_workpaper_api_key
```

Create a key with the Workpaper CLI (`curl -fsSL https://workpaper.co/install | sh`, then `workpaper auth login`):

```bash
workpaper keys create my-app
```

## Usage

```typescript
import { workpaper } from '@computesdk/workpaper';

const compute = workpaper({
  apiKey: process.env.WORKPAPER_API_KEY,
});

// Create a computer (2 vCPU / 4 GB by default)
const sandbox = await compute.instances.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Workpaper!"');
console.log(result.stdout); // "Hello from Workpaper!"

// Commands take env and cwd
const env = await sandbox.runCommand('echo $FOO', { env: { FOO: 'bar' }, cwd: '/tmp' });

// Work with files
await sandbox.filesystem.writeFile('/tmp/hello.py', 'print("Hello World")');
const content = await sandbox.filesystem.readFile('/tmp/hello.py');

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface WorkpaperConfig {
  /** Workpaper API key - if not provided, will use WORKPAPER_API_KEY env var */
  apiKey?: string;
  /** Computer size: 'small' (2 vCPU / 4 GB), 'large' (4 vCPU / 8 GB) or 'xlarge' (8 vCPU / 16 GB). Default 'small' */
  size?: 'small' | 'large' | 'xlarge';
}
```

`compute.instances.create({ vcpus, memMiB })` picks the smallest size that fits, up to 8 vCPU / 16 GB.

A computer stops by itself after `timeout` milliseconds (default 5 minutes), keeping its files and processes. Pass a longer one for long jobs:

```typescript
const sandbox = await compute.instances.create({ timeout: 60 * 60 * 1000 }); // 1 hour
```

## Pause, resume and fork

Pause, resume and fork have no slots in the standard interface. Reach them through the underlying computer:

```typescript
const native = sandbox.getInstance();
await native.stop();                    // pause: files and processes are kept
await native.start();                   // resume where it left off
const copy = await native.fork('copy'); // a second computer from this one's current state
```

## Limitations

- Workpaper computers don't accept incoming connections, so `getUrl` is not supported.
- Sizes go up to 8 vCPU / 16 GB; larger `vcpus` or `memMiB` requests throw.
