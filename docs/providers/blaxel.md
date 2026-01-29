# Blaxel

Blaxel provider for ComputeSDK


## Installation & Setup

```bash
npm install computesdk

# add to .env file
COMPUTESDK_API_KEY=your_computesdk_api_key

BL_API_KEY=your_blaxel_api_key
BL_WORKSPACE=your_blaxel_workspace
```


## Usage

```typescript
import { compute } from 'computesdk';
// auto-detects provider from environment variables

// Create sandbox
const sandbox = await compute.sandbox.create();

// Execute code
const result = await sandbox.runCode('print("Hello from Blaxel!")');
console.log(result.stdout); // "Hello from Blaxel!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
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
  /** Default memory allocation in MB (default: 4096) */
  memory?: number;
  /** Default ports for sandbox (default: [3000]) */
  ports?: number[];
}
```

## Explicit Provider Configuration

If you prefer to set the provider explicitly, you can do so as follows:

```typescript
import { compute } from 'computesdk';

compute.setConfig({
   computesdkApiKey: process.env.COMPUTESDK_API_KEY,
   provider: 'blaxel',
   blaxel: {
     apiKey: process.env.BL_API_KEY,
     workspace: process.env.BL_WORKSPACE
   }
});

const sandbox = await compute.sandbox.create();
```

## Runtime Detection

The provider automatically detects the runtime based on code patterns:

**Python indicators:**
- `print` statements
- `import` statements
- `def` function definitions
- Python-specific syntax (`f"`, `__`, etc.)

**Default:** Node.js for all other cases

### Default Images

The provider automatically selects images based on runtime:
- **Python:** `blaxel/prod-py-app:latest`
- **Node.js:** `blaxel/prod-ts-app:latest`
- **Default:** `blaxel/prod-base:latest`
