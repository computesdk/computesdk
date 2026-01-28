---
title: "Announcing ComputeSDK 2.0 with Sandbox Gateway"
description: "Version 2 of ComputeSDK now includes our Sandbox Gateway, which allows you to use any sandbox or cloud provider without changing a single line of code."
date: "2026-01-29"
tags: [sandboxes, developer-tools, providers]
author: "Garrison Snelling"
role: "Founder, ComputeSDK"
image: "/Garrison-Snelling-sq.jpeg"
featured: true
---
## Improving sandbox management

We believe that sandboxes are the next primitive of compute, much like containers were a decade ago. When we started ComputeSDK, our goal was to make the universal interface for the sandbox primitive. Version 1.0 was an SDK that allowed developers to use our unified SDK across many sandbox providers with minimal changes to their codebase.

However, version 1 of our SDK was limited by existing sandbox providers. We realized that many people don't just want to use existing sandbox companies (E2B, Daytona, Modal), but would prefer to use their existing cloud infrastructure (Railway, AWS, GCP, etc).

Back in November, we [launched](https://www.computesdk.com/blog/november-2025-update/) our own daemon that allowed all of those cloud providers to have the same universal interface as the sandbox providers do. This was a huge step in the right direction. But we still needed an orchestration layer so that we could realize our vision of being able to run sandboxes *literally* anywhere.

## The new Sandbox Gateway

So, today we are excited to introduce version 2 of ComputeSDK, which has our Sandbox Gateway built into it as a first-class citizen. Our Sandbox Gateway allows you to use the same implementation with ANY provider, including your existing cloud infrastructure.

**Today, the Gateway is fully BYOK (Bring Your Own Keys).** You provide your provider credentials, and ComputeSDK handles the rest—orchestration, lifecycle management, and a unified API across all providers. This means you maintain full control over your infrastructure and billing relationships. Just set your environment variables and go.

We're starting with BYOK because it gives you maximum flexibility, but we're exploring ways to make getting started even simpler in the future. Stay tuned.

We currently support **8 providers** out of the box: E2B, Modal, Railway, Vercel, Daytona, Render, Blaxel, and Namespace—with more on the way.

```javascript
import { compute } from 'computesdk';

// ComputeSDK Gateway auto-detects provider from environment variables
const sandbox = await compute.sandbox.create();

const result = await sandbox.run.code('print("Hello!")');
console.log(result.output); // "Hello!"

await sandbox.destroy();
```

For more advanced use cases, you can use `setConfig()` to explicitly configure your provider:

```javascript
import { compute } from 'computesdk';

// Explicit configuration
compute.setConfig({
  provider: 'e2b',
  e2b: { apiKey: process.env.E2B_API_KEY }
});

const sandbox = await compute.sandbox.create();
```

## More sandbox features in v2.0

### Namespaces

Namespaces allow you to organize sandboxes by user, project, or any entity you choose. Combined with named sandboxes, this enables powerful patterns like idempotent creation—if a sandbox already exists for that namespace and name, we'll return the existing one instead of creating a duplicate.

```javascript
// Create or retrieve an existing sandbox for this user's project
const sandbox = await compute.sandbox.findOrCreate({
  name: projectId,
  namespace: userId,
});
```

### Servers

Servers are supervised processes inside a sandbox with full lifecycle management. They support install commands that run before starting (perfect for `npm install`), automatic restarts with configurable policies, health checks for readiness detection, and graceful shutdown with SIGTERM/SIGKILL handling.

```javascript
await sandbox.server.start({
  slug: 'react',
  install: 'npm install',        // Runs blocking before start
  start: 'npm run dev',
  path: './react',
  restart_policy: 'on-failure',  // Also: 'never', 'always'
  health_check: {
    path: '/',
    interval_ms: 2000,
  },
});
```

### Overlays

Overlays allow you to instantly bootstrap a sandbox from a template directory. With the `smart` strategy, overlays use symlinks for immutable packages (like `node_modules`) giving you near-instant setup, while heavier directories are copied in the background. You can poll the copy status or wait for completion.

```javascript
await sandbox.filesystem.overlay.create({
  source: '/template/react',
  target: './react',
  strategy: 'smart',           // Instant symlinks + background copy
  waitForCompletion: true,     // Optional: block until fully copied
});
```

### Client-Side Access with Delegated Tokens

Building a web app that needs browser access to sandboxes? ComputeSDK v2 includes a complete authentication system for delegating access to your users without exposing your API keys.

**Session tokens** are scoped credentials you create server-side and pass to your frontend:

```javascript
// Server-side: create a delegated token
const session = await sandbox.sessionToken.create({
  description: 'User session',
  expiresIn: 86400, // 24 hours
});

// Pass session.token to your frontend
```

**Magic links** are even simpler—one-time URLs that automatically authenticate users in the browser:

```javascript
// Generate a magic link that redirects to your app
const link = await sandbox.magicLink.create({
  redirectUrl: '/workspace',
});

// Send link.url to your user (email, redirect, etc.)
// They click it, get a session cookie, and land authenticated
```

Once authenticated, browser clients can use the full SDK—terminals, file watchers, signals—all over WebSocket with automatic reconnection.

### Putting it all together

Here's a complete example showing namespaces, servers, and overlays working together on sandbox creation:

```javascript
const sandbox = await compute.sandbox.create({
  name: projectId,
  namespace: userId,
  directory: '/home/workspace',
  overlays: [{
    source: '/template/react',
    target: './react',
    strategy: 'smart',
  }],
  servers: [{
    slug: 'react',
    install: 'npm install',
    start: 'npm run dev',
    path: './react',
    restart_policy: 'on-failure',
  }],
});

// Server URL is available once the port is detected
const server = await sandbox.server.retrieve('react');
console.log(server.url); // https://react-abc123.sandbox.computesdk.com
```

We're excited to keep improving your sandbox experience!

— Garrison Snelling & The ComputeSDK Team

---

*Thanks for reading!*
<br>
*Find more in our [Documentation](https://www.computesdk.com/docs/getting-started/introduction)*
<br>
*[Contact Us](https://www.computesdk.com/contact) with any questions*
<br>
Follow us on [X](https://x.com/computesdk) to stay updated as we add more providers and features.
<br>
We are happy to talk with you if you have any questions or feedback!
