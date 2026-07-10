---
description: >-
  Set up the Runloop provider for ComputeSDK, configure your API key, and create
  sandboxes to run commands.
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
tags:
  - tag: benchmarked
    primary: true
---

# Runloop

Runloop provider for ComputeSDK

## Installation & Setup

```bash
npm install @computesdk/runloop
```

Add your Runloop credentials to a `.env` file:

```bash
RUNLOOP_API_KEY=your_runloop_api_key
```

## Usage

```typescript
import { runloop } from '@computesdk/runloop';

const compute = runloop({
  apiKey: process.env.RUNLOOP_API_KEY,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Runloop!"');
console.log(result.stdout); // "Hello from Runloop!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface RunloopConfig {
  /** Runloop API key - if not provided, will use RUNLOOP_API_KEY env var */
  apiKey?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
}
```
