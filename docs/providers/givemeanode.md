---
description: >-
  givemeanode for ComputeSDK - Firecracker microVM sandboxes served from a
  per-region door with a warm pool of pre-forked guests, plus snapshots and
  forks for getting N copies of a prepared environment at once.
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

# givemeanode

[givemeanode](https://givemeanode.com) provider for ComputeSDK. Firecracker
microVM sandboxes served from a per-region door, with a warm pool of
pre-forked guests behind it: a create the pool covers hands over a sandbox
that is already running, so it costs neither a boot nor a fork.

## Installation & Setup

```bash
npm install @computesdk/givemeanode
```

Add your givemeanode credentials to a `.env` file:

```bash
GMN_TOKEN=your_givemeanode_service_token
# Optional. Defaults to the public door in us-west-2 - point this at the
# door in your own region.
GMN_API_HOST=https://api.use1.givemeanode.com
```

Mint the token from [/team](https://givemeanode.com/team) or the CLI. It is
shown once:

```bash
gman token create --name computesdk --workspace my-workspace
```

## Usage

```typescript
import { givemeanode } from '@computesdk/givemeanode'

const compute = givemeanode({
  apiKey: process.env.GMN_TOKEN,
})

const sandbox = await compute.sandbox.create()

const result = await sandbox.runCommand('node -v')
console.log(result.stdout) // v24.19.0

await sandbox.destroy()
```

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | `GMN_TOKEN` | The `gmnt_` org service token. |
| `baseUrl` | `string` | `GMN_API_HOST`, else `https://api.givemeanode.com` | Which regional door to talk to. |
| `fastToken` | `'absorb' \| 'prime' \| 'off'` | `'absorb'` | How to use the door's signed credential. |
| `ramGib` | `number` | `2` | Guest memory in GiB. |
| `egress` | `'open' \| 'none'` | host default | Whether the guest can reach the network. |
| `timeout` | `number` | `120000` | Per-request timeout in milliseconds. |

## The signed credential

Every authenticated request on the door normally opens with one indexed
database read resolving the bearer to its org, workspace, scopes and ban
state - around 15 ms, servable only from the primary, and paid twice by a
create-then-exec.

The door hands a **signed** credential back on the response of any request
made with a `gmnt_` bearer, and a request presenting that credential is
verified in CPU rather than against the database. This provider absorbs and
presents it automatically: nothing to configure, nothing new to store, no
extra round trip, and a fallback to the ordinary credential on any failure.

Set `fastToken: 'prime'` when you start many sandboxes at once, so the
burst does not send every one of its creates down the database path:

```typescript
const compute = givemeanode({
  apiKey: process.env.GMN_TOKEN,
  fastToken: 'prime',
})
```

A signed credential is valid for its own lifetime regardless of what
happens to the token behind it, so revoking a token stops anything new at
once but a signed credential already issued keeps working until it expires.

## Snapshots and forks

```typescript
const snapshot = await compute.snapshot.create(sandbox.sandboxId)
const copy = await compute.sandbox.create({ snapshotId: snapshot.id })
```

Forking a snapshot skips both the boot and the bake, which is what makes N
copies of a prepared environment cheap.

## Supported runtimes

`sbx-base`, the default image, carries python3, node 24, git, curl and a
compiler, so it serves both the `node` and `python` runtimes. `sbx-min`
(bash and coreutils) and `sbx-task` (python3 with numpy) are also
available. Image names are givemeanode's own, not Docker references.

## Features

| Feature | Supported |
|---|---|
| Create / get / list / destroy | yes |
| Run commands (cwd, env, background, timeout) | yes |
| Filesystem operations | yes |
| Snapshots and forks | yes |
| Inbound ports (`getUrl`) | no |

## Limitations

- **No inbound ports.** A sandbox reaches out; nothing dials in, and its
  egress posture is fixed when the guest is baked rather than per exec.
  `getUrl` throws. A workload that must be reachable belongs on a
  givemeanode node.
- **Curated images.** `image` names a givemeanode image, not a Docker
  reference.
- **Regional doors are not interchangeable.** Set `baseUrl` to the door in
  your own region.
