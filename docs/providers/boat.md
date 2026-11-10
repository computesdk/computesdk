---
description: Boat provider for ComputeSDK - Ubuntu cloud sandboxes with command streaming and filesystem access.
layout:
  width: default
  title:
    visible: true
  description:
    visible: false
  tableOfContents:
    visible: true
  outline:
    visible: true
  pagination:
    visible: true
  metadata:
    visible: true
  tags:
    visible: true
  actions:
    visible: true
---

# Boat

Boat provider for ComputeSDK, using the official `@boatdev/sdk`. Supports Ubuntu cloud sandboxes, shell commands, native output streaming, background commands, UTF-8 and binary file transfers, named snapshots/templates, interactive processes through the shared daemon, and HTTPS preview URLs.

## Install and authenticate

```bash
npm install computesdk @computesdk/provider @computesdk/boat
export BOAT_API_KEY=boat_...
```

Create an API key in the [Boat dashboard](https://boat.dev/dashboard?tab=api-keys). The `ci` key preset supports creating, using, and deleting sandboxes. See the [Boat quickstart](https://docs.boat.dev/quickstart).

## Usage

```typescript
import { createCompute } from '@computesdk/provider';
import { boat } from '@computesdk/boat';

const compute = createCompute({ provider: boat({}) });
const sandbox = await compute.instances.create({
  timeout: 3_600_000,
  envs: { GREETING: 'hello' },
  type: 'small',
});

try {
  const result = await sandbox.runCommand('echo "$GREETING"', {
    onStdout: chunk => process.stdout.write(chunk),
  });
  console.log(result.exitCode);
  await sandbox.filesystem.writeFile('/tmp/hello.txt', 'Hello from Boat');
  console.log(await sandbox.filesystem.readFile('/tmp/hello.txt'));
} finally {
  await sandbox.destroy();
}
```

You can also use `boat({}).instances` directly. `getById()` reconnects without resuming a stopped sandbox; `list()` returns ready, idle, and running sandboxes across all pages; `getInstance().name` holds each sandbox's Boat name, so you can find one by name without a `getInfo()` call per sandbox. `destroy()` requests permanent deletion, including sandbox data, rather than stopping and retaining a snapshot.

## Configuration

| Option | Meaning |
| --- | --- |
| `apiKey` | API key; falls back to `BOAT_API_KEY` |
| `baseURL` | API URL; falls back to `BOAT_API_BASE`, then `https://boat.dev/api/v1` |
| `timeout` | Default sandbox lifetime in milliseconds; omitted uses Boat's one-hour default |
| `readyTimeout` | Provisioning wait deadline in milliseconds; defaults to 300000 |
| `snapshotTimeout` | Named snapshot save deadline in milliseconds; defaults to 600000 |
| `preview` | Default preview settings: `public`, `localhost`, and `title` |
| `createOptions` | Typed native Boat creation defaults, including `type`, `environment`, `noEnv`, `from`, `org`, and `ttlSeconds` |

Creation options override defaults. `timeout` maps to `ttlSeconds` (rounded up), `envs` to `env`, and either `templateId` or `snapshotId` to Boat's named snapshot `from`. `name` is applied after readiness. Native `type`, `environment`, `noEnv`, `snapshots`, `monitoring`, `failFast`, `setupScript`, `org`, and `from` can be passed per create call. Native `env`, `ttlSeconds` (including null), and legacy `teamId` aliases also work; `envs`, `timeout`, and `org` take precedence over their aliases. Per-call lifetime settings override config defaults. For no auto-stop, use `createOptions: { ttlSeconds: null }` and set no `timeout`, either in the config or per call. Boat setup scripts run in the background; readiness does not mean setup has completed.

## Commands and previews

`runCommand()` supports `cwd`, `env`, `timeout` in milliseconds, and streaming callbacks. Foreground commands use Boat's detached execution with reconnecting output streams and have no timeout unless requested (`0` also means unlimited). A requested timeout stops the remote process and returns exit code 124 with partial output. Stream or callback errors also attempt to stop the remote foreground process; cleanup failures reject instead of claiming success. Background commands return an acknowledgement immediately:

```typescript
await sandbox.runCommand('python3 -m http.server 8000 --bind 0.0.0.0', {
  background: true,
  cwd: '/tmp',
});
const url = await sandbox.getUrl({ port: 8000 });
```

Preview URLs use HTTPS and retain Boat's token protection by default. Treat the full URL as a secret. Browsers follow the token redirect and retain its cookie; Node fetch callers should remove `_token` from the URL and send its value as `Cookie: _port_auth=<token>` because fetch does not maintain a cookie jar. Set defaults with `boat({ preview: { localhost: true } })`, or use the typed helper for a particular URL:

```typescript
import { getBoatUrl } from '@computesdk/boat';

const url = await getBoatUrl(sandbox.getInstance(), {
  port: 8000,
  localhost: true, // Relay a service listening on 127.0.0.1.
  public: false,   // Set true for an ungated public URL.
  title: 'Preview',
});
```

`runCommand({ background: true })` does not return a process handle. For interactive processes use the shared daemon API:

```typescript
const process = await sandbox.startProcess('cat', { stdin: true });
await process.write('hello\n');
await process.closeStdin();
console.log(await process.wait({ timeout: 30_000 }));
// process.status() and process.kill() are also available.
```

## Files

Portable filesystem reads/writes use UTF-8 strings. Files under `/home/user` and `/tmp` (including relative paths, which resolve under `/home/user`) use Boat's signed download/upload URLs, avoiding command payload and direct-file API size limits. Other paths, including the `/home/user` and `/tmp` directories themselves, use shell transfers, with uploads split into bounded chunks. Directory operations use shell commands and Python. Reads still collect the complete file in caller memory.

```typescript
import { readBoatFile, writeBoatFile } from '@computesdk/boat';

await writeBoatFile(sandbox.getInstance(), '/tmp/data.bin', new Uint8Array([0, 255]));
const bytes = await readBoatFile(sandbox.getInstance(), '/tmp/data.bin');
```

Signed transfers never receive the account bearer token; the signed URL authorizes the transfer.

## Named snapshots and templates

```typescript
const provider = boat({});
const saved = await provider.snapshot.create(sandbox.instanceId); // Generates a unique name.
const restored = await provider.instances.create({ snapshotId: saved.id });
try {
  console.log(await provider.snapshot.list({ instanceId: sandbox.instanceId }));
  console.log(await provider.template.list());
} finally {
  await restored.destroy();
  await provider.snapshot.delete(saved.id);
}

// A named template is the same Boat artifact, created from a source sandbox:
const template = await provider.template.create({ name: 'my-stack', sandboxId: sandbox.instanceId });
await provider.template.delete(template.id);
```

Snapshot and template creation wait until the named snapshot is ready. Both managers list/delete the same named artifacts. `id` and `templateId` are the reusable **name**; the native `snapshotId` is a separate artifact ID for browsing files and is not accepted as a boot source. `instances.create({ snapshotId })` and `templateId` accept named snapshot names or share codes, not arbitrary historical automatic snapshot IDs.

Saving a running sandbox captures a fresh disk snapshot asynchronously. Snapshots preserve supported disk changes, not process memory; `/tmp` and tool caches are excluded. Put files that must survive restore under `/home/user`. Named snapshots remain until deleted; saving an existing name replaces its artifact. Save timeouts report the name so callers can inspect or delete an unfinished save. Arbitrary snapshot metadata and template descriptions are unsupported.

## Advanced lifecycle and limits

```typescript
const { api, id } = sandbox.getInstance();
await api.stop({ sandboxId: id }); // Stops and retains the disk snapshot.
await api.resume({ sandboxId: id });
await api.fork({ sandboxId: id }); // Track and destroy the returned sandbox when finished.
```

Use the native Boat client for stop/resume/fork, TTL extension, command history/logs, and other advanced controls. ComputeSDK destruction permanently deletes the sandbox. Boat offers fixed machine types rather than arbitrary CPU/RAM/disk allocation or GPU; unsupported resource/image/region options and arbitrary instance metadata are rejected. Setup scripts run in the background, so readiness does not guarantee setup completion.
