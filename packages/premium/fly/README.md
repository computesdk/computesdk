# Fly.io Provider for ComputeSDK

A provider for running code sandboxes on [Fly.io](https://fly.io) using their Machines API with SSH-based command execution.

## Features

- ✅ Persistent sandbox environments with SSH access
- ✅ Multi-runtime support (Python 3 + Node.js 20)
- ✅ Fast machine startup (<1 second for existing machines)
- ✅ Global edge deployment
- ✅ File persistence between command executions
- ✅ Full shell access for package installation

## Prerequisites

1. **Fly.io Account**: Sign up at [fly.io](https://fly.io)
2. **Fly.io API Token**: Get your token from the Fly.io dashboard
3. **Custom Docker Image**: Build and deploy the SSH-enabled sandbox image

## Setup

### 1. Build the Sandbox Image

```bash
# Clone this repository
cd packages/premium/fly

# Build the Docker image
docker build -t computesdk-fly-sandbox:latest .

# Tag for Fly.io registry (replace with your organization)
docker tag computesdk-fly-sandbox:latest registry.fly.io/your-app/sandbox:latest

# Push to Fly.io registry
docker push registry.fly.io/your-app/sandbox:latest
```

### 2. Create a Fly.io App

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Create a new app (this creates the namespace for machines)
fly app create your-sandbox-app

# Note the app name for configuration
```

### 3. Configuration

```typescript
import { fly } from '@computesdk/fly';

const provider = fly({
  apiToken: 'your-fly-api-token',
  appName: 'your-sandbox-app',
  region: 'ord', // Optional: default region
  image: 'registry.fly.io/your-app/sandbox:latest' // Your custom image
});
```

## Usage

```typescript
// Create a persistent sandbox
const sandbox = await provider.sandbox.create({
  templateId: 'registry.fly.io/your-app/sandbox:latest'
});

// Execute Python code
const pythonResult = await sandbox.runCode(`
print("Hello from Python!")
import sys
print(f"Python version: {sys.version}")
`);

// Execute Node.js code
const nodeResult = await sandbox.runCode(`
console.log("Hello from Node.js!");
console.log("Node version:", process.version);
`, 'node');

// Run shell commands
const commandResult = await sandbox.runCommand('ls', ['-la']);

// Install packages and persist
await sandbox.runCommand('pip', ['install', 'requests']);
await sandbox.runCommand('npm', ['install', '-g', 'lodash']);

// Check sandbox info
const info = await sandbox.getInfo();
console.log('Sandbox ID:', info.id);
console.log('Status:', info.status);

// Clean up when done
await sandbox.destroy();
```

## Environment Variables

For convenience, you can set these environment variables:

```bash
export FLY_API_TOKEN="your-api-token"
export FLY_APP_NAME="your-app-name"
```

Then use without explicit config:

```typescript
const provider = fly({
  apiToken: process.env.FLY_API_TOKEN,
  appName: process.env.FLY_APP_NAME
});
```

## Architecture

### SSH-Based Execution
- Each machine runs an SSH server on port 22
- Commands are executed via SSH using username/password: `sandbox/sandbox`
- Output is captured and returned as ExecutionResult

### Persistent Sandboxes
- Machines stay running until explicitly destroyed
- File system persists between command executions
- Packages and dependencies remain installed

### Multi-Runtime Support
- Python 3.x with pip and common libraries
- Node.js 20.x with npm and TypeScript
- Full Ubuntu 22.04 environment with build tools

## Security Considerations

- Sandboxes use basic password authentication (suitable for ephemeral use)
- Each machine is isolated within Fly.io's infrastructure
- Consider implementing SSH key-based auth for production use
- Machines should be destroyed when no longer needed

## Cost Optimization

- Machines are billed per second while running
- Use `destroy()` to stop billing
- Consider implementing auto-stop for idle machines
- Monitor usage through Fly.io dashboard

## Testing

### Running Tests

```bash
# Run all tests (integration tests will be skipped without API credentials)
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Integration Tests

To run the full integration test suite, set your Fly.io credentials:

```bash
export FLY_API_TOKEN="your-api-token"
export FLY_ORG="your-organization"
npm test
```

The test suite includes:
- ✅ Basic provider functionality
- ✅ Code execution (Python and Node.js)
- ✅ Command execution via SSH
- ✅ Filesystem operations
- ✅ Sandbox lifecycle management
- ✅ Error handling

## Troubleshooting

### Connection Issues
- Ensure your Fly.io app exists and API token is valid
- Check that the Docker image is built and pushed correctly
- Verify SSH server is running in the container

### Command Execution Failures
- Check if the machine is fully started (may take 30-60 seconds)
- Verify SSH credentials and network connectivity
- Review Fly.io logs for machine startup issues

### Performance Issues
- Increase machine memory if needed (default: 512MB)
- Choose regions closer to your users
- Consider keeping machines running for frequently used sandboxes

## Contributing

This provider is part of the ComputeSDK premium packages. For issues and contributions:

1. Check existing issues in the [ComputeSDK repository](https://github.com/computesdk/computesdk)
2. Submit bug reports with detailed reproduction steps
3. Include Fly.io machine logs when possible

## License

MIT - See the main ComputeSDK repository for license details.