# Secure-Exec

Secure execution provider for ComputeSDK — a local, isolated sandbox using [secure-exec](https://www.npmjs.com/package/secure-exec)'s V8 isolates, with an in-memory filesystem. No remote service or credentials required.

## Installation & Setup

```bash
npm install @computesdk/secure-exec
```

There are no credentials to configure — sandboxes run locally in a V8 isolate.

> **Platform requirement:** the underlying V8 runtime binary (`secure-exec-v8`) is currently only available for **linux-x64**. `create()` throws on other platforms.

## Usage

```typescript
import { secureExec } from '@computesdk/secure-exec';

const compute = secureExec({
  memoryLimitMb: 128,
  cpuTimeLimitMs: 30_000,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Secure-Exec!"');
console.log(result.stdout); // "Hello from Secure-Exec!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface SecureExecConfig {
  /** Memory cap for the V8 isolate in MB. Default: 128 */
  memoryLimitMb?: number;
  /** CPU time budget per exec call in ms. Default: 30_000 */
  cpuTimeLimitMs?: number;
  /** Allowlist of commands sandboxed code can spawn. Default: all allowed */
  allowedCommands?: string[];
}
```

### Supported Operations

| Method | Supported | Notes |
| --- | --- | --- |
| `create` | ✅ | Spins up a local V8 isolate with an in-memory filesystem rooted at `/workspace`. |
| `getById` | ❌ | Always returns `null` — sandboxes are in-process and not addressable across calls. |
| `list` | ❌ | Always returns an empty array. |
| `destroy` | no-op | Nothing to tear down remotely. |
| `runCommand` | ✅ | Executes shell commands inside the isolate via `spawnSync`. |
| `getInfo` | ✅ | Reports `metadata: { local: true }`. |
| `getUrl` | ❌ | Throws — `getUrl is not supported by secure-exec provider.` |
| `filesystem` | ✅ | Backed by secure-exec's in-memory filesystem (not shell-based). |

### Notes

- This provider is **local-only**: sandboxes live in the current Node process, so `getById` and `list` do not return anything and `destroy` is a no-op.
- Commands sandboxed code may spawn can be restricted with `allowedCommands`; by default all commands are allowed.
