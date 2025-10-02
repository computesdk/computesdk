# Configuration

ComputeSDK provides provider-specific configuration options for customizing sandbox behavior and authentication settings. Configuration is handled at the provider level when creating provider instances.

## Quick Start

```typescript
import { createCompute } from 'computesdk'
import { e2b } from '@computesdk/e2b'

const compute = createCompute({ 
  defaultProvider: e2b({ apiKey: process.env.E2B_API_KEY }) 
});

// Create sandbox
const sandbox = await compute.sandbox.create({
  options: {
    templateId: 'python',
    timeout: 30000,
    metadata: { project: 'my-app' }
  }
});
```

## Sandbox Configuration

ComputeSDK sandbox configuration is handled through the `CreateSandboxOptions` interface when creating sandboxes:

```typescript
interface CreateSandboxOptions {
  /** Runtime environment (defaults to 'node' if not specified) */
  runtime?: Runtime;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Custom sandbox ID (if supported by provider) */
  sandboxId?: string;
  /** Template ID for sandbox creation (provider-specific) */
  templateId?: string;
  /** Additional metadata for the sandbox */
  metadata?: Record<string, any>;
  /** Domain for sandbox connection (provider-specific) */
  domain?: string;
  /** Environment variables for the sandbox */
  envs?: Record<string, string>;
}
```

### Example Usage

```typescript
import { createCompute } from 'computesdk'
import { e2b } from '@computesdk/e2b'

const compute = createCompute({ 
  defaultProvider: e2b({ apiKey: process.env.E2B_API_KEY }) 
});

// Create sandbox with options
const sandbox = await compute.sandbox.create({
  options: {
    runtime: 'python',
    templateId: 'python-3.11',
    timeout: 60000,
    metadata: { 
      project: 'my-app',
      environment: 'development'
    },
    envs: {
      'NODE_ENV': 'development',
      'DEBUG': 'true'
    }
  }
});
```

## Provider-Specific Configuration

Each provider has its own configuration interface that defines the authentication and settings required for that specific service. Providers are created using factory functions and passed to `createCompute()`.

### E2B Configuration

```typescript
interface E2BConfig {
  /** E2B API key - if not provided, will fallback to E2B_API_KEY environment variable */
  apiKey?: string;
  /** Default runtime environment */
  runtime?: Runtime;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

// Create E2B provider
import { e2b } from '@computesdk/e2b'

const provider = e2b({ 
  apiKey: process.env.E2B_API_KEY,
  runtime: 'python',
  timeout: 60000
});

const compute = createCompute({ defaultProvider: provider });
```

### Vercel Configuration

```typescript
interface VercelConfig {
  /** Vercel API token */
  token?: string;
  /** Vercel team ID */
  teamId?: string;
  /** Vercel project ID */
  projectId?: string;
  /** Runtime environment for code execution */
  runtime?: Runtime;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

// Create Vercel provider
import { vercel } from '@computesdk/vercel'

const provider = vercel({
  token: process.env.VERCEL_TOKEN,
  teamId: process.env.VERCEL_TEAM_ID,
  projectId: process.env.VERCEL_PROJECT_ID,
  runtime: 'node',
  timeout: 30000
});
```

### Modal Configuration

```typescript
interface ModalConfig {
  /** Modal API token ID - if not provided, will fallback to MODAL_TOKEN_ID environment variable */
  tokenId?: string;
  /** Modal API token secret - if not provided, will fallback to MODAL_TOKEN_SECRET environment variable */
  tokenSecret?: string;
  /** Default runtime environment */
  runtime?: Runtime;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Modal environment (sandbox or main) */
  environment?: string;
}

// Create Modal provider
import { modal } from '@computesdk/modal'

const provider = modal({
  tokenId: process.env.MODAL_TOKEN_ID,
  tokenSecret: process.env.MODAL_TOKEN_SECRET,
  runtime: 'python',
  timeout: 30000
});
```

### CodeSandbox Configuration

```typescript
interface CodesandboxConfig {
  /** CodeSandbox API key - if not provided, will fallback to CSB_API_KEY environment variable */
  apiKey?: string;
  /** Template to use for new sandboxes */
  templateId?: string;
  /** Default runtime environment */
  runtime?: Runtime;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

// Create CodeSandbox provider
import { codesandbox } from '@computesdk/codesandbox'

const provider = codesandbox({
  apiKey: process.env.CSB_API_KEY,
  templateId: 'node',
  runtime: 'node',
  timeout: 30000
});
```

