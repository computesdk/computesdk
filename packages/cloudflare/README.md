# @computesdk/cloudflare

Cloudflare provider for ComputeSDK - execute code in secure sandboxes on Cloudflare's edge network using Durable Objects.

## Features

- **🔒 Secure Isolation**: Each sandbox runs in its own container with full process isolation
- **⚡ Edge-Native**: Runs on Cloudflare's global network for low latency worldwide  
- **📁 Full Filesystem Support**: Read, write, and manage files within the sandbox
- **🔧 Command Execution**: Run any command or process inside the container
- **🌐 Port Forwarding**: Expose services running in your sandbox via public URLs
- **🔄 Git Integration**: Clone repositories directly into sandboxes
- **🧪 Code Interpreter**: Execute Python and JavaScript with rich outputs
- **🎮 Session Management**: Maintain state across multiple operations

## Installation

```bash
npm install @computesdk/cloudflare
```

## Prerequisites

This provider requires a Cloudflare Workers environment with Durable Objects configured. You'll need:

Note: Cloudflare API key should include the following permissions:
- Workers Scripts:Edit
- Workers KV Storage:Edit
- Account Settings:Read
- Workers Scripts:Read
- Workers KV Storage:Read
- Workers Tail:Read

1. **Cloudflare Workers account** with Durable Objects enabled
2. **wrangler.toml configuration** with Sandbox Durable Object binding
3. **Dockerfile** setup (temporary requirement)

### Setup Instructions

1. **Create a Dockerfile** (temporary requirement):
```dockerfile
FROM docker.io/cloudflare/sandbox:0.3.0

# Expose the ports you want to expose
EXPOSE 3000
```

2. **Configure wrangler.toml**:
```toml
[durable_objects]
bindings = [
  { name = "Sandbox", class_name = "Sandbox" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Sandbox"]

[[containers]]
class_name = "Sandbox"
image = "./Dockerfile"
max_instances = 1
```

3. **Export the CFSandbox class in your Worker**:
```typescript
// Export the CFSandbox class in your Worker (no need to install @cloudflare/sandbox separately)
export { CFSandbox } from "@computesdk/cloudflare";

export default {
  async fetch(request: Request, env: Env) {
    // Your worker code here
  },
};
```

## Basic Usage

```typescript
import { createCompute } from 'computesdk';
import { cloudflare } from '@computesdk/cloudflare';

export { CFSandbox } from '@computesdk/cloudflare';

interface Env {
  Sandbox: any; // Your Durable Object binding
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Create compute instance with Cloudflare provider
    const compute = createCompute({ 
      provider: cloudflare({
        sandboxBinding: env.Sandbox,
        runtime: 'python',
        timeout: 300000,
        envVars: {
          MY_VAR: 'hello world'
        }
      })
    });

    // Create a sandbox
    const sandbox = await compute.sandbox.create();

    try {
      // Execute Python code
      const result = await sandbox.runCode(`
import sys
print(f"Python version: {sys.version}")
print("Hello from Cloudflare!")
`);

      // Return results
      return new Response(JSON.stringify({
        output: result.stdout,
        success: result.exitCode === 0
      }), {
        headers: { 'Content-Type': 'application/json' }
      });

    } finally {
      // Clean up
      await sandbox.destroy();
    }
  },
};
```

## Advanced Usage

### Runtime Detection

The provider automatically detects the runtime based on code content:

```typescript
// Automatically detected as Python
await sandbox.runCode('print("Hello Python")');

// Automatically detected as Node.js
await sandbox.runCode('console.log("Hello Node.js")');

// Explicitly specify runtime
await sandbox.runCode('print("Hello")', 'python');
```

### Environment Variables

```typescript
const provider = cloudflare({
  sandboxBinding: env.Sandbox,
  envVars: {
    API_KEY: 'your-api-key',
    DATABASE_URL: 'postgresql://localhost:5432/mydb',
    NODE_ENV: 'production'
  }
});
```

### Port Forwarding

```typescript
// Start a web server
await sandbox.runCode(`
const express = require('express');
const app = express();
app.get('/', (req, res) => res.json({ message: 'Hello from Cloudflare!' }));
app.listen(8080);
`);

// Get public URL
const url = await sandbox.getUrl({ port: 8080, protocol: 'https' });
console.log(`API available at: ${url}`);
```

### File System Operations

```typescript
// Create directories
await sandbox.filesystem.mkdir('/app');

// Write files
await sandbox.filesystem.writeFile('/app/package.json', JSON.stringify({
  name: 'my-app',
  version: '1.0.0'
}, null, 2));

// Read files
const packageJson = await sandbox.filesystem.readFile('/app/package.json');
const config = JSON.parse(packageJson);

// List directory contents
const files = await sandbox.filesystem.readdir('/app');
files.forEach(file => {
  console.log(`${file.name} (${file.isDirectory ? 'dir' : 'file'})`);
});

// Check if file exists
if (await sandbox.filesystem.exists('/app/package.json')) {
  console.log('Package.json found!');
}

// Remove files/directories
await sandbox.filesystem.remove('/app/temp');
```

### Git Operations

```typescript
// Clone a repository
await sandbox.runCode(`
import subprocess
result = subprocess.run([
  'git', 'clone', 'https://github.com/user/repo.git', '/app'
], capture_output=True, text=True)
print(result.stdout)
`);

// Or using the built-in git functionality (if available)
const result = await sandbox.runCommand('git', [
  'clone', 
  'https://github.com/user/repo.git', 
  '/app'
]);
```

## Configuration Options

```typescript
interface CloudflareConfig {
  /** Cloudflare Sandbox binding from Workers environment (required) */
  sandboxBinding: any;
  
  /** Default runtime environment */
  runtime?: 'python' | 'node';
  
  /** Execution timeout in milliseconds (default: 300000) */
  timeout?: number;
  
  /** Environment variables to pass to sandbox */
  envVars?: Record<string, string>;
  
  /** Base URL for preview URLs (defaults to worker domain) */
  baseUrl?: string;
}
```

## Error Handling

```typescript
try {
  const result = await sandbox.runCode('invalid python syntax');
} catch (error) {
  if (error.message.includes('Syntax error')) {
    console.log('Code has syntax errors');
  } else {
    console.log('Execution failed:', error.message);
  }
}
```

## Limitations

- Requires Cloudflare Workers environment with Durable Objects
- Container setup currently requires Docker configuration
- Resource limits apply based on your Cloudflare plan
- Some system calls may be restricted in the container environment

## Examples

Check out the [examples directory](../../examples) for complete working examples:

- **Basic Usage**: Simple code execution
- **Web Server**: Express.js app with public URLs
- **Data Processing**: Python data analysis with file I/O
- **CI/CD**: Automated testing and building

## License

MIT

## Contributing

See the [main repository](https://github.com/computesdk/computesdk) for contribution guidelines.