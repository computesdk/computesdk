# @computesdk/kosa8

[kosa8](https://kosa8.com) provider for ComputeSDK - cloud sandboxes where each sandbox runs in its own microVM with its own kernel, billed per second, with sleep and wake.

## Installation & Setup

```bash
npm install @computesdk/kosa8
```

Create an API key in the kosa8 Cloud dashboard at [app.kosa8.com](https://app.kosa8.com), then add it to a `.env` file:

```bash
KOSA8_API_KEY=your_kosa8_api_key
```

## Usage

```typescript
import { compute } from 'computesdk';
import { kosa8 } from '@computesdk/kosa8';

compute.setConfig({
  provider: kosa8({ apiKey: process.env.KOSA8_API_KEY }),
});

const sandbox = await compute.instances.create();

const result = await sandbox.runCommand('uname -r && echo "Hello from kosa8!"');
console.log(result.stdout);

await sandbox.destroy();
```

Or call the provider factory directly:

```typescript
import { kosa8 } from '@computesdk/kosa8';

const sdk = kosa8({ apiKey: process.env.KOSA8_API_KEY });

// See which templates your organization can start
console.log(await sdk.template.list());

const sandbox = await sdk.sandbox.create({ templateId: 'base', timeout: 30 * 60 * 1000 });
await sandbox.filesystem.writeFile('/tmp/hello.sh', 'echo $((6 * 7))');
console.log((await sandbox.runCommand('sh /tmp/hello.sh')).stdout); // "42\n"

// Sleep: the VM's memory and disk are snapshotted and its RAM freed. Wake restores it.
await sandbox.pause();
await sandbox.resume();

await sandbox.destroy();
```

## Configuration

```typescript
interface Kosa8Config {
  /** kosa8 Cloud API key - if not provided, will use KOSA8_API_KEY env var */
  apiKey?: string;
  /** API base URL - defaults to KOSA8_API_URL, then https://api.kosa8.com */
  baseUrl?: string;
  /** Default template for new sandboxes (the organization's default, `base`, when unset) */
  template?: string;
  /** Default region for new sandboxes, e.g. `eu-hel1` (any region when unset) */
  region?: string;
}
```

## Create Options

| Option | Maps to | Notes |
|---|---|---|
| `templateId` | `template` | A template key from `template.list()`. The template sets the sandbox's vCPUs, memory and image. |
| `region` | `region` | A region id such as `eu-hel1`. |
| `timeout` (ms) | `ttl_s` | The sandbox is deleted when its lifetime ends. Rounded up to whole seconds; the API's minimum is 60 s and maximum 90 days. Without it, a sandbox lives until destroyed. |
| `sleepAfterSeconds` | `sleep_after_s` | Idle seconds before the sandbox sleeps; `0` never sleeps. |

`cpu`, `memory`, disk sizes, `image`, `snapshotId`, `envs` and `volumes` are rejected with an error rather than ignored: a sandbox's size and image come from its template. Pass environment variables per command with `runCommand(cmd, { env })`.

## Features

- **Command execution** with `cwd`, `env`, `timeout` and background commands
- **Filesystem**: read, write, list, mkdir, exists and remove, run as shell commands over exec
- **Pause and resume**: `pause()` puts the sandbox to sleep (memory and disk are snapshotted, its RAM is freed) and `resume()` wakes it. A command sent to a sleeping sandbox also wakes it.
- **Lifetime**: `extendLifetime(ms)` moves the delete time of a sandbox created with `timeout`
- **Templates**: `template.list()` returns the templates your organization can start, with their size and regions

## Limitations

- `getUrl()` (port URLs) is not supported yet and throws.
- Output is returned when the command finishes; there is no live streaming.
- `runCommand`'s `timeout` stops the command inside the sandbox with `timeout -s KILL` and reports exit code 124. On an image without the `timeout` utility, the command runs to completion.
- Templates are offered by kosa8's hosts, so `template.create()` and `template.delete()` throw. Snapshots and forking are not exposed through this provider.
- Sandboxes created without `timeout` live until destroyed, so always call `destroy()` when you are done.

## Links

- [kosa8](https://kosa8.com)
- [Cloud dashboard](https://app.kosa8.com)
