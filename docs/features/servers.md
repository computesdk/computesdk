# Managed Servers

ComputeSDK v2 includes a powerful server management system for running long-lived processes inside sandboxes. Servers support install commands, restart policies, health checks, and graceful shutdown—everything you need for production-grade dev server management.

## Overview

Managed servers are supervised processes that:
- Run install commands before starting (e.g., `npm install`)
- Automatically restart based on configurable policies
- Expose health checks for readiness detection
- Handle graceful shutdown with SIGTERM/SIGKILL
- Provide public URLs for accessing the server

## Basic Usage

```typescript
import { compute } from 'computesdk';

const sandbox = await compute.sandbox.create();

// Start a simple server
const server = await sandbox.server.start({
  slug: 'web',
  start: 'npm run dev',
  path: '/app',
});

console.log(server.slug);    // 'web'
console.log(server.status);  // 'starting' -> 'running' -> 'ready'
console.log(server.url);     // Public URL when ready
```

## Install Commands

Run installation commands before starting the server. The server status will be `installing` during this phase.

```typescript
const server = await sandbox.server.start({
  slug: 'web',
  install: 'npm install',        // Runs first, blocking
  start: 'npm run dev',          // Runs after install completes
  path: '/app',
});

// Status progression: installing -> starting -> running -> ready
```

### Use Cases

```typescript
// Node.js project
await sandbox.server.start({
  slug: 'node-app',
  install: 'npm install',
  start: 'npm start',
});

// Python project
await sandbox.server.start({
  slug: 'python-app',
  install: 'pip install -r requirements.txt',
  start: 'python app.py',
});

// Multiple install steps (use && to chain)
await sandbox.server.start({
  slug: 'fullstack',
  install: 'npm install && npm run build',
  start: 'npm run serve',
});
```

## Restart Policies

Control how servers restart when they exit.

| Policy | Behavior |
|--------|----------|
| `never` (default) | No automatic restart |
| `on-failure` | Restart only on non-zero exit code |
| `always` | Restart on any exit (including exit code 0) |

```typescript
// Restart on crashes only
await sandbox.server.start({
  slug: 'api',
  start: 'node server.js',
  restart_policy: 'on-failure',
  max_restarts: 5,           // Give up after 5 restarts
  restart_delay_ms: 2000,    // Wait 2 seconds between restarts
});

// Always keep running (like a daemon)
await sandbox.server.start({
  slug: 'worker',
  start: 'node worker.js',
  restart_policy: 'always',
  max_restarts: 0,           // Unlimited restarts
});
```

### Checking Restart Count

```typescript
const server = await sandbox.server.retrieve('api');
console.log(server.restart_count);  // Number of restarts so far
```

## Health Checks

Health checks verify your server is actually ready to handle requests. The server status only becomes `ready` after the health check passes.

```typescript
await sandbox.server.start({
  slug: 'web',
  start: 'npm run dev',
  health_check: {
    path: '/health',        // HTTP path to check
    interval_ms: 5000,      // Check every 5 seconds
    timeout_ms: 3000,       // Timeout for each check
    delay_ms: 2000,         // Wait before first check
  },
});
```

### Health Check Status

```typescript
const server = await sandbox.server.retrieve('web');
console.log(server.healthy);        // true | false
console.log(server.health_status);  // 'healthy' | 'unhealthy' | 'checking'
```

### Common Health Check Patterns

```typescript
// Express.js health endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Next.js - check the root page
health_check: { path: '/' }

// API with database - check a /ready endpoint
health_check: { path: '/ready' }
```

## Port Configuration

Request a specific port for your server:

```typescript
await sandbox.server.start({
  slug: 'api',
  start: 'node server.js',
  port: 3000,              // Request port 3000
  strict_port: false,      // If taken, use next available (default)
});

// Fail if port is taken
await sandbox.server.start({
  slug: 'api',
  start: 'node server.js',
  port: 3000,
  strict_port: true,       // Fail if port 3000 is not available
});
```

## Environment Variables

Pass environment variables to your server:

