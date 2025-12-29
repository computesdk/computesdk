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


## Runtime Detection

The provider automatically detects the runtime based on code patterns:

**Python indicators:**
- `print` statements
- `import` statements  
- `def` function definitions
- Python-specific syntax (`f"`, `__`, etc.)

**Default:** Node.js for all other cases


## SDK Reference Links:

- **[Code Execution](/docs/reference/code-execution)** - Execute code snippets in various runtimes
- **[Command Execution](/docs/reference/code-execution#basic-code-execution)** - Run shell commands and scripts
- **[Filesystem Operations](/docs/reference/filesystem)** - Read, write, and manage files in sandboxes
- **[Sandbox Management](/docs/reference/sandbox-management)** - Create, list, and destroy sandboxes
- **[Error Handling](/docs/reference/api-integration#error-handling)** - Handle command failures and runtime errors
- **[Web Framework Integration](/docs/reference/api-integration#web-framework-integration)** - Integrate with Express, Next.js, and other frameworks