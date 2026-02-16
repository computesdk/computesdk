# Modal

Modal provider for ComputeSDK - Execute code with GPU support for machine learning workloads.


## Installation & Setup

```bash
npm install computesdk

# add to .env file
COMPUTESDK_API_KEY=your_computesdk_api_key

MODAL_TOKEN_ID=your_modal_token_id_here
MODAL_TOKEN_SECRET=your_modal_token_secret_here
```


## Usage

### With ComputeSDK

```typescript
import { compute } from 'computesdk';
// auto-detects provider from environment variables

// Create sandbox
const sandbox = await compute.sandbox.create();

// Get instance
const instance = sandbox.getInstance();

// Execute code
const result = await sandbox.runCode('print("Hello from Modal!")');
console.log(result.stdout); // "Hello from Modal!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

### Configuration Options

```typescript
interface ModalConfig {
  /** Modal token ID - if not provided, will use MODAL_TOKEN_ID env var */
  tokenId?: string;
  /** Modal token secret - if not provided, will use MODAL_TOKEN_SECRET env var */
  tokenSecret?: string;
  /** Runtime to use */
  runtime?: 'node' | 'python';
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Modal environment (sandbox or main) */
  environment?: string;
  /** Ports to expose (unencrypted by default) */
  ports?: number[];
}
```

## Explicit Provider Configuration
If you prefer to set the provider explicitly, you can do so as follows:
```typescript
import { compute } from 'computesdk';

compute.setConfig({
   computesdkApiKey: process.env.COMPUTESDK_API_KEY,
   provider: 'modal',
   modal: {
     tokenId: process.env.MODAL_TOKEN_ID,
     tokenSecret: process.env.MODAL_TOKEN_SECRET
   }
});

const sandbox = await compute.sandbox.create();
```
Ports are exposed with unencrypted tunnels by default for maximum compatibility.
