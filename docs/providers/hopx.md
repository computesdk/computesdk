---
description: >-
  Set up the HopX provider for ComputeSDK, configure your API key, and create
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

# HopX

HopX provider for ComputeSDK

## Installation & Setup

```bash
npm install @computesdk/hopx
```

Add your HopX credentials to a `.env` file:

```bash
HOPX_API_KEY=your_hopx_api_key
```

## Usage

```typescript
import { hopx } from '@computesdk/hopx';

const compute = hopx({
  apiKey: process.env.HOPX_API_KEY,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from HopX!"');
console.log(result.stdout); // "Hello from HopX!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface HopxConfig {
  /** HopX API key - if not provided, will use HOPX_API_KEY env var */
  apiKey?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Template name for sandbox creation (e.g. 'code-interpreter') */
  template?: string;
  /** Base API URL for custom/staging environments */
  baseURL?: string;
}
```