```typescript
// Inline environment variables
await sandbox.server.start({
  slug: 'api',
  start: 'node server.js',
  environment: {
    NODE_ENV: 'production',
    PORT: '3000',
    DEBUG: 'app:*',
  },
});

// From a .env file
await sandbox.server.start({
  slug: 'api',
  start: 'node server.js',
  env_file: '.env.production',
});

// Both (inline takes precedence)
await sandbox.server.start({
  slug: 'api',
  start: 'node server.js',
  env_file: '.env',
  environment: {
    DEBUG: 'true',  // Overrides .env if present
  },
});
```

## Graceful Shutdown

Configure how servers are stopped:

```typescript
await sandbox.server.start({
  slug: 'api',
  start: 'node server.js',
  stop_timeout_ms: 15000,  // Wait 15 seconds for graceful shutdown
});
```

Shutdown sequence:
1. Send SIGTERM
2. Wait `stop_timeout_ms` for process to exit gracefully
3. Send SIGKILL if still running

## Server Lifecycle

### Starting Servers

```typescript
const server = await sandbox.server.start({ /* options */ });
```

### Listing Servers

```typescript
const servers = await sandbox.server.list();
servers.forEach(s => {
  console.log(`${s.slug}: ${s.status} at ${s.url || 'no URL yet'}`);
});
```

### Getting Server Info

```typescript
const server = await sandbox.server.retrieve('api');
console.log(server.status);       // Current status
console.log(server.url);          // Public URL
console.log(server.port);         // Assigned port
console.log(server.pid);          // Process ID
console.log(server.healthy);      // Health check status
console.log(server.restart_count);
```

### Stopping Servers

```typescript
// Stop (graceful shutdown, keeps config)
await sandbox.server.stop('api');

// Delete (stops and removes config)
await sandbox.server.delete('api');
```

### Restarting Servers

```typescript
const server = await sandbox.server.restart('api');
console.log(server.status);  // 'starting'
```

### Server Logs

```typescript
// Get combined logs
const logs = await sandbox.server.logs('api');
console.log(logs.logs);

// Get stdout only
const stdout = await sandbox.server.logs('api', { stream: 'stdout' });

// Get stderr only
const stderr = await sandbox.server.logs('api', { stream: 'stderr' });
```

## Creating Servers with Sandboxes

You can define servers when creating a sandbox:

```typescript
const sandbox = await compute.sandbox.create({
  servers: [{
    slug: 'web',
    install: 'npm install',
    start: 'npm run dev',
    path: '/app',
    restart_policy: 'on-failure',
    health_check: {
      path: '/',
      interval_ms: 5000,
    },
  }],
});
```

## Combining with Overlays

Use overlays to set up the project, then start the server:

```typescript
const sandbox = await compute.sandbox.create({
  overlays: [{
    source: '/templates/nextjs',
    target: '/app',
    strategy: 'smart',
  }],
  servers: [{
    slug: 'dev',
    install: 'npm install',
    start: 'npm run dev',
    path: '/app',
    health_check: { path: '/' },
  }],
});

// Server automatically waits for overlay to complete
```

Or use inline overlays with `server.start()`:

```typescript
await sandbox.server.start({
  slug: 'web',
  start: 'npm run dev',
  path: '/app',
  overlay: {
    source: '/templates/react',
    target: '/app',
    strategy: 'smart',
  },
});
```

## Complete Example

```typescript
import { compute } from 'computesdk';

// Create a production-ready development environment
const sandbox = await compute.sandbox.create();

// Start a Next.js dev server with full configuration
const server = await sandbox.server.start({
  slug: 'nextjs',
  
  // Installation
  install: 'npm install',
  
  // Start command
  start: 'npm run dev',
  path: '/app',
  
  // Port configuration
  port: 3000,
  
  // Environment
  environment: {
    NODE_ENV: 'development',
    NEXT_PUBLIC_API_URL: 'https://api.example.com',
  },
  
  // Reliability
  restart_policy: 'on-failure',
  max_restarts: 3,
  restart_delay_ms: 1000,
  stop_timeout_ms: 10000,
  
  // Health monitoring
  health_check: {
    path: '/',
    interval_ms: 5000,
    timeout_ms: 3000,
    delay_ms: 5000,  // Wait for Next.js to compile
  },
});

// Wait for server to be ready
while (server.status !== 'ready') {
  await new Promise(r => setTimeout(r, 1000));
  const updated = await sandbox.server.retrieve('nextjs');
  console.log(`Status: ${updated.status}`);
}

console.log(`Server ready at: ${server.url}`);
```
