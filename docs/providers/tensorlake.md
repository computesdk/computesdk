# Tensorlake

Tensorlake provider for ComputeSDK - Stateful MicroVM sandboxes for agentic applications and LLM-generated code execution.

## Installation & Setup

```bash
npm install @computesdk/tensorlake
```

Add your Tensorlake credentials to a `.env` file:

```bash
TENSORLAKE_API_KEY=your_tensorlake_api_key
```

## Usage

```typescript
import { tensorlake } from '@computesdk/tensorlake';

const compute = tensorlake({
  apiKey: process.env.TENSORLAKE_API_KEY,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Execute code
const result = await sandbox.runCode('print("Hello from Tensorlake!")');
console.log(result.output); // "Hello from Tensorlake!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface TensorlakeConfig {
  /** Tensorlake API key - if not provided, will use TENSORLAKE_API_KEY env var */
  apiKey?: string;
  /** Override for the management API base URL */
  apiUrl?: string;
  /** Override for the sandbox proxy URL */
  proxyUrl?: string;
  /** Default container image for new sandboxes (default: ubuntu-minimal) */
  image?: string;
  /** Default timeout in seconds for sandboxes */
  timeout?: number;
}
```

### Sandbox Images

Tensorlake supports custom container images. The default is `ubuntu-minimal`:

```typescript
const sandbox = await compute.sandbox.create({ image: 'ubuntu-minimal' });
```

### Snapshots

Tensorlake supports snapshotting sandboxes for fast restores:

```typescript
// Create a snapshot from a running sandbox
const snapshot = await compute.snapshot.create(sandboxId);

// Restore from a snapshot
const sandbox = await compute.sandbox.create({ snapshotId: snapshot.id });
```

## Runtime Detection

The provider automatically detects the runtime based on code patterns:

**Python indicators:**
- `print` statements
- `import` statements
- `def` function definitions
- Python-specific syntax (`f"`, `raise`, `sys.`, etc.)

**Default:** Node.js for all other cases
