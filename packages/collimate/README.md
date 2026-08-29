# @computesdk/collimate

[Collimate](https://collimate.ai) provider for [ComputeSDK](https://www.computesdk.com).

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
console.log(result.stdout); // v22.x.x
await sandbox.destroy();
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | `COLLIMATE_API_KEY` env | API key for authentication |
| `serverUrl` | `string` | `https://api.collimate.ai` | API server URL |
| `templateId` | `string` | — | Template ID (`node`, `python`, etc.) |
| `timeout` | `number` | `900` | Execution timeout in seconds |

## Supported operations

- `create()` / `destroy()` — sandbox lifecycle
- `runCommand()` — shell execution with stdout/stderr/exitCode
- `writeFile()` / `readFile()` — filesystem operations
- `mkdir()` / `readdir()` / `exists()` / `remove()` — directory operations
- `getById()` / `list()` / `getInfo()` — sandbox management

## Links

- [Collimate](https://collimate.ai)
- [ComputeSDK](https://www.computesdk.com)
