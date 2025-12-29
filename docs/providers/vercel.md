# Vercel

Vercel provider for ComputeSDK - Execute code in globally distributed serverless environments.

## Installation

```bash
npm install @computesdk/vercel
```

## Usage

### With ComputeSDK

```typescript
import { createCompute } from 'computesdk';
import { vercel } from '@computesdk/vercel';

// Set as default provider
const compute = createCompute({ 
  provider: vercel({ 
    token: process.env.VERCEL_TOKEN,
    teamId: process.env.VERCEL_TEAM_ID,
    projectId: process.env.VERCEL_PROJECT_ID,
  }),
  apiKey: process.env.COMPUTESDK_API_KEY 
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Get instance
const instance = sandbox.getInstance();

// Execute code
const result = await sandbox.runCode('console.log("Hello from Vercel!")');
console.log(result.stdout); // "Hello from Vercel!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

## Configuration

### Environment Variables

```bash
# Option 1: OIDC Token (Recommended)
export VERCEL_OIDC_TOKEN=your_oidc_token_here

# Option 2: Traditional Token
export VERCEL_TOKEN=your_vercel_token_here
export VERCEL_TEAM_ID=your_team_id_here
export VERCEL_PROJECT_ID=your_project_id_here
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

## Explicit Provider Configuration
If you prefer to set the provider explicitly, you can do so as follows:
```typescript
// Set as explict provider
const sandbox = compute({
  provider: 'vercel',
  vercel: {
    vercelToken: 'your_vercel_token',
    vercelTeamId: 'your_vercel_team_id',
    vercelProjectId: 'your_vercel_project_id'
  },
  apiKey: 'your_computesdk_api_key'
}).sandbox.create()
```


## Runtime Detection

The provider automatically detects the runtime based on code patterns:

**Python indicators:**
- `print` statements
- `import` statements  
- `def` function definitions
- Python-specific syntax (`f"`, `__`, etc.)

**Default:** Node.js for all other cases
