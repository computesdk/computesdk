# @computesdk/collimate

[Collimate](https://collimate.ai) provider for [ComputeSDK](https://www.computesdk.com) — sub-millisecond CoW-forked microVM sandboxes with DAX shared runtimes.

## Installation

```bash
npm install @computesdk/collimate computesdk
```

## Usage

```typescript
import { collimate } from "@computesdk/collimate";
import { compute } from "computesdk";

compute.setConfig({
  provider: collimate({
    apiKey: "col_live_...",
    templateId: "node",
  }),
});

const sandbox = await compute.sandbox.create();
const result = await sandbox.runCommand("node -v");
console.log(result.stdout); // v20.x.x
await sandbox.destroy();
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | `COLLIMATE_API_KEY` env | API key for authentication |
| `serverUrl` | `string` | `https://api.collimate.ai` | API server URL |
| `templateId` | `string` | — | Template ID (`node`, `python`, etc.) |
| `timeout` | `number` | `900` | Execution timeout in seconds |

## How it works

Each sandbox is a full KVM virtual machine forked via copy-on-write from a pre-warmed template snapshot. Fork latency is sub-millisecond; the guest resumes at the snapshot's instruction pointer with all devices restored.

**DAX (Direct Access)** maps a shared read-only erofs image via virtio-pmem so all sandboxes execute binaries in-place from a single host copy — ~133 KB per sandbox instead of hundreds of MB.

## Supported operations

- `create()` / `destroy()` — sandbox lifecycle
- `runCommand()` — shell execution with stdout/stderr/exitCode
- `writeFile()` / `readFile()` — filesystem operations
- `mkdir()` / `readdir()` / `exists()` / `remove()` — directory operations
- `getById()` / `list()` / `getInfo()` — sandbox management

## Links

- [Collimate](https://collimate.ai)
- [Documentation](https://docs.collimate.ai)
- [ComputeSDK](https://www.computesdk.com)
