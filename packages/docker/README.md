# @computesdk/docker

Docker provider for ComputeSDK using Testcontainers.

## Installation

```bash
npm install @computesdk/docker
```

## Requirements

- Docker must be installed and running on your system
- Docker daemon must be accessible

## Usage

```typescript
import { compute } from 'computesdk';
import { docker } from '@computesdk/docker';

// Configure with Docker provider
compute.setConfig({
  provider: docker({
    image: 'node:20-alpine' // Optional: specify custom image
  })
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Execute code
const result = await sandbox.runCode('console.log("Hello from Docker!")');
console.log(result.stdout); // "Hello from Docker!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

## Configuration Options

- `image`: Docker image to use (default: 'node:20-alpine' for Node.js, 'python:3.11-alpine' for Python)
- `runtime`: Runtime environment ('node' or 'python')
- `timeout`: Execution timeout in milliseconds (default: 300000)

## Features

- ✅ Code execution (Node.js and Python)
- ✅ Shell command execution
- ✅ Filesystem operations
- ✅ Background command support
- ✅ Container lifecycle management

## License

MIT
