---
description: >-
  Runtime provider for ComputeSDK — Firecracker microVM sandboxes for AI agents,
  with native command streaming, private preview URLs and snapshots.
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

# Runtime

[Runtime](https://withruntime.com) runs each sandbox as a Firecracker microVM
with its own Linux kernel and disk. The default image is Ubuntu 24.04 with
Python, Node.js, Bun, git and a compiler installed. The provider uses Runtime's
TypeScript SDK, [`withruntime`](https://www.npmjs.com/package/withruntime).

## Installation

```bash
npm install computesdk @computesdk/runtime
```

Requires Node.js 22 or later.

Set your API key, from <https://withruntime.com/account/keys>:

```bash
export RUNTIME_API_KEY=your_runtime_api_key
```

On a machine where you have run `npx withruntime login`, the provider uses the
key it saved and `RUNTIME_API_KEY` is optional.

## Usage

```typescript
import { runtime } from '@computesdk/runtime'

const compute = runtime({ apiKey: process.env.RUNTIME_API_KEY })

const sandbox = await compute.sandbox.create({
  envs: { NODE_ENV: 'production' },
  timeout: 10 * 60 * 1000,
})

try {
  const result = await sandbox.runCommand('node --version')
  console.log(result.stdout)

  await sandbox.runCommand('npm install', {
    cwd: '/workspace',
    onStdout: (text) => process.stdout.write(text),
  })

  await sandbox.runCommand('python3 -m http.server 3000', { background: true })
  console.log(await sandbox.getUrl({ port: 3000 }))
} finally {
  await sandbox.destroy()
}
```

## Configuration options

| Option              | Environment variable | Description                                                                                                  |
| ------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `apiKey`            | `RUNTIME_API_KEY`    | Runtime API key.                                                                                             |
| `baseUrl`           | `RUNTIME_API_URL`    | API origin. Defaults to `https://api.withruntime.com`.                                                       |
| `create`            | —                    | Defaults for every create: `image`, `region`, `vcpu`, `memoryMiB`, `diskMiB`, `funding`, `network` and more. |
| `previewVisibility` | —                    | `private` (default): the URL from `getUrl` carries a signed token. `public`: anyone with the address.        |
| `previewTtlSeconds` | —                    | How long a private preview's token lasts, from 60 seconds to 7 days. Defaults to one day.                    |

`compute.sandbox.create()` maps these options onto Runtime:

| ComputeSDK option               | Runtime                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `templateId` or `image`         | A Runtime image (`runtime image build`): its id, name, `name:tag` or version. |
| `snapshotId`                    | Start as a copy of a Runtime snapshot: files, memory and running processes.   |
| `name`                          | The sandbox's name.                                                           |
| `metadata`                      | Labels. Values that are not strings are stored as JSON.                       |
| `timeout`                       | The sandbox's lease, rounded up to whole seconds.                             |
| `vcpus`, `memoryMiB`, `diskMiB` | Its size.                                                                     |
| `envs`                          | Set on every command this provider runs in the sandbox.                       |
| `signal`                        | Cancels the create.                                                           |

## Supported operations

| Method          | Supported | Notes                                                                                              |
| --------------- | --------- | -------------------------------------------------------------------------------------------------- |
| `create`        | ✅        | Waits until the sandbox is running.                                                                |
| `getById`       | ✅        | Returns `null` for a missing or stopped sandbox. A paused sandbox is returned and wakes when used. |
| `list`          | ✅        | Every live sandbox in the account.                                                                 |
| `destroy`       | ✅        | Stops the sandbox and waits until it has stopped.                                                  |
| `runCommand`    | ✅        | `cwd`, `env`, `timeout`, `background`, and output callbacks.                                       |
| `streamCommand` | ✅        | Output streams through Runtime's API while the command runs; no port inside the sandbox needed.    |
| `getInfo`       | ✅        | Includes name, labels, state, region, size and lease end.                                          |
| `getUrl`        | ✅        | A Runtime preview for the port.                                                                    |
| `filesystem`    | ✅        | Native file calls: read, write, mkdir, readdir, exists, remove.                                    |
| `snapshot`      | ✅        | `create`, `list` and `delete`. A snapshot keeps files, memory and running processes.               |
| `template`      | ❌        | Build Runtime images with `runtime image build` or `withruntime`, then pass one as `templateId`.   |

## Commands

A command runs under `bash -c`. Without a `timeout`, Runtime gives it 60
seconds; a `timeout` can be up to 24 hours. A command that runs past its
timeout returns exit code 124 with the output it wrote so far.

`background: true` starts a Runtime process and returns at once. Its output
stays readable through `sandbox.getInstance().processes`.

Environment variables passed as `envs` at create are held by the provider
object that created the sandbox and applied to every command, under each
command's own `env`. A sandbox reached through `getById` or `list` does not
have them; pass `env` to `runCommand` there.

## Preview URLs

`getUrl({ port })` shares the port at `https://<port>-<sandbox>.runtimehost.com/`
and returns a private link that carries a signed token. A browser that opens
the link keeps the token as a cookie for that site. The server in the sandbox
must listen on `0.0.0.0` or `localhost`.

A client that does not keep cookies, such as `fetch` or a WebSocket client,
sends the token as a header instead:

```typescript
const preview = await sandbox.getInstance().previews.get(3000)
await fetch(preview.url, { headers: { 'x-runtime-preview-token': preview.token! } })
```

With `previewVisibility: 'public'`, anyone with the address can open it, and a
browser sees a one-time page naming Runtime first.
