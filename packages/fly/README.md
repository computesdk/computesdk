# @computesdk/fly

Fly.io provider for ComputeSDK that enables creating and managing containerized sandboxes on Fly.io infrastructure.

## Installation

```bash
npm install @computesdk/fly
```

## Configuration

The Fly.io provider requires the following environment variables:

```bash
FLY_API_TOKEN=your_fly_api_token
FLY_ORG=your_organization_slug # optional, defaults to 'personal'
FLY_REGION=your_preferred_region # optional, defaults to 'iad'
```

## Usage

### Gateway Mode (Recommended)

Use the gateway for zero-config auto-detection:

```typescript
import { compute } from 'computesdk';

// Auto-detects Fly.io from FLY_API_TOKEN environment variable
const sandbox = await compute.sandbox.create();
console.log(`Created machine: ${sandbox.id}`);

// List all machines
const machines = await compute.sandbox.list();

// Destroy the machine
await sandbox.destroy();
```

### Direct Mode

For direct SDK usage without the gateway:

```typescript
import { fly } from '@computesdk/fly';

const compute = fly({
  apiToken: 'your_api_token', // optional, uses FLY_API_TOKEN env var
  appName: 'my-app',          // optional, defaults to 'computesdk'
  org: 'my-org',             // optional, defaults to 'personal'
  region: 'iad'              // optional, defaults to 'iad'
});

// Create a machine (not an app)
const sandbox = await compute.sandbox.create({ runtime: 'node' });
console.log(`Created machine: ${sandbox.id}`);

// List all machines in the app
const machines = await compute.sandbox.list();

// Destroy the machine (app remains)
await sandbox.destroy();
```

## Currently Implemented

### Machine Operations
- **create()** - Creates a new Fly.io machine in the specified app
- **getById()** - Retrieves a specific machine by ID
- **list()** - Lists all machines in the configured app
- **destroy()** - Destroys a machine (preserves the app)

### Supported Runtimes
- **node** - Uses `node:alpine` image with HTTP server
- **python** - Uses `python:alpine` image with HTTP server
- **default** - Uses `docker.io/traefik/whoami` image

### Configuration Options
- **apiToken** - Fly.io API authentication token
- **appName** - Fly.io app name (defaults to 'computesdk')
- **org** - Organization slug (defaults to 'personal')
- **region** - Deployment region (defaults to 'iad')
- **apiHostname** - API endpoint (defaults to 'https://api.machines.dev')

## Architecture

### App vs Machine Management
- **App**: Persistent infrastructure created once per `appName`
- **Machine**: Ephemeral compute resources created/destroyed per sandbox
- The app is created automatically if it doesn't exist
- Multiple machines can exist within a single app
- Destroying a machine preserves the app for future use

### Machine Configuration
- **CPU**: 1 shared core
- **Memory**: 256MB
- **Network**: Automatic private IP assignment
- **Lifecycle**: Machines include init commands to stay running

## Notes

- All operations use the Fly.io Machines REST API
- Apps are created automatically if they don't exist
- Only machines are destroyed, apps persist for reuse
- Machine names are auto-generated with timestamps for uniqueness
- Environment variables take precedence over config options