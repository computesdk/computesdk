# Vercel

Vercel provider for ComputeSDK - Execute code in globally distributed serverless environments.

## Installation & Setup

```bash
npm install @computesdk/vercel
```

Add your Vercel credentials to a `.env` file:

```bash
VERCEL_TOKEN=your_vercel_token
VERCEL_TEAM_ID=your_vercel_team_id
VERCEL_PROJECT_ID=your_vercel_project_id
```

## Usage

```typescript
import { vercel } from '@computesdk/vercel';

const compute = vercel({
  token: process.env.VERCEL_TOKEN,
  teamId: process.env.VERCEL_TEAM_ID,
  projectId: process.env.VERCEL_PROJECT_ID,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Execute code
const result = await sandbox.runCode('print("Hello from Vercel!")');
console.log(result.output); // "Hello from Vercel!"

// Clean up
await sandbox.destroy();
```


### Configuration Options

```typescript
interface VercelConfig {
  /** Vercel token - if not provided, will use env vars */
  token?: string;
  /** Team ID for team accounts */
  teamId?: string;
  /** Project ID */
  projectId?: string;
  /** Runtime environment */
  runtime?: 'node' | 'python';
  /** Execution timeout in milliseconds */
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
