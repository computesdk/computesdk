# @computesdk/deno-sandbox

Deno Deploy Sandbox provider for ComputeSDK — execute code in secure, isolated Deno sandboxes with command execution, filesystem support, and **Python via Pyodide**.

This provider uses **`@deno/sandbox`** under the hood.

## Installation

```bash
npm install @computesdk/deno-sandbox
````

## Setup

### 1) Get a Deno Deploy token

You need a Deno Deploy access token that is allowed to create/manage sandboxes.

### 2) Set the environment variable

```bash
export DENO_DEPLOY_TOKEN="your_token_here"
```

## Usage

### With ComputeSDK

```ts
import { createCompute } from "computesdk";
import { denoSandbox } from "@computesdk/deno-sandbox";

// Set as default provider
const compute = createCompute({
  provider: denoSandbox({
    // token is optional if you set DENO_DEPLOY_TOKEN
    token: process.env.DENO_DEPLOY_TOKEN,

    // optional knobs
    lifetime: "15m",
    memoryMb: 512,
  }),
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Execute JavaScript/TypeScript (runs in Deno runtime)
const js = await sandbox.runCode(`
console.log("Hello from JS in Deno Sandbox");
const x = 2 + 2;
x;
`, "node");

console.log(js.stdout ?? js.output);

// Execute Python (runs via Pyodide inside the sandbox JS runtime)
const py = await sandbox.runCode(`
import math
print("Hello from Python via Pyodide")
print("sqrt(16) =", math.sqrt(16))
`, "python");

console.log(py.stdout ?? py.output);

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

### Direct usage (provider instance)

```ts
import { denoSandbox } from "@computesdk/deno-sandbox";
import { createCompute } from "computesdk";

const provider = denoSandbox({
  token: process.env.DENO_DEPLOY_TOKEN,
  lifetime: "10m",
});

const compute = createCompute({ provider });

const sandbox = await compute.sandbox.create();
const res = await sandbox.runCommand("ls", ["-la"]);
console.log(res.stdout);

await compute.sandbox.destroy(sandbox.sandboxId);
```

## Configuration

### Environment Variables

```bash
export DENO_DEPLOY_TOKEN="your_token_here"
```

### Configuration Options

```ts
interface DenoSandboxConfig {
  /** Deno Deploy access token. Falls back to process.env.DENO_DEPLOY_TOKEN */
  token?: string;

  /** Optional org slug/name (depending on your token/setup) */
  org?: string;

  /** Optional endpoint override (advanced) */
  endpoint?: string | ((region: string) => string);

  /** Optional region override (advanced) */
  region?: unknown;

  /** Enable @deno/sandbox debug logging */
  debug?: boolean;

  /** Default runtime hint if caller doesn't specify */
  runtime?: "python" | "node" | "javascript" | "typescript";

  /** Sandbox lifetime, e.g. "session" | "600s" | "15m" */
  lifetime?: "session" | `${number}s` | `${number}m`;

  /** Sandbox memory in MiB */
  memoryMb?: number;

  /** Default labels for create/list */
  labels?: Record<string, string>;

  /**
   * Pyodide indexURL (where Pyodide loads its packages from).
   * If omitted, the provider uses a sensible default.
   */
  pyodideIndexURL?: string;
}
```

## Features

* ✅ **Code Execution (JS/TS)** — executes JavaScript/TypeScript inside the Deno sandbox runtime
* ✅ **Code Execution (Python)** — Python support via **Pyodide** (WASM) inside the sandbox JS runtime
* ✅ **Command Execution** — run bash commands via `spawn()` (stdout/stderr captured)
* ✅ **Filesystem Operations** — read/write/mkdir/readdir/remove/exists using native sandbox FS APIs
* ✅ **Sandbox Management** — create/connect/list/destroy via `@deno/sandbox`

## API Reference

### Code Execution

```ts
// JavaScript / TypeScript (executed in Deno runtime)
const js = await sandbox.runCode(`
console.log("Hello!");
({ ok: true, n: 123 })
`, "node");

// Python (executed via Pyodide)
const py = await sandbox.runCode(`
import json
data = {"message": "Hello from Python"}
print(json.dumps(data))
`, "python");
```

#### Important runtime note (“node”)

ComputeSDK’s `"node"` runtime is treated as **“JavaScript in the sandbox”**.
This is not a Node.js binary, so Node-only behaviors may differ.

### Command Execution

```ts
// List files
const result = await sandbox.runCommand("ls", ["-la"]);

// Pipes / redirects work because commands are run via bash -lc
const result2 = await sandbox.runCommand("bash", ["-lc", "echo hi | tr a-z A-Z"]);
```

### Filesystem Operations

```ts
// Write file
await sandbox.filesystem.writeFile("/tmp/hello.txt", "Hello World");

// Read file
const content = await sandbox.filesystem.readFile("/tmp/hello.txt");

// Create directory
await sandbox.filesystem.mkdir("/tmp/data");

// List directory contents
const files = await sandbox.filesystem.readdir("/tmp");

// Check existence
const exists = await sandbox.filesystem.exists("/tmp/hello.txt");

// Remove file or directory (recursive)
await sandbox.filesystem.remove("/tmp/hello.txt");
```

### Sandbox Management

```ts
// Get sandbox info
const info = await sandbox.getInfo();
console.log(info.id, info.provider, info.status);

// Reconnect to an existing sandbox by ID
const existing = await compute.sandbox.getById(provider, "sandbox-id");

// List running sandboxes (if enabled by token/permissions)
const sandboxes = await compute.sandbox.list(provider);

// Destroy sandbox
await compute.sandbox.destroy(provider, "sandbox-id");
```

## Python via Pyodide (what works / what doesn’t)

### What it does well

* Great for pure-Python computation, math, parsing, many common stdlib tasks
* Works without needing `python3` installed in the sandbox OS image
* Subsequent runs are faster after the initial Pyodide load (cached in the sandbox JS runtime)

### Limitations (important)

* Some Python packages that require native extensions may not work
* First Python call may be slower (loads WASM + packages)
* File I/O from Python is possible but depends on how Pyodide is configured; prefer using ComputeSDK filesystem APIs for portability

## Testing

In this monorepo, tests usually follow:

* **unit tests** always run
* **integration tests** (CRUD/create/destroy) run only when the token env var is set

Example:

```bash
export DENO_DEPLOY_TOKEN="your_token_here"
pnpm --filter @computesdk/deno-sandbox test
```

If `DENO_DEPLOY_TOKEN` is not set, the CRUD integration test is typically skipped.

## Best Practices

1. **Always destroy sandboxes** when done
2. **Use filesystem APIs** for reading/writing files (portable across providers)
3. **Treat “node” as JS-in-Deno**, not a Node.js VM
4. **Warm up Python** if you’ll run many Python snippets (first run loads Pyodide)
5. **Do not commit tokens** — use env vars

## Support

* [ComputeSDK Issues](https://github.com/computesdk/computesdk/issues)
* Deno sandbox SDK docs: `@deno/sandbox` on JSR

## License

MIT

