# @computesdk/prime

Prime Intellect sandbox provider for ComputeSDK. It creates VM or container sandboxes, runs shell commands, lists and retrieves sandboxes, and exposes ports.

## Install

```bash
npm install @computesdk/prime
```

Requires Node.js 20 or later. Set `PRIME_API_KEY` and optionally `PRIME_TEAM_ID` to bill a team instead of your personal account. The provider does not read the Prime CLI's `~/.prime/config.json`; pass credentials explicitly or set these environment variables.

## Usage

```ts
import { prime } from '@computesdk/prime';

const compute = prime({
  apiKey: process.env.PRIME_API_KEY,
  teamId: process.env.PRIME_TEAM_ID,
});

const sandbox = await compute.sandbox.create();
try {
  const result = await sandbox.runCommand('node -v');
  console.log(result.stdout);
} finally {
  await sandbox.destroy();
}
```

By default, creation uses a `node:22-bookworm` VM with 1 vCPU, 1 GB RAM, 10 GB disk, and a 60-minute lifetime. Override these with `image`, `cpuCores`, `memoryGb`, `diskSizeGb`, and `timeoutMinutes`; use `vm: false` for a container sandbox. `baseUrl` defaults to `https://api.primeintellect.ai` and also accepts `PRIME_API_BASE_URL` or `PRIME_BASE_URL`.

`create`, `getById`, `list`, `destroy`, `runCommand`, `getInfo`, and `getUrl` are supported. ComputeSDK filesystem and template methods are not implemented. VM commands use Prime's command-session stream; container commands use its exec gateway.
