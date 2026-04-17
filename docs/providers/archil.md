# Archil

Archil provider for ComputeSDK


## Installation & Setup

```bash
npm install @computesdk/archil
```

Add your Archil credentials to a `.env` file:

```bash
ARCHIL_API_KEY=your_archil_api_key
ARCHIL_REGION=aws-us-east-1
ARCHIL_DISK_ID=your_archil_disk_id
```


## Usage

Archil is exec-only — `create()` resolves a handle to an existing Archil disk id. Each command runs in an Archil-managed container with that disk attached.

```typescript
import { archil } from '@computesdk/archil';

const compute = archil({
  apiKey: process.env.ARCHIL_API_KEY,
  region: process.env.ARCHIL_REGION,
});

// Attach to an existing Archil disk by id
const diskId = process.env.ARCHIL_DISK_ID;
if (!diskId) throw new Error('ARCHIL_DISK_ID is not set');

const sandbox = await compute.sandbox.create({ diskId });

// Run a shell command against the mounted disk
const result = await sandbox.runCommand('echo hello > /mnt/note && cat /mnt/note');
console.log(result.stdout); // "hello"

// destroy() is a no-op — disk lifecycle is managed by Archil
await sandbox.destroy();
```


### Configuration Options

```typescript
interface ArchilConfig {
  /** Archil API key - if not provided, will use ARCHIL_API_KEY env var */
  apiKey?: string;
  /** Archil region (e.g. "aws-us-east-1") - if not provided, will use ARCHIL_REGION env var */
  region?: string;
  /** Override the control-plane base URL (useful for testing) */
  baseUrl?: string;
}
```

## Runtime Selection

Archil does not auto-detect runtimes — `runCode` requires an explicit runtime:

```typescript
// Python
await sandbox.runCode('print("Hello from Archil!")', 'python');

// Node.js
await sandbox.runCode('console.log("Hello from Archil!")', 'node');
```

**Supported runtimes:**
- `node` — wraps code in `node -e`
- `python` — wraps code in `python3 -c`

Passing any other runtime (or omitting it) throws.

### Supported Operations

| Method        | Supported | Notes                                                                 |
| ------------- | --------- | --------------------------------------------------------------------- |
| `create`      | ✅        | Resolves an existing disk from top-level `diskId`.                    |
| `getById`     | ✅        | Requires the disk id.                                                 |
| `list`        | ✅        | Lists all disks visible to the API key.                               |
| `destroy`     | no-op     | Disk lifecycle is managed by Archil.                                  |
| `runCommand`  | ✅        | Calls Archil's HTTP `exec` endpoint and waits for completion.         |
| `runCode`     | ✅        | Wraps code in `node -e` or `python3 -c`. Requires explicit `runtime`. |
| `getInfo`     | ✅        |                                                                       |
| `getUrl`      | ❌        | Each exec runs in a fresh ephemeral container — no port to expose.    |
| `filesystem`  | ✅        | Implemented via shell commands (`cat`, `find`, `mkdir`, etc.).        |

### Limitations

- Each `exec` call provisions a fresh container — no persistent state between calls beyond what is written to the disk.
- Responses are truncated to ~5 MB by the Archil control plane.
- `getUrl` is not supported — each exec runs in a fresh ephemeral container, so there is no long-lived process to expose a port on.
- Filesystem operations are implemented as shell commands, so each call costs one HTTP round trip.
