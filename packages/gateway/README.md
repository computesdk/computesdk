# @computesdk/gateway

Infrastructure provider implementations for the ComputeSDK gateway server.

## Purpose

This package contains infrastructure-only provider implementations used by the ComputeSDK gateway server to provision compute resources.

**⚠️ This package is intended for internal use by the gateway server.** End users should import from provider-specific packages like `@computesdk/railway` instead.

## What's in here?

- **Railway** - GraphQL API for creating/destroying Railway services

Additional providers (Vercel, Render, Namespace, etc.) will be added as needed.

Each provider exposes only infrastructure methods:
- `create()` - Provision compute resource
- `destroy()` - Tear down resource
- `getById()` - Get resource by ID
- `list()` - List resources

These methods do NOT include sandbox operations like `runCode()` or `filesystem` access. The gateway server adds those capabilities by installing the ComputeSDK daemon.

## Usage (Gateway Server Only)

```typescript
import { railway } from '@computesdk/gateway';

const provider = railway({ 
  apiKey: 'railway_xxx',
  projectId: 'project_xxx',
  environmentId: 'env_xxx'
});

// Create infrastructure with daemon pre-installed
const instance = await provider.create({
  daemonConfig: {
    accessToken: 'token_xxx',
    gatewayUrl: 'https://gateway.computesdk.com'
  }
});
```

## For End Users

If you're an end user looking to use Railway (or other infrastructure providers) as a sandbox, import from the provider-specific package instead:

```typescript
import { railway } from '@computesdk/railway';

const compute = railway({ 
  apiKey: 'railway_xxx',
  projectId: 'project_xxx',
  environmentId: 'env_xxx'
});

// Full sandbox API available (routes through gateway)
const sandbox = await compute.sandbox.create();
await sandbox.runCode('console.log("hello")');
```

## Architecture

```
User App                    Gateway Server              Infrastructure
┌─────────────┐            ┌──────────────┐            ┌──────────────┐
│ @computesdk/│            │ @computesdk/ │            │   Railway    │
│  railway    │───────────>│   gateway    │───────────>│   GraphQL    │
│             │  HTTP API  │              │  Direct    │     API      │
│ (wrapper)   │            │ (infra impl) │            │              │
└─────────────┘            └──────────────┘            └──────────────┘
```

## License

MIT
