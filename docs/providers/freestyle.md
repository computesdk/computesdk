# Freestyle

[Freestyle](https://www.freestyle.sh) provider for ComputeSDK — full Linux virtual machines designed for long-running, complex agent tasks, with instant startup, persistence, and cheap snapshotting.

## Installation & Setup

```bash
npm install computesdk @computesdk/freestyle

# add to .env file
FREESTYLE_API_KEY=your_freestyle_api_key
FREESTYLE_SNAPSHOT_ID=sh-...    # a snapshot you baked with a runtime (see below)
```

Freestyle's base images ship **no language runtime** by design — a Freestyle sandbox is a real Linux machine, and what it can run is yours to decide. So every sandbox boots from a **snapshot you bake once** with the runtime and tools you need, and point at with `FREESTYLE_SNAPSHOT_ID` (or the `snapshotId` config option). See [Baking a runtime snapshot](#baking-a-runtime-snapshot).

## Usage

```typescript
import { compute } from 'computesdk';
import { freestyle } from '@computesdk/freestyle';

const sandbox = await compute.sandbox.create({ provider: freestyle() });

// Execute code (runtime auto-detected)
const result = await sandbox.runCode('print("Hello from Freestyle!")');
console.log(result.output); // "Hello from Freestyle!"

// Run a command
const cmd = await sandbox.runCommand('node -v');
console.log(cmd.stdout); // "v22.19.0\n"

// Clean up (the VM is ephemeral and deleted here)
await compute.sandbox.destroy(sandbox.sandboxId);
```

### Configuration Options

```typescript
interface FreestyleConfig {
  /** Freestyle API key - if not provided, will use FREESTYLE_API_KEY */
  apiKey?: string;
  /** Snapshot every sandbox boots from - if not provided, will use FREESTYLE_SNAPSHOT_ID */
  snapshotId?: string;
  /** API base URL - if not provided, will use FREESTYLE_API_URL, then the SDK default */
  baseUrl?: string;
  /** Runtime used by runCode when the language cannot be inferred */
  runtime?: 'node' | 'python' | 'deno' | 'bun';
  /** Idle seconds before Freestyle stops the VM (default 300) */
  idleTimeoutSeconds?: number;
  /** Default wall-clock limit for a single command, ms (default 300000) */
  timeout?: number;
  /** Keep the VM after it stops instead of deleting it (default: ephemeral) */
  persistent?: boolean;
  /** Outbound firewall. Defaults to allow-all outbound; pass { rules: [] } to seal. */
  firewall?: { rules: unknown[] };
}
```

## Explicit Provider Configuration

If you prefer to set the provider explicitly, you can do so as follows:

```typescript
import { compute } from 'computesdk';

compute.setConfig({
  provider: 'freestyle',
  freestyle: {
    apiKey: process.env.FREESTYLE_API_KEY,
    snapshotId: process.env.FREESTYLE_SNAPSHOT_ID,
  },
});

const sandbox = await compute.sandbox.create();
```

## Capabilities

| Feature | Support |
|---|---|
| `runCommand` / `runCode` (node, python) | ✅ |
| Filesystem: read, write, readdir, mkdir, exists, remove | ✅ (native) |
| Snapshots: create, list, delete | ✅ |
| Reconnect by id (`compute.sandbox.getById`) | ✅ |
| List sandboxes | ✅ (VMs this provider created) |
| `getUrl` (per-port URL) | ❌ — map a domain via [`freestyle.domains`](https://docs.freestyle.sh) instead |

Freestyle VMs are full Linux guests, so — unlike most providers — the whole filesystem surface is native rather than shelled out through `runCommand`.

## Filesystem

```typescript
await sandbox.filesystem.writeFile('/tmp/app.js', 'console.log("hi")');
console.log(await sandbox.filesystem.readFile('/tmp/app.js'));
console.log(await sandbox.filesystem.readdir('/tmp'));
await sandbox.filesystem.mkdir('/tmp/sub');
console.log(await sandbox.filesystem.exists('/tmp/app.js'));
await sandbox.filesystem.remove('/tmp/app.js');
```

## Runtime Detection

The provider automatically detects the runtime based on code patterns:

**Python indicators:** `print(`, `import`, `def`, and Python-specific syntax (`f"`, `__`, `raise`, etc.)

**Default:** Node.js for all other cases.

## Baking a runtime snapshot

Bake once, reuse for every sandbox. This installs Node 22 and Python 3 into a fresh VM and snapshots it:

```typescript
import { Freestyle } from 'freestyle';

const client = new Freestyle({ apiKey: process.env.FREESTYLE_API_KEY });
const NODE = 'v22.19.0';

const { vm, vmId } = await client.vms.create({
  slug: 'computesdk-builder',
  reassignSlug: true,
  autoDeleteSeconds: 0,
  automaticRestart: false,
  firewall: { rules: [{ action: 'allow', source: {}, destination: { public: true } }] },
});

const run = async (command: string) => {
  const r = await vm.exec({ command, timeoutMs: 300_000 });
  if (r.statusCode !== 0) throw new Error(`${command}\n${r.stderr ?? r.stdout}`);
  return r;
};

try {
  await run('apt-get update -y && DEBIAN_FRONTEND=noninteractive apt-get install -y curl xz-utils ca-certificates python3 python3-pip');
  await run(`curl -fsSL "https://nodejs.org/dist/${NODE}/node-${NODE}-linux-x64.tar.xz" | tar -xJ -C /usr/local --strip-components=1`);
  const { snapshotId } = await vm.snapshot({ slug: 'computesdk-node22-python3' });
  console.log('FREESTYLE_SNAPSHOT_ID=' + snapshotId);
} finally {
  await client.vms.delete(vmId);
}
```

Set the printed `FREESTYLE_SNAPSHOT_ID` in your environment and every sandbox boots from it in ~200–300 ms.
