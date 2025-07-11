# @computesdk/cloudflare

Cloudflare provider for ComputeSDK - Execute Node.js and Python code in secure, isolated Cloudflare Workers sandboxes using Durable Objects.

## Installation

```bash
npm install @computesdk/cloudflare
```

## Setup

⚠️ **Important**: This provider can only be used within Cloudflare Workers environment. It requires:

1. **Cloudflare Workers account** with Durable Objects enabled
2. **Durable Object binding** in your `wrangler.toml`
3. **@cloudflare/sandbox** package for execution

### wrangler.toml Configuration

```toml
name = "my-worker"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[durable_objects]
bindings = [
  { name = "Sandbox", class_name = "SandboxDurableObject" }
]

[[durable_objects.migrations]]
tag = "v1"
new_classes = ["SandboxDurableObject"]
```

### Worker Environment Setup

```typescript
// In your Cloudflare Worker
export interface Env {
  Sandbox: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Your worker code here
  }
};
```

## Usage

### Basic Usage

```typescript
import { cloudflare } from '@computesdk/cloudflare';

// Within a Cloudflare Worker
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const provider = cloudflare({ env });

    // Execute Python code (default)
    const result = await provider.doExecute('print("Hello from Cloudflare!")');
    console.log(result.stdout); // "Hello from Cloudflare!"

    // Execute Node.js code
    const nodeResult = await provider.doExecute('console.log("Hello from Node!");', 'node');
    console.log(nodeResult.stdout); // "Hello from Node!"

    return new Response(JSON.stringify(result));
  }
};
```

### With ComputeSDK

```typescript
import { executeSandbox } from 'computesdk';
import { cloudflare } from '@computesdk/cloudflare';

// Within a Cloudflare Worker
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const result = await executeSandbox({
      sandbox: cloudflare({ env }),
      code: 'print("Hello World")',
      runtime: 'python'
    });

    return new Response(JSON.stringify(result));
  }
};
```

### Configuration

```typescript
import { cloudflare } from '@computesdk/cloudflare';

const provider = cloudflare({
  env,                  // Required: Cloudflare Workers environment
  timeout: 300000,      // Optional: 5 minutes (default)
});
```

## API Reference

### `cloudflare(config)`

Creates a new Cloudflare provider instance.

#### Parameters

- `config`: Configuration object
  - `env`: **Required** - Cloudflare Workers environment with Sandbox binding
  - `timeout`: Optional - Execution timeout in milliseconds (default: 300000)

#### Returns

`CloudflareProvider` instance implementing the `ComputeSpecification` interface.

### Provider Methods

#### `doExecute(code: string, runtime?: Runtime): Promise<ExecutionResult>`

Execute code in the Cloudflare sandbox.

```typescript
// Python execution (default)
const result = await provider.doExecute('print("Hello")');

// Node.js execution
const result = await provider.doExecute('console.log("Hello")', 'node');
```

#### `doKill(): Promise<void>`

Terminates the Cloudflare sandbox session. Note: Cloudflare sandboxes are ephemeral and auto-cleanup.

```typescript
await provider.doKill();
```

#### `doGetInfo(): Promise<SandboxInfo>`

Get information about the sandbox.

```typescript
const info = await provider.doGetInfo();
// info.provider: "cloudflare"
// info.runtime: "python"
// info.status: "running" | "stopped"
```

## Platform Requirements

### Cloudflare Workers Environment

This provider includes automatic platform detection and will throw an error if not running in a Cloudflare Workers environment:

```typescript
// ❌ This will throw an error outside Cloudflare Workers
const provider = cloudflare({ env });
// Error: Cloudflare provider can only be used within Cloudflare Workers environment
```

### Required Environment Objects

The provider checks for these Cloudflare Workers global objects:
- `DurableObject`
- `WebSocketPair` 
- `caches`

## Error Handling

The provider includes comprehensive error handling:

### Platform Errors

```typescript
// Not in Cloudflare Workers
Error: Cloudflare provider can only be used within Cloudflare Workers environment. Deploy your code to Cloudflare Workers or use a universal provider like E2B or Vercel.

// Missing Durable Object binding
Error: Cloudflare provider requires env.Sandbox (Durable Object namespace). Make sure your wrangler.toml includes the Sandbox durable object binding.
```

### Runtime Errors

```typescript
// Unsupported runtime
Error: Unsupported runtime: ruby. Cloudflare sandbox supports python and node.

// Execution timeout
Error: Execution timed out after 300000ms

// Sandbox initialization failed
Error: Failed to initialize Cloudflare sandbox: [error details]
```

## Examples

### Python Data Processing

```typescript
import { cloudflare } from '@computesdk/cloudflare';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const provider = cloudflare({ env });

    const code = `
import json
import statistics
from datetime import datetime

# Sample data processing
data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

result = {
    "count": len(data),
    "sum": sum(data),
    "average": statistics.mean(data),
    "median": statistics.median(data),
    "timestamp": datetime.now().isoformat()
}

print(json.dumps(result, indent=2))
`;

    const result = await provider.doExecute(code);
    
    return new Response(result.stdout, {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
```

### Node.js API Processing

```typescript
import { cloudflare } from '@computesdk/cloudflare';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const provider = cloudflare({ env });

    const code = `
const data = {
  users: [
    { id: 1, name: 'Alice', age: 30 },
    { id: 2, name: 'Bob', age: 25 },
    { id: 3, name: 'Charlie', age: 35 }
  ]
};

