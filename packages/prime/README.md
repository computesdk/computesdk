# @computesdk/prime

Prime Intellect Sandboxes provider for ComputeSDK.

## Installation

```bash
npm install @computesdk/prime
```

## Setup

Set your Prime API key:

```bash
export PRIME_API_KEY=your_prime_api_key
```

Optional:

```bash
export PRIME_TEAM_ID=team_id
export PRIME_API_BASE_URL=https://api.primeintellect.ai
export PRIME_SANDBOX_IMAGE=node:22
export PRIME_SANDBOX_CPU_CORES=1
export PRIME_SANDBOX_MEMORY_GB=2
export PRIME_SANDBOX_DISK_SIZE_GB=5
export PRIME_SANDBOX_TIMEOUT_MINUTES=15
```

## Usage

```typescript
import { prime } from '@computesdk/prime';

const compute = prime({
  apiKey: process.env.PRIME_API_KEY,
  teamId: process.env.PRIME_TEAM_ID,
});

const sandbox = await compute.sandbox.create({ runtime: 'node' });
const result = await sandbox.runCommand('node -v');

console.log(result.stdout);

await sandbox.destroy();
```

## Notes

- Sandboxes are created through Prime's `/api/v1/sandbox` API.
- Command execution uses Prime's `/sandbox/{id}/auth` endpoint plus the gateway `/exec` endpoint.
- `getUrl()` uses Prime's port exposure API and reuses existing exposures when possible.
- Filesystem methods are not implemented in this provider.
