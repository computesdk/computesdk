# Declaw

Declaw provider for ComputeSDK

Declaw runs Firecracker microVMs with a built-in security stack: PII scanning, prompt-injection defense, TLS-intercepting egress proxy, and per-sandbox network policies.


## Installation & Setup

```bash
npm install @computesdk/declaw
```

Add your Declaw credentials to a `.env` file:

```bash
DECLAW_API_KEY=your_declaw_api_key
```

API keys must start with `dcl_`.


## Usage

```typescript
import { declaw } from '@computesdk/declaw';

const compute = declaw({
  apiKey: process.env.DECLAW_API_KEY,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('node -v');
console.log(result.stdout); // v20.x.x

// Clean up
await sandbox.destroy();
```


### Configuration Options

```typescript
interface DeclawConfig {
  /** Declaw API key - if not provided, will use DECLAW_API_KEY env var */
  apiKey?: string;
  /** API domain - if not provided, will use DECLAW_DOMAIN env var (default: api.declaw.ai) */
  domain?: string;
  /** Default create-time timeout in milliseconds (default: 300000) */
  timeout?: number;
}
```

## Templates

`templateId` maps to a Declaw template alias. Defaults to `node` (Ubuntu 22.04 + Node.js 20).

**Built-in templates:**
- `base`
- `node` (default)
- `python`
- `code-interpreter`
- `ai-agent`
- `mcp-server`
- `web-dev`
- `devops`

```typescript
const sandbox = await compute.sandbox.create({
  templateId: 'python',
});
```

Custom templates can be built through the Declaw CLI — see the [Declaw docs](https://docs.declaw.ai/).
