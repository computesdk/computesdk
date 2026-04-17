# compute


## Overview
The ComputeSDK is a unified interface for managing compute sandboxes. Import a provider package and initialize it directly with your credentials.

## Installation

```bash
npm install computesdk @computesdk/e2b  # or your chosen provider package
```

## Quick Start

```typescript
import { e2b } from '@computesdk/e2b';

const compute = e2b({ apiKey: process.env.E2B_API_KEY });

const sandbox = await compute.sandbox.create();
const result = await sandbox.runCode('print("Hello!")');
console.log(result.output);
await sandbox.destroy();
```

## Provider-specific env variables

Each provider requires its own API key set as an environment variable. See your provider's documentation for details.

```bash
PROVIDER_API_KEY=your_provider_api_key_here
```

---

## `compute.sandbox` methods

- [compute.sandbox](./computesandbox)


## Sandbox (interface)
- [Sandbox](./sandbox)
