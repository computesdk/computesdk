# TypeScript SDK reference

```typescript
import { compute } from 'computesdk';

const sandbox = await compute.instances.create({ size: 'small' });
try {
  console.log((await sandbox.runCommand('echo hello')).stdout);
} finally {
  await sandbox.destroy();
}
```

Install `computesdk`. The exported `compute` singleton uses the ComputeSDK router by default; no factory call or adapter package is needed. Set `COMPUTE_API_KEY` to authenticate.

## Methods

| Export or method | Purpose |
| --- | --- |
| `compute.instances.create(options)` | Create a sandbox |
| `compute.instances.getById(id)` | Reconnect to an existing sandbox |
| `compute.instances.list()` | List running sandboxes |
| `compute.instances.destroy(id)` | Destroy a sandbox |
| `sandbox.runCommand(command, options?)` | Buffered, streaming or background execution |
| `sandbox.filesystem` | File and directory operations |
| `sandbox.getUrl({ port })` | Get a port URL |
| `sandbox.destroy()` | Release the sandbox |

## Create options

Pass options directly to `compute.instances.create()`. With no routing override,
creation follows your organization's saved router.

| Option | Meaning |
| --- | --- |
| `size` | `small`, `medium`, `large`, `xlarge`, `2xlarge` or `3xlarge`; available shapes depend on the provider |
| `cpus`, `memoryMb`, `diskMb` | Raw resource requirements; use these instead of `size` |
| `timeout` | Sandbox lifetime in milliseconds, subject to provider limits |
| `label` | A label for the sandbox, up to 200 characters; falls back to `name` |
| `envs` | Default environment variables for commands |
| `image` / `templateId` | Provider-specific boot image or template |
| `snapshotId` | Restore a provider-supported snapshot |
| `secrets` | Up to 100 organization vault secret names to inject into commands |
| `disk` | Attach a supported disk with `{ diskId, path, readonly?, branch? }` |
| `idempotencyKey` | A stable key for safe creation across process restarts, up to 200 characters |
| `providerOrder` | Explicit placement order; see [routing](../guides/routing.md#sdk-and-rest-overrides) |
| `orderType`, `maxPrice` | Market order and price limit; `maxPrice` is `{ usd, per: 'second' | 'minute' | 'hour' }` |

```typescript
import { compute } from 'computesdk';

const sandbox = await compute.instances.create({
  size: 'small',
  timeout: 600000,
  label: 'test-run',
  envs: { NODE_ENV: 'test' },
});
try {
  console.log(await sandbox.getInfo());
} finally {
  await sandbox.destroy();
}
```

Use either `size` or raw resources. Compatibility spellings include
`vcpus`, `memoryMiB`, `memMiB`, `memory`, and `diskMiB`. Accepted option names do
not imply that every provider offers the same resources, snapshots or images.
Provider-specific direct-adapter `sizeClass` values are separate from router sizes.

## Command options

`runCommand(command, options?)` returns `stdout`, `stderr` and `exitCode`.

| Option | Meaning |
| --- | --- |
| `cwd` | Working directory inside the sandbox |
| `env` | Per-command environment variables |
| `timeout` | Command duration in milliseconds, up to 290 seconds for buffered commands |
| `onStdout`, `onStderr` | Callbacks for streamed output |
| `background` | Start detached work rather than wait for completion |

See [run commands](../guides/commands.md) and [errors and limits](errors.md).

## Files, URLs and lifecycle

- `filesystem.readFile(path)` reads UTF-8 text; `writeFile(path, content)` writes it.
- `filesystem.mkdir(path)` creates a directory; `readdir(path)` lists entries.
- `getUrl({ port, protocol? })` resolves a provider-supported port URL.
- `getInfo()` reads sandbox details; `sandboxId` identifies the sandbox.
- `destroy()` releases the sandbox. Finishing a command or closing the client does not destroy it.

Read the task guides for [files](../guides/files.md), [previews](../guides/previews.md)
and [lifecycle](../guides/lifecycle.md). `sandbox` remains a deprecated alias for
`instances` on the compute object. Actions and organization resources use the
[REST API](../platform/api-reference.md).

## Compatibility

`computesdk@4.1.18` and earlier do not include the default router. Upgrade to a
release containing built-in routing to use the examples in these docs.

Explicit provider and multi-provider configurations continue to work. An
invalid explicit configuration still fails; it does not silently use the router.
See the [GitHub adapter documentation](https://github.com/computesdk/computesdk/blob/main/OPEN_SOURCE.md)
for existing direct provider integrations.
