# Archil

Archil provider for ComputeSDK

Archil is exec-only — each command runs in an Archil-managed container with a configured disk mounted. `create` resolves a handle to an existing Archil disk id; disk lifecycle is managed by Archil itself.


## Installation & Setup

```bash
npm install computesdk @computesdk/archil

# add to .env file
COMPUTESDK_API_KEY=your_computesdk_api_key

ARCHIL_API_KEY=your_archil_api_key
ARCHIL_REGION=aws-us-east-1
ARCHIL_DISK_ID=your_archil_disc_id
```


## Usage

```typescript
import { compute } from 'computesdk';
// auto-detects provider from environment variables

// Attach to an existing Archil disk by id
const sandbox = await compute.sandbox.create({
  diskId: 'disk_abc123',
});

// Execute a shell command against the mounted disk
const result = await sandbox.runCommand('echo hello > /mnt/note && cat /mnt/note');
console.log(result.stdout); // "hello"

// destroy() is a no-op — disk lifecycle is managed by Archil
await compute.sandbox.destroy(sandbox.sandboxId);
```

`create()` requires a top-level `diskId` pointing at an existing Archil disk.


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

## Explicit Provider Configuration

If you prefer to set the provider explicitly, you can do so as follows:

```typescript
import { compute } from 'computesdk';

compute.setConfig({
   computesdkApiKey: process.env.COMPUTESDK_API_KEY,
   provider: 'archil',
   archil: {
     apiKey: process.env.ARCHIL_API_KEY,
     region: process.env.ARCHIL_REGION,
   }
});

const sandbox = await compute.sandbox.create({ diskId: 'disk_abc123' });
```

## Runtime Selection

Archil does not auto-detect runtimes — `runCode` requires an explicit runtime:

```typescript
await sandbox.runCode('print("hello from python")', 'python');
await sandbox.runCode('console.log("hello from node")', 'node');
```

Supported runtimes:
- **`node`** — wraps code in `node -e`
- **`python`** — wraps code in `python3 -c`


## Supported Operations

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


## Limitations

- Each `exec` call provisions a fresh container — there is no persistent state between calls beyond what is written to the disk.
- Responses are truncated to ~5 MB by the Archil control plane.
- `getUrl` is not supported — each exec runs in a fresh ephemeral container, so there is no long-lived process to expose a port on.
- Filesystem operations are implemented as shell commands, so each call costs one HTTP round trip.
