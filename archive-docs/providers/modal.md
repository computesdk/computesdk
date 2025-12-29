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
// Set as explict provider
const sandbox = compute({ 
  provider: 'modal', 
  modal: {
    modalTokenId: process.env.MODAL_TOKEN_ID,
    modalTokenSecret: process.env.MODAL_TOKEN_SECRET,
    modalRuntime: 'node',
    modalTimeout: 60000
  },
  apiKey: process.env.COMPUTESDK_API_KEY 
}).sandbox.create();
```
Ports are exposed with unencrypted tunnels by default for maximum compatibility.
## SDK Reference Links:

- **[Code Execution](/docs/reference/code-execution)** - Execute code snippets in various runtimes
- **[Command Execution](/docs/reference/code-execution#basic-code-execution)** - Run shell commands and scripts
- **[Filesystem Operations](/docs/reference/filesystem)** - Read, write, and manage files in sandboxes
- **[Sandbox Management](/docs/reference/sandbox-management)** - Create, list, and destroy sandboxes
- **[Error Handling](/docs/reference/api-integration#error-handling)** - Handle command failures and runtime errors
- **[Web Framework Integration](/docs/reference/api-integration#web-framework-integration)** - Integrate with Express, Next.js, and other frameworks
