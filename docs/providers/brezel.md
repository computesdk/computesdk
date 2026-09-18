---
description: >-
  Brezel provider for ComputeSDK — self-hosted Firecracker sandboxes backed by
  operator-qualified immutable environments.
---

# Brezel

[Brezel](https://github.com/infercrane/brezel) is an open-source, self-hosted
Firecracker sandbox runtime for autonomous agents.

## Installation

```bash
npm install computesdk @computesdk/brezel
```

Configure a project-scoped service token, the public HTTPS endpoint, and a
prequalified immutable environment revision:

```bash
BREZEL_API_KEY=your_project_scoped_token
BREZEL_API_URL=https://brezel.example.com
BREZEL_PROJECT_ID=agents
BREZEL_ENVIRONMENT_REVISION=envr_qualified
BREZEL_ALLOW_INTERNET=false
```

## Usage

```typescript
import { brezel } from '@computesdk/brezel';

const compute = brezel({
  apiKey: process.env.BREZEL_API_KEY,
  baseUrl: process.env.BREZEL_API_URL,
  project: process.env.BREZEL_PROJECT_ID,
  environmentRevision: process.env.BREZEL_ENVIRONMENT_REVISION,
  allowInternet: false,
});

const sandbox = await compute.sandbox.create();
const result = await sandbox.runCommand('node --version');
console.log(result.stdout);
await sandbox.destroy();
```

## Supported operations

| Method       | Supported | Notes |
| ------------ | --------- | ----- |
| `create`     | ✅ | Uses a prequalified immutable environment revision. |
| `getById`    | ✅ | Returns `null` for absent or terminal sandboxes. |
| `list`       | ✅ | Lists active sandboxes in the configured project. |
| `destroy`    | ✅ | Waits for a confirmed terminal state or resource absence. |
| `runCommand` | ✅ | Supports `env`, `cwd`, background execution, and output callbacks. |
| `getInfo`    | ✅ | Includes the environment revision and Brezel resource revision. |
| `getUrl`     | ✅ | Creates a time-limited preview lease for a guest port. |
| `filesystem` | ✅ | Native file reads/writes plus directory operations. |
| `snapshot`   | ❌ | Not exposed through ComputeSDK yet. |

`templateId` may override the configured immutable environment revision for a
single create call. Arbitrary image builds are intentionally outside the
request path.
