# Beam

Beam provider for ComputeSDK


## Installation & Setup

```bash
npm install @computesdk/beam
```

Add your Beam credentials to a `.env` file:

```bash
BEAM_TOKEN=your_beam_token
BEAM_WORKSPACE_ID=your_beam_workspace_id
```


## Usage

```typescript
import { beam } from '@computesdk/beam';

const compute = beam({
  token: process.env.BEAM_TOKEN,
  workspaceId: process.env.BEAM_WORKSPACE_ID,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Execute code
const result = await sandbox.runCode('print("Hello from Beam!")');
console.log(result.output); // "Hello from Beam!"

// Clean up
await sandbox.destroy();
```


### Configuration Options

```typescript
interface BeamConfig {
  /** Beam API token - if not provided, will use BEAM_TOKEN env var */
  token?: string;
  /** Beam workspace ID - if not provided, will use BEAM_WORKSPACE_ID env var */
  workspaceId?: string;
  /** Gateway URL for custom/staging environments */
  gatewayUrl?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
}
```

## Runtime Detection

The provider automatically detects the runtime based on code patterns:

**Python indicators:**
- `print` statements
- `import` statements  
- `def` function definitions
- Python-specific syntax (`f"`, `__`, etc.)

**Default:** Node.js for all other cases