### Provider Factory Pattern

All providers follow the same factory pattern:

```typescript
// 1. Import the provider
import { e2b } from '@computesdk/e2b'

// 2. Create provider instance with config
const provider = e2b({ apiKey: 'your-key' });

// 3. Create compute instance with provider
const compute = createCompute({ defaultProvider: provider });

// 4. Use the compute instance
const sandbox = await compute.sandbox.create({
  options: { templateId: 'python' }
});
```

## Configuration Best Practices

1. **Use Environment Variables**: Store sensitive data like API keys in environment variables
2. **Provider Selection**: Choose the right provider based on your use case and requirements
3. **Error Handling**: Implement proper error handling for provider authentication and sandbox creation
4. **Environment Separation**: Use different provider configurations for development, staging, and production
5. **Documentation**: Document provider configurations and environment variables for your team

## Troubleshooting

### Common Configuration Issues

#### Provider Authentication Errors

```typescript
// E2B Authentication Issues
try {
  const provider = e2b({ apiKey: 'invalid-key' });
  const compute = createCompute({ defaultProvider: provider });
  const sandbox = await compute.sandbox.create();
} catch (error) {
  // Error: E2B authentication failed. Please check your E2B_API_KEY environment variable.
  console.error(error.message);
}

// Vercel Authentication Issues  
try {
  const provider = vercel({
    token: process.env.VERCEL_TOKEN, // Missing or invalid
    teamId: process.env.VERCEL_TEAM_ID,
    projectId: process.env.VERCEL_PROJECT_ID
  });
} catch (error) {
  // Error: Missing Vercel team ID. Provide 'teamId' in config or set VERCEL_TEAM_ID environment variable.
  console.error(error.message);
}

// Modal Authentication Issues
try {
  const provider = modal({
    tokenId: process.env.MODAL_TOKEN_ID,
    tokenSecret: 'invalid-secret'
  });
} catch (error) {
  // Error: Modal authentication failed. Please check your MODAL_TOKEN_ID and MODAL_TOKEN_SECRET environment variables.
  console.error(error.message);
}
```

#### Configuration Type Errors

```typescript
// TypeScript will catch these at compile time:
const provider = e2b({
  apiKey: 'your-key',
  timeout: 'invalid-timeout' // Error: Type 'string' is not assignable to type 'number'
});

const sandbox = await compute.sandbox.create({
  options: {
    runtime: 'invalid-runtime' // Error: Type 'invalid-runtime' is not assignable to type 'Runtime'
  }
});
```

### Provider-Specific Troubleshooting

#### E2B Issues
- **API Key Format**: E2B API keys must start with `e2b_`
- **Template IDs**: Use valid E2B template IDs (e.g., 'python-3.11', 'nodejs18')
- **Quota Limits**: Check your E2B usage at https://e2b.dev/

#### Vercel Issues  
- **OIDC vs Traditional Auth**: Use either `VERCEL_OIDC_TOKEN` or the combination of `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, and `VERCEL_PROJECT_ID`
- **Ephemeral Nature**: Vercel sandboxes cannot be resumed or listed
- **Runtime Support**: Primarily supports Node.js execution

#### Modal Issues
- **Token Pair Required**: Both `tokenId` and `tokenSecret` are required
- **Alpha SDK**: Modal's JavaScript SDK is in alpha and may have limitations
- **Python Focus**: Modal is optimized for Python workloads

#### CodeSandbox Issues
- **API Key Required**: Must provide `CSB_API_KEY` environment variable
- **Limited Operations**: No support for listing or advanced sandbox management
- **Template Dependencies**: Some operations depend on the sandbox template

## Related Documentation

- [Overview](./overview.md) - SDK architecture and concepts
- [Sandbox Management](./sandbox-management.md) - Creating and managing sandboxes
- [Code Execution](./code-execution.md) - Running code in sandboxes
- [Filesystem](./filesystem.md) - File operations in sandboxes
- [Providers](../providers/) - Provider-specific documentation
- [Getting Started](../getting-started/installation.md) - Installation and setup
- [Quick Start](../getting-started/quick-start.md) - Get started quickly