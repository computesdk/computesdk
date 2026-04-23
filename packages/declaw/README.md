# @computesdk/declaw

[Declaw](https://declaw.ai) provider for [ComputeSDK](https://github.com/computesdk/computesdk).

Declaw runs Firecracker microVMs with a built-in security stack: PII
scanning, prompt-injection defense, TLS-intercepting egress proxy, and
per-sandbox network policies.

## Install

```bash
npm install @computesdk/declaw
```

## Usage

```ts
import { declaw } from '@computesdk/declaw';

const compute = declaw({ apiKey: process.env.DECLAW_API_KEY });

const sandbox = await compute.sandbox.create();
const result = await sandbox.runCommand('node -v');
console.log(result.stdout); // v20.x.x
await sandbox.destroy();
```

## Configuration

| Option    | Env var          | Default          |
|-----------|------------------|------------------|
| `apiKey`  | `DECLAW_API_KEY` | —                |
| `domain`  | `DECLAW_DOMAIN`  | `api.declaw.ai`  |
| `timeout` | —                | `300000` (ms)    |

## Templates

`templateId` maps to a Declaw template alias. Defaults to `node`
(Ubuntu 22.04 + Node.js 20). Other built-ins: `base`, `python`,
`code-interpreter`, `ai-agent`, `mcp-server`, `web-dev`, `devops`.

Custom templates can be built through the Declaw CLI — see the
[Declaw docs](https://docs.declaw.ai/).

## License

MIT
