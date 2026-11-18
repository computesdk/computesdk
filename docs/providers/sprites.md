---
description: >-
  Set up the Sprites provider for ComputeSDK, configure your token, and create
  cloud sandboxes to run commands and expose apps.
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

# Sprites

Sprites provider for ComputeSDK - cloud sandboxes powered by Sprites

## Standard sizes

Sprites do not support `sizeClass`. Every Sprite runs on the same fixed shape: 8 vCPUs, memory the platform manages and autoscales per Sprite, and 100 GB of storage ([Lifecycle and Persistence](https://docs.fly.io/sprites/concepts/lifecycle.md)). `POST /v1/sprites` takes only `name` and `url_settings`, with no CPU, memory or disk fields ([Create a sprite](https://docs.fly.io/sprites/api/sprites/create-a-sprite.md)).

| `sizeClass` | Status | Reason |
| --- | --- | --- |
| `xs`, `sm`, `md`, `lg`, `xl`, `2xl`, `3xl` | `unsupported` | Fixed 8-vCPU shape; memory is not a listed, selectable figure. |

`provider.sizes.resolve(...)` returns `unsupported` for every class, and `create({ sizeClass })` rejects with `InstanceSizeError` (`code: 'unsupported'`, `fallback: false`) before calling the API. Omit `sizeClass` to create a Sprite.

## Installation & Setup

```bash
npm install @computesdk/sprites
```

Add your Sprites credentials to a `.env` file:

```bash
SPRITES_TOKEN=your_sprites_token
```

## Usage

```typescript
import { sprites } from '@computesdk/sprites';

const compute = sprites({
  apiKey: process.env.SPRITES_TOKEN,
});

// Create sandbox
const sandbox = await compute.instances.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Sprites!"');
console.log(result.stdout); // "Hello from Sprites!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface SpritesConfig {
  /** Sprites API token - if not provided, will fallback to SPRITES_TOKEN environment variable */
  apiKey?: string;
  /** Base URL for the Sprites API - defaults to https://api.sprites.dev/v1 */
  baseUrl?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
}
```

### Supported Operations

| Method       | Supported | Notes                                                                   |
| ------------ | --------- | ----------------------------------------------------------------------- |
| `create`     | ✅         | Provisions a new Sprite via `POST /sprites`.                            |
| `getById`    | ✅         | Looks up a Sprite by name.                                              |
| `list`       | ✅         | Lists all Sprites for the token.                                        |
| `destroy`    | ✅         | Deletes the Sprite.                                                     |
| `runCommand` | ✅         | Executes commands over the `bash` exec endpoint; supports `cwd`/`env`.  |
| `getInfo`    | ✅         |                                                                         |
| `getUrl`     | ✅         | Returns the Sprite's public URL (Sprites are created with public auth). |
| `filesystem` | ✅         | Native `read`, `write`, `mkdir`, `readdir`, `exists`, `remove`.         |
