# Upstash

Upstash provider for ComputeSDK


## Installation & Setup

```bash
npm install @computesdk/upstash
```

Add your Upstash credentials to a `.env` file:

```bash
UPSTASH_BOX_API_KEY=your_upstash_box_api_key
```


## Usage

```typescript
import { upstash } from '@computesdk/upstash';

const compute = upstash({
  apiKey: process.env.UPSTASH_BOX_API_KEY,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Upstash!"');
console.log(result.stdout); // "Hello from Upstash!"

// Clean up
await sandbox.destroy();
```


## Box Types

Upstash supports two box variants:

- **Default Box** — Full sandbox with filesystem, shell, snapshots, and preview URLs. Best for persistent or long-running work.
- **Ephemeral Box** *(optional)* — Lightweight, instant-ready box with code execution and filesystem only. No preview URLs. Best for short-lived, one-off tasks.

For more details, see the [Upstash Box documentation](https://upstash.com/docs/box/overall/quickstart).

```typescript
// Default box
const sandbox = await compute.sandbox.create();

// Ephemeral box
const sandbox = await compute.sandbox.create({ ephemeral: true });
```




### Configuration Options

```typescript
interface UpstashConfig {
  /** Upstash Box API key - if not provided, will use UPSTASH_BOX_API_KEY env var */
  apiKey?: string;
  /** Default runtime environment (e.g. 'node', 'python') */
  runtime?: string;
  /** Execution timeout in milliseconds (default: 600000) */
  timeout?: number;
}
```
