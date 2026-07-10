---
description: >-
  Use Blaxel with ComputeSDK to create sandboxes with API key and workspace
  authentication, and configure image, region, memory, and exposed ports.
tags:
  - tag: benchmarked
    primary: true
---

# Blaxel

Blaxel provider for ComputeSDK

## Installation & Setup

```bash
npm install @computesdk/blaxel
```

Add your Blaxel credentials to a `.env` file:

```bash
BL_API_KEY=your_blaxel_api_key
BL_WORKSPACE=your_blaxel_workspace
```

## Usage

```typescript
import { blaxel } from '@computesdk/blaxel';

const compute = blaxel({
  apiKey: process.env.BL_API_KEY,
  workspace: process.env.BL_WORKSPACE,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Blaxel!"');
console.log(result.stdout); // "Hello from Blaxel!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface BlaxelConfig {
  /** Blaxel API key - if not provided, will use BL_API_KEY env var */
  apiKey?: string;
  /** Blaxel workspace ID - if not provided, will use BL_WORKSPACE env var */
  workspace?: string;
  /** Default image for sandboxes */
  image?: string;
  /** Default region for sandbox deployment */
  region?: string;
  /** Default memory allocation in MB */
  memory?: number;
  /** Default ports to expose on the sandbox */
  ports?: number[];
}
```

### Default Images

The provider automatically selects images based on the runtime specified at creation time:

* **Python:** `blaxel/py-app:latest`
* **Node.js:** `blaxel/ts-app:latest`
* **Default:** `blaxel/base-image:latest`
