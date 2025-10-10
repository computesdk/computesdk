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
  }) 
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
  /** Runtime environment */
  runtime?: 'node' | 'python';
  /** Vercel token - if not provided, will use env vars */
  token?: string;
  /** Team ID for team accounts */
  teamId?: string;
  /** Project ID */
  projectId?: string;
  /** Use OIDC authentication */
  useOIDC?: boolean;
  /** Deployment region */
  region?: string;
  /** Memory allocation in MB */
  memory?: number;
  /** Execution timeout in milliseconds */
  timeout?: number;
}
```


## Runtime Detection

The provider automatically detects the runtime based on code patterns:

**Python indicators:**
- `print(` statements
- `import` statements  
- `def` function definitions
- Python-specific syntax (`f"`, `__`, etc.)

**Default:** Node.js for all other cases


## SDK Reference Links:

- **[Code Execution](./reference/code-execution)** - Execute code snippets in various runtimes
- **[Command Execution](./reference/code-execution#runcommand-method)** - Run shell commands and scripts
- **[Filesystem Operations](./reference/filesystem)** - Read, write, and manage files in sandboxes
- **[Sandbox Management](./reference/sandbox-management.md)** - Create, list, and destroy sandboxes
- **[Error Handling](./reference/api-integration.md#error-handling)** - Handle command failures and runtime errors
- **[Web Framework Integration](./reference/api-integration#web-framework-integration)** - Integrate with Express, Next.js, and other frameworks