// Process user data
const summary = {
  totalUsers: data.users.length,
  averageAge: data.users.reduce((sum, user) => sum + user.age, 0) / data.users.length,
  names: data.users.map(user => user.name),
  timestamp: new Date().toISOString()
};

console.log(JSON.stringify(summary, null, 2));
`;

    const result = await provider.doExecute(code, 'node');
    
    return new Response(result.stdout, {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
```

### Request Processing Worker

```typescript
import { cloudflare } from '@computesdk/cloudflare';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const provider = cloudflare({ env });

    // Get code from request body
    const { code, runtime } = await request.json();

    try {
      const result = await provider.doExecute(code, runtime);
      
      return new Response(JSON.stringify({
        success: true,
        result: {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          executionTime: result.executionTime
        }
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error.message
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
```

## Runtime Support

### Python Runtime

- **Default Runtime**: Python is the default when no runtime is specified
- **Version**: Python 3.x (exact version depends on Cloudflare's runtime)
- **Libraries**: Standard library available
- **Execution**: `python3 -c "code"`

### Node.js Runtime

- **Explicit Runtime**: Must specify `runtime: 'node'`
- **Version**: Node.js (version depends on Cloudflare's runtime)
- **Libraries**: Standard library available
- **Execution**: `node -e "code"`

## Unique Features

### Durable Object Integration

- **Persistence**: Sandboxes use Durable Objects for state management
- **Isolation**: Each sandbox gets its own isolated execution environment
- **Scalability**: Automatically scales with Cloudflare's edge network

### Edge Computing

- **Global Distribution**: Runs on Cloudflare's global edge network
- **Low Latency**: Executes close to users worldwide
- **High Availability**: Built-in redundancy and failover

### Platform-Specific Benefits

- **No Cold Starts**: Durable Objects provide warm execution contexts
- **Automatic Cleanup**: Sandboxes clean up automatically after requests
- **Cost Effective**: Pay only for actual execution time

## Limitations

- **Platform Specific**: Only works within Cloudflare Workers environment
- **Durable Object Required**: Requires Durable Object bindings in wrangler.toml
- **Two Runtimes**: Only Python and Node.js are supported
- **Ephemeral Storage**: Files don't persist between executions
- **Network Restrictions**: Subject to Cloudflare Workers network limitations

## Best Practices

1. **Environment Setup**: Always configure Durable Object bindings correctly
2. **Error Handling**: Use try-catch blocks for robust error handling
3. **Timeout Management**: Set appropriate timeouts for your use case
4. **Resource Cleanup**: Call `doKill()` when done (though auto-cleanup occurs)
5. **Runtime Selection**: Choose the appropriate runtime for your use case
6. **Platform Detection**: Let the provider handle platform validation

## Deployment

### wrangler.toml Example

```toml
name = "computesdk-worker"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[durable_objects]
bindings = [
  { name = "Sandbox", class_name = "SandboxDurableObject" }
]

[[durable_objects.migrations]]
tag = "v1"
new_classes = ["SandboxDurableObject"]
```

### Deploy to Cloudflare

```bash
npm install -g wrangler
wrangler login
wrangler deploy
```

## Troubleshooting

### Common Issues

1. **Platform Detection Failed**: Ensure you're running in Cloudflare Workers
2. **Missing Durable Object**: Check your wrangler.toml configuration
3. **Sandbox Initialization**: Verify @cloudflare/sandbox package is available
4. **Runtime Errors**: Check runtime parameter is 'python' or 'node'

### Debug Information

```typescript
import { cloudflare } from '@computesdk/cloudflare';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const provider = cloudflare({ env });

    // Get sandbox information
    const info = await provider.doGetInfo();
    console.log('Sandbox Info:', info);

    // Check execution results
    const result = await provider.doExecute('print("Debug test")');
    console.log('Exit Code:', result.exitCode);
    console.log('Execution Time:', result.executionTime, 'ms');

    return new Response(JSON.stringify({ info, result }));
  }
};
```

## Integration Examples

### With Hono Framework

```typescript
import { Hono } from 'hono';
import { cloudflare } from '@computesdk/cloudflare';

const app = new Hono<{ Bindings: Env }>();

app.post('/execute', async (c) => {
  const provider = cloudflare({ env: c.env });
  const { code, runtime } = await c.req.json();
  
  const result = await provider.doExecute(code, runtime);
  return c.json(result);
});

export default app;
```

### With Workers Router

```typescript
import { Router } from 'itty-router';
import { cloudflare } from '@computesdk/cloudflare';

const router = Router();

router.post('/api/execute', async (request, env) => {
  const provider = cloudflare({ env });
  const { code, runtime } = await request.json();
  
  const result = await provider.doExecute(code, runtime);
  return new Response(JSON.stringify(result));
});

export default { fetch: router.handle };
```

## Support

- Cloudflare Workers Documentation: [developers.cloudflare.com/workers](https://developers.cloudflare.com/workers/)
- Durable Objects Guide: [developers.cloudflare.com/durable-objects](https://developers.cloudflare.com/durable-objects/)
- ComputeSDK Issues: [GitHub Issues](https://github.com/computesdk/computesdk/issues)
- Cloudflare Support: [support.cloudflare.com](https://support.cloudflare.com/)

## License

MIT