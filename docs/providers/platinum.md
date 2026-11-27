---
description: >-
  Platinum provider for ComputeSDK - microVM sandboxes with CPU and memory chosen
  per create, shell command execution and preview URLs.
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

# Platinum

[Platinum](https://www.platinum.dev) provider for ComputeSDK - microVM sandboxes with CPU and memory chosen per create, shell command execution and preview URLs.

## Installation & Setup

```bash
npm install @computesdk/platinum
```

Add your Platinum API key to a `.env` file:

```bash
PLATINUM_API_KEY=your_platinum_api_key
```

Create a key in the [Platinum dashboard](https://platinum.dev/dashboard#apikeys). `PT_TOKEN` is accepted as a fallback.

## Usage

```typescript
import { platinum } from '@computesdk/platinum';

const compute = platinum({
  apiKey: process.env.PLATINUM_API_KEY,
});

// Create sandbox from a template, at a standard size
const sandbox = await compute.instances.create({ templateId: 'csdk-node22', sizeClass: 'md' });

// Run a command
const result = await sandbox.runCommand('echo "Hello from Platinum!"');
console.log(result.stdout);

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface PlatinumConfig {
  /** Platinum API key - if not provided, will use PLATINUM_API_KEY, then PT_TOKEN */
  apiKey?: string;
  /** API base URL - defaults to PLATINUM_API_URL / PT_API_URL, then https://api.platinum.dev */
  apiUrl?: string;
  /** Template to boot when a create names neither `templateId` nor `image` */
  template?: string;
  /** How long create waits for the sandbox to reach `running`, in ms (default 60000) */
  timeout?: number;
}
```

## Templates and sizes

Without `templateId` or `image`, Platinum boots its minimal `pt-base` template, which does not include Node.js. Build a Node template once per organization:

```bash
pt template build csdk-node22 --image node:22-slim --entrypoint none --cpu 1 --ram 1024 --wait
```

`sizeClass` maps `sm`, `md`, `lg` and `xl` to Platinum's per-create `cpu` and `ram_mb`, so one template serves every size. `xs` and `2xl` are not declared. CPU and memory caps per sandbox and per organization depend on the organization's tier.

## Limitations

- `snapshotId` and create-time `volumes` are rejected; use the Platinum SDK for snapshots (`sandbox.clone()`) and volume mounts.
- One `runCommand` call is capped at 85 seconds by Platinum's exec API. Run longer work as a background command.
