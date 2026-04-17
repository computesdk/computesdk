# Modal

Modal provider for ComputeSDK - Execute code with GPU support for machine learning workloads.


## Installation & Setup

```bash
npm install @computesdk/modal
```

Add your Modal credentials to a `.env` file:

```bash
MODAL_TOKEN_ID=your_modal_token_id
MODAL_TOKEN_SECRET=your_modal_token_secret
```


## Usage

```typescript
import { modal } from '@computesdk/modal';

const compute = modal({
  tokenId: process.env.MODAL_TOKEN_ID,
  tokenSecret: process.env.MODAL_TOKEN_SECRET,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Execute code
const result = await sandbox.runCode('print("Hello from Modal!")');
console.log(result.output); // "Hello from Modal!"

// Clean up
await sandbox.destroy();
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

Ports are exposed with unencrypted tunnels by default for maximum compatibility.
