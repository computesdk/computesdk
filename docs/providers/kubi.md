---
description: >-
  Kubi provider for ComputeSDK - disposable Linux desktops in their own VM for AI agents, with commands,
  files, ports, and a desktop that the same key drives through Kubi's own API.
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

# Kubi

[Kubi](https://trykubi.com) provider for ComputeSDK - each sandbox is a disposable Kubi screen, a Linux desktop
(Debian 13, 4 vCPU, 8 GB, 50 GB disk) in its own VM in the EU.

## Installation & Setup

```bash
npm install @computesdk/kubi
```

Add your Kubi API key (console.trykubi.com, API keys: `read`, `exec`, `power`, and `network` for `getUrl`) to a
`.env` file:

```bash
KUBI_API_KEY=your_kubi_api_key
```

## Usage

```typescript
import { kubi } from '@computesdk/kubi';

const compute = kubi({
  apiKey: process.env.KUBI_API_KEY,
});

// Create sandbox (Kubi deletes it after `timeout`, here 10 minutes)
const sandbox = await compute.instances.create({ timeout: 10 * 60_000 });

// Run a command
const result = await sandbox.runCommand('echo "Hello from Kubi!"');
console.log(result.stdout);

// Files
await sandbox.filesystem.writeFile('/home/user/notes.txt', 'hi');
console.log(await sandbox.filesystem.readFile('/home/user/notes.txt'));

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface KubiConfig {
  /** Kubi API key - if not provided, will use KUBI_API_KEY env var */
  apiKey?: string;
  /** API base URL - defaults to KUBI_API_URL or https://api.trykubi.com */
  baseUrl?: string;
  /** Sandbox lifetime in milliseconds (60 s to 30 days); default 5 minutes */
  timeout?: number;
}
```

## Notes

- **A desktop, not only a shell.** The same key drives the screen's desktop (screenshots, clicks, typing, the
  accessibility tree, a live view) through [Kubi's API](https://docs.trykubi.com), for computer-use agents.
- **Lifetime:** `timeout` becomes the screen's end time; Kubi deletes the screen at that time even if your program
  has gone away.
- **Ports:** `getUrl({ port })` opens one of the screen's 3 ports and returns its HTTPS URL.
- **Environment:** `envs` at create are sourced before every command; a command's own `env` wins.
- **Size and region:** one size (4 vCPU, 8 GB, 50 GB), in France.

## Snapshots, templates, pause and processes

- **Snapshots** are Kubi templates: `snapshot.create(sandboxId)` saves the screen's disk (not its memory); `create({ snapshotId })` starts new screens from it. Saving takes about a minute and a half for a few GB today.
- **Templates:** `template.list` and `template.delete`; a template is saved with `snapshot.create`.
- **Pause and resume** stop and start the screen: the disk survives, running processes do not.
- **Background processes:** `startProcess` runs on ComputeSDK's shell tier over `runCommand`: stdin, kill, parallel starts and reattach.
- **Size:** `sizeClass: 'lg'` (4 vCPU, 8 GiB) is the one size; other sizes are unsupported.
