# @computesdk/arker

Arker provider for ComputeSDK — run code in [Arker](https://arker.ai) sandboxed VMs with persistent per-VM filesystems.

## Installation

```bash
npm install @computesdk/arker
```

## Setup

1. Get your Arker API key (starts with `ark_`) from [arker.ai](https://arker.ai).
2. Set the environment variable:

```bash
export ARKER_API_KEY=ark_live_your_api_key_here
```

By default the provider targets the `aws-us-east-1` region. Select another region with `region` / `ARKER_REGION`.

## Quick Start

Configure `compute` with the Arker provider and create a sandbox:

```typescript
import { compute } from 'computesdk';
import { arker } from '@computesdk/arker';

compute.setConfig({
  provider: arker({ apiKey: process.env.ARKER_API_KEY }),
});

const sandbox = await compute.instances.create();

const result = await sandbox.runCommand('node -v');
console.log(result.stdout); // v18.x

await sandbox.destroy();
```

Or call the provider factory directly when you only need one provider:

```typescript
import { arker } from '@computesdk/arker';

const sdk = arker({ apiKey: process.env.ARKER_API_KEY });
const sandbox = await sdk.instances.create();
```

## How sandboxes are created

Arker disables direct VM creation — every sandbox is **forked**, from a source VM or an OCI image. `create()` forks the `ubuntu-small` golden (Node.js + Python preinstalled) by default. The source can be chosen three ways:

- **By name** — a golden/template, via `source` in config or `templateId` in create options.
- **By id** — a specific existing VM, via `snapshotId` in create options. The `instanceId` returned by `create()` is itself a valid source, so this branches a sandbox from its current state (Arker's equivalent of a snapshot restore). If both are given, `snapshotId` wins.
- **From an OCI image** — `image` in create options, e.g. `ubuntu:24.04` or `ghcr.io/org/app:v1`, from a public registry. Arker converts the image's rootfs and boots it; the first create of an image pays for the conversion, and later creates of it are usually faster. `snapshotId` wins over `image`, and `image` over a golden.

```typescript
// Default: forks the `ubuntu-small` golden
const sandbox = await sdk.instances.create();

// Pick a golden globally for this provider
const heavy = arker({ apiKey, source: 'ubuntu-full' });

// ...or per sandbox, by name
const other = await sdk.instances.create({ templateId: 'ubuntu-full' });

// Fork an existing sandbox by id — branches from its current state
const forked = await sdk.instances.create({ snapshotId: sandbox.instanceId });

// Boot an OCI image
const oci = await sdk.instances.create({ image: 'ubuntu:24.04' });
```

## Volumes

A volume is an Arker filesystem: storage that belongs to your organization, has a unique name, outlives the sandboxes it is mounted on, and can be mounted on several at once.

Volume operations use the configured API key's organization-wide filesystem access. Keys with filesystem access in the same organization share that scope. To isolate tenants, use separate Arker organizations with their own keys, or authorize each filesystem ID and any target VM ID for the authenticated tenant in your application before calling the SDK.

```typescript
const volumes = sdk.volume!;
const volume = await volumes.create({ name: 'datasets' });

// Mount at create; create() returns once the volume is mounted
const sandbox = await sdk.instances.create({ volumes: [{ volume, mountPath: '/mnt/data' }] });

// ...or detach and attach on a running sandbox
await sandbox.detachVolume!(volume, '/mnt/data');
await sandbox.attachVolume!(volume, '/mnt/data');

await volumes.get('datasets');         // by id or name
await volumes.list();

// Detach it from every sandbox (or destroy them) before deleting it
await sandbox.destroy();
await volumes.delete('datasets');
```

## Configuration

### Environment Variables

```bash
export ARKER_API_KEY=ark_live_your_api_key_here
export ARKER_REGION=aws-us-east-1     # optional, this is the default
export ARKER_SOURCE=ubuntu-small      # optional default golden
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
  /**
   * Keep each sandbox running between commands for its `timeout` (5 minutes
   * when unset; `0` for no limit) or until it is destroyed. Default `true`.
   * With `false`, Arker pauses the VM whenever no command is running, which
   * also freezes background processes, and bills only while commands run.
   */
  keepAwake?: boolean;
}
```

A background process (`nohup ... &`, `startProcess`) keeps running between
commands while the sandbox is kept awake: from the sandbox's first command, one
long-lived run in a session of its own holds the VM, billed as compute time,
until its `timeout` has passed since create (5 minutes by default, no limit at
`timeout: 0`). When the window ends the sandbox is not deleted: it pauses
between commands again. The hold starts in the process that created the
sandbox; a sandbox commanded only from another process (through `getById`) is
not held. `getInfo().timeout` reports the window. A fork copies a held
sandbox's runs, hold included: sandboxes this adapter creates from it end the
copy, but a fork made another way (the Arker SDK or CLI) keeps it running from
its first use for up to what was left of the source's window.

Commands that run at the same time run concurrently: Arker runs one command at
a time per session, so a command that starts while another is still running
gets a session of its own, starting in the sandbox's starting directory.
Commands run one after another share one shell, so a `cd` or `export` carries
into the next command. While another command or a watched process
(`startProcess` with output callbacks, or a streaming `runCommand`) is running,
don't rely on that: pass `cwd` and `env` instead.

## API Reference

### Command Execution

```typescript
// Shell command
const result = await sandbox.runCommand('echo hello');

// Run a script via heredoc
const result = await sandbox.runCommand(`python3 - <<'PY'
print("Hello from Python")
PY`);

// With environment and working directory
const result = await sandbox.runCommand('npm test', {
  cwd: '/app',
  env: { CI: '1' },
});
```

`runCommand` returns `{ stdout, stderr, exitCode, durationMs }`.

### Filesystem Operations

Filesystem operations run as shell commands in the VM and work over arbitrary paths.

```typescript
await sandbox.filesystem.writeFile('/tmp/hello.txt', 'hi');
const content = await sandbox.filesystem.readFile('/tmp/hello.txt');
await sandbox.filesystem.mkdir('/tmp/data');
const entries = await sandbox.filesystem.readdir('/tmp');
const exists = await sandbox.filesystem.exists('/tmp/hello.txt');
await sandbox.filesystem.remove('/tmp/hello.txt');
```

### Sandbox Management

```typescript
const sandbox = await sdk.instances.create();
const info = await sandbox.getInfo();      // { id, provider, status, createdAt, ... }
const all = await sdk.instances.list();    // VMs visible to the API key
const existing = await sdk.instances.getById(sandbox.instanceId);
await sandbox.destroy();
```

## Features

- ✅ **Command Execution** — full shell, Node.js & Python preinstalled (`ubuntu-small`)
- ✅ **Filesystem Operations** — persistent per-VM filesystem (read/write/list/mkdir/exists/remove)
- ✅ **OCI images** — `create({ image })` boots an image from a public registry
- ✅ **Volumes** — `volume.create/get/list/delete`, create-time `volumes`, `attachVolume`/`detachVolume`
- ✅ **Fast cold start** — forking the default golden boots a sandbox in well under a second
- ✅ **Automatic retries** — the underlying `@arker-ai/sdk` retries transient failures (HTTP 429/502/503/504) of requests that are safe to repeat: reads, requests with an idempotency key (such as image creates), and requests Arker reports it did not start

## Limitations

- **Creation is fork-only** — direct VM creation is disabled; `create()` forks a golden by name (`templateId`/`source`), an existing VM by id (`snapshotId`) or an OCI image (`image`). There's no separate snapshot store, but any `instanceId` can be re-forked as a `snapshotId`.
- **Private registries** — `image` is pulled without credentials, so an image must be public.
- **`getUrl` makes the port public** — it adds an inbound rule that serves the port with no authentication (keeping the VM's other rules) and returns its `https://` URL. For authenticated access, set the VM's network policy through the [Arker SDK](https://github.com/ArkerHQ/arker-sdk) instead.
- **Volumes mount read-write** — a `readOnly` mount is refused, and `sizeBytes` is ignored: an Arker filesystem grows as it fills. A mount path must be absolute, not `/` and at most 256 bytes, without whitespace, backslashes or `..`. A mount path that goes through a symlink (such as `/var/run/…`, where `/var/run` links to `/run`) takes about two minutes to confirm; give the resolved path (`/run/…`) instead.
- **One path per volume per sandbox** — a volume mounts at one path on each sandbox, and a sandbox restored from a snapshot keeps its source's mounts. Mounting starts a paused sandbox, as a command would.
- **`getInfo` status** — always reports `running`; idle sandboxes resume automatically on their next command.

## Support

- [Arker](https://arker.ai)
- [Arker SDK](https://github.com/ArkerHQ/arker-sdk)
- [ComputeSDK Issues](https://github.com/computesdk/computesdk/issues)

## License

MIT
