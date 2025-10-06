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