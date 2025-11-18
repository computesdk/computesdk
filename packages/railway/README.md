# Railway Provider for ComputeSDK

Railway provider for ComputeSDK, enabling cloud-based code execution through Railway's container platform.

## Features

- ✅ **Code Execution**: Run Node.js and Python code with automatic runtime detection
- ✅ **Shell Commands**: Execute shell commands with background job support
- ✅ **Filesystem Operations**: Full filesystem support (read, write, mkdir, etc.)
- ✅ **Container Isolation**: Each sandbox runs in its own Railway container
- ✅ **Auto-deployment**: Automatic container deployment and health monitoring
- ✅ **TypeScript**: Full type safety and IntelliSense support

## Installation

```bash
npm install @computesdk/railway
```

## Quick Start

```typescript
import { createCompute } from 'computesdk'
import { railway } from '@computesdk/railway'

// Initialize compute with Railway provider
const compute = createCompute({
  defaultProvider: railway({
    apiKey: process.env.RAILWAY_API_KEY!,
    projectId: process.env.RAILWAY_PROJECT_ID!,
    environmentId: 'production' // optional
  })
})

// Create a sandbox
const sandbox = await compute.sandbox.create({
  runtime: 'python',
  timeout: 60000
})

// Execute code
const result = await sandbox.runCode(`
print("Hello from Railway!")
import sys
print(f"Python version: {sys.version}")
`)

console.log(result.stdout)

// Run commands
await sandbox.runCommand('pip', ['install', 'requests'])

// Filesystem operations
await sandbox.filesystem.writeFile('/workspace/config.json', JSON.stringify({
  api: 'v1',
  endpoint: 'https://api.example.com'
}))

const config = await sandbox.filesystem.readFile('/workspace/config.json')
console.log('Config:', config)

// Clean up
await sandbox.destroy()
```

## Configuration

```typescript
interface RailwayProviderConfig {
  /** Railway API key */
  apiKey: string
  /** Railway project ID */
  projectId: string
  /** Environment ID (default: 'production') */
  environmentId?: string
}
```

## Environment Variables

You can provide configuration via environment variables:

```bash
export RAILWAY_API_KEY="your-railway-api-key"
export RAILWAY_PROJECT_ID="your-railway-project-id"
export RAILWAY_ENVIRONMENT_ID="your-railway-environment-id"  # Optional
```

## Official Docker Image

The Railway provider automatically uses an official Docker image (`ghcr.io/computesdk/railway-sandbox:latest`) that contains the sandbox execution environment. This image is:

- ✅ **Automatically managed** - No setup required from users
- ✅ **Version synchronized** - Always matches your SDK version  
- ✅ **Security maintained** - Regular updates and patches
- ✅ **Performance optimized** - Tuned for code execution workloads

**You never need to build, manage, or specify Docker images when using the Railway provider!**

## Testing

This package includes comprehensive tests that run in two modes:

### Mock Mode (Default)
Runs when Railway API credentials are not available. Uses mock implementations.

```bash
pnpm test
```

### Integration Mode  
Runs when Railway API credentials are available. Tests against real Railway API.

```bash
# Set up credentials first
export RAILWAY_API_KEY="your-api-key"
export RAILWAY_PROJECT_ID="your-project-id"

# Run integration tests
pnpm test
```

### Other Test Commands

```bash
pnpm test:watch     # Run tests in watch mode
pnpm test:coverage  # Run tests with coverage report
pnpm typecheck      # Run TypeScript type checking
```

## Development

```bash
pnpm dev            # Build in watch mode
pnpm build          # Build for production
pnpm clean          # Clean build artifacts
```

## API Reference

The Railway provider implements the full ComputeSDK provider interface:

### Sandbox Management
- `provider.sandbox.create(options?)` - Create new deployment
- `provider.sandbox.getById(id)` - Get existing deployment
- `provider.sandbox.list()` - List all deployments
- `provider.sandbox.destroy(id)` - Delete deployment

### Code Execution
- `sandbox.runCode(code, runtime?)` - Execute code with automatic runtime detection
- `sandbox.runCommand(command, args?, options?)` - Run shell commands
- `sandbox.getInfo()` - Get sandbox metadata
- `sandbox.getUrl(options)` - Get deployment URL

### Filesystem Operations
- `sandbox.filesystem.readFile(path)` - Read file contents
- `sandbox.filesystem.writeFile(path, content)` - Write file contents
- `sandbox.filesystem.mkdir(path)` - Create directory
- `sandbox.filesystem.readdir(path)` - List directory contents
- `sandbox.filesystem.exists(path)` - Check if file/directory exists
- `sandbox.filesystem.remove(path)` - Remove file/directory

## Requirements

- **Railway Account**: You need a Railway account and project
- **API Access**: Railway API key with appropriate permissions
- **Node.js**: >= 18.0.0 for development

## License

MIT License - see LICENSE file for details.