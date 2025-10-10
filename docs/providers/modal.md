# Modal

Modal provider for ComputeSDK - Execute code with GPU support for machine learning workloads.

## Installation

```bash
npm install @computesdk/modal
```

## Usage

### With ComputeSDK

```typescript
import { createCompute } from 'computesdk';
import { modal } from '@computesdk/modal';

// Set as default provider
const compute = createCompute({ 
  provider: modal({ 
    tokenId: process.env.MODAL_TOKEN_ID,
    tokenSecret: process.env.MODAL_TOKEN_SECRET
  }) 
});

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

## Configuration

### Environment Variables

```bash
export MODAL_TOKEN_ID=your_modal_token_id_here
export MODAL_TOKEN_SECRET=your_modal_token_secret_here
```

### Configuration Options

```typescript
interface ModalConfig {
  /** Modal token ID - if not provided, will use MODAL_TOKEN_ID env var */
  tokenId?: string;
  /** Modal token secret - if not provided, will use MODAL_TOKEN_SECRET env var */
  tokenSecret?: string;
  /** GPU type for ML workloads */
  gpu?: 'T4' | 'A10G' | 'A100';
  /** CPU count */
  cpu?: number;
  /** Memory allocation in GB */
  memory?: number;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Custom image for the environment */
  image?: string;
}
```
## SDK Reference Links:

- **[Code Execution](./reference/code-execution)** - Execute code snippets in various runtimes
- **[Command Execution](./reference/code-execution#runcommand-method)** - Run shell commands and scripts
- **[Filesystem Operations](./reference/filesystem)** - Read, write, and manage files in sandboxes
- **[Sandbox Management](./reference/sandbox-management.md)** - Create, list, and destroy sandboxes
- **[Error Handling](./reference/api-integration.md#error-handling)** - Handle command failures and runtime errors
- **[Web Framework Integration](./reference/api-integration#web-framework-integration)** - Integrate with Express, Next.js, and other frameworks