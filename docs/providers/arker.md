# Arker

Arker provider for ComputeSDK — sandboxed VMs with persistent per-VM filesystems.


## Installation & Setup

```bash
npm install @computesdk/arker
```

Add your Arker credentials to a `.env` file:

```bash
ARKER_API_KEY=your_arker_api_key
```

> **Note:** Arker API keys start with `ark_` — get one from [arker.ai](https://arker.ai). By default the provider targets the `aws-us-east-1` region; select another region with `ARKER_REGION`.


## Usage

```typescript
import { arker } from '@computesdk/arker';

const compute = arker({
  apiKey: process.env.ARKER_API_KEY,
});

// Create sandbox (forks the `ubuntu-small` golden by default)
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Arker!"');
console.log(result.stdout); // "Hello from Arker!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface ArkerConfig {
  /** Arker API key (starts with `ark_`). Falls back to ARKER_API_KEY. */
  apiKey?: string;
  /** Region, e.g. `aws-us-east-1`. Falls back to ARKER_REGION, then the us-east-1 default. */
  region?: string;
  /** Golden source VM to fork on create(). Falls back to ARKER_SOURCE, then `ubuntu-small`. */
  source?: string;
}
```

### Supported Operations

- **Sandbox lifecycle** — `create` (fork from a golden image), `getById`, `list`, `destroy`
- **Command execution** — `runCommand` with `cwd`, `env`, `timeout`, and `background` options; Node.js and Python are preinstalled on the default `ubuntu-small` golden
- **Filesystem** — `readFile`, `writeFile`, `mkdir`, `readdir`, `exists`, `remove` (persistent per-VM filesystem)

### Notes

- **Creation is fork-only.** Direct VM creation is disabled; `create()` forks a golden source image (`ubuntu-small` by default). Pick a different golden via `source` in config or `templateId` in create options.
- **`getUrl` is not supported** and throws. VMs forked with network reachability enabled get a stable per-VM hostname — see the [Arker SDK](https://github.com/ArkerHQ/arker-sdk) fork network options.
- **Automatic retries.** The underlying `@arker-ai/sdk` retries transient failures (HTTP 429/502/503/504 and transient backend errors).
