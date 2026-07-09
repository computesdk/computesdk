# Sprites

Sprites provider for ComputeSDK - cloud sandboxes powered by Sprites


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
const sandbox = await compute.sandbox.create();

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

| Method       | Supported | Notes                                                                    |
| ------------ | --------- | ------------------------------------------------------------------------ |
| `create`     | ✅        | Provisions a new Sprite via `POST /sprites`.                             |
| `getById`    | ✅        | Looks up a Sprite by name.                                              |
| `list`       | ✅        | Lists all Sprites for the token.                                        |
| `destroy`    | ✅        | Deletes the Sprite.                                                     |
| `runCommand` | ✅        | Executes commands over the `bash` exec endpoint; supports `cwd`/`env`.  |
| `getInfo`    | ✅        |                                                                          |
| `getUrl`     | ✅        | Returns the Sprite's public URL (Sprites are created with public auth). |
| `filesystem` | ✅        | Native `read`, `write`, `mkdir`, `readdir`, `exists`, `remove`.         |
