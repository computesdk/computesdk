---
description: >-
  givemeanode for ComputeSDK - very fast microVM sandboxes, from any
  digest-pinned container image or from givemeanode's curated images, with
  templates and snapshots for starting many at once.
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

[givemeanode](https://givemeanode.com) provider for ComputeSDK. Very fast
microVM sandboxes.

## Installation & Setup

```bash
npm install @computesdk/givemeanode
```

Add your givemeanode credentials to a `.env` file:

```bash
GMN_TOKEN=your_givemeanode_service_token
# Optional. Defaults to us-west-2 - set this to the endpoint nearest your
# workload.
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
| `baseUrl` | `string` | `GMN_API_HOST`, else `https://api.givemeanode.com` | Which regional endpoint to use. |
| `fastToken` | `'absorb' \| 'prime' \| 'off'` | `'absorb'` | How to use the signed credential. |
| `ramGib` | `number` | `2` | Guest memory in GiB. |
| `egress` | `'open' \| 'none'` | account default | Whether the guest can reach the network. |
| `execRetries` | `number` | `1` | Retries for an undelivered command. |
| `timeout` | `number` | `120000` | Per-request timeout in milliseconds. |

## Container images

Pass any container image by digest:

```typescript
const sandbox = await compute.sandbox.create({
  image: 'ghcr.io/acme/task@sha256:abc...',
})
```

Or prepare it once and start many sandboxes from it, which is much faster
per sandbox:

```typescript
const template = await compute.template.create({
  image: 'ghcr.io/acme/task@sha256:abc...',
})
const a = await compute.sandbox.create({ templateId: template.id })
const b = await compute.sandbox.create({ templateId: template.id })
```

- **The reference must be digest-pinned.** A tag is refused: it can be
  moved to point at different bytes, and the prepared image is cached under
  the image's identity, so a tag would eventually start a sandbox from
  content that no longer answers to that name. Read a digest with
  `docker buildx imagetools inspect <ref>` or `crane digest <ref>`.
- **Write the registry host in full**, so it is unambiguous which registry
  to authenticate to.
- **The first sandbox from a new image is slow**; every one after it is
  fast. The provider prepares a given image only once per process and
  shares the result, so starting N sandboxes from one image does not
  prepare it N times.

givemeanode's curated images are also available by name: `sbx-base` (the
default: python3, node 24, git, curl, a compiler), `sbx-min`, `sbx-task`.
Anything containing `@sha256:` is treated as a container image; anything
else as a curated name.

## The signed credential

Authenticating a request costs a round trip that presenting a signed
credential does not. givemeanode hands one back on the response to any
request made with your token, and this provider absorbs and presents it
automatically: nothing to configure, nothing new to store, no extra round
trip, and a fallback to the ordinary token on any failure.

Set `fastToken: 'prime'` when you start many sandboxes at once, so the
burst does not send every one of them down the ordinary path:

```typescript
const compute = givemeanode({
  apiKey: process.env.GMN_TOKEN,
  fastToken: 'prime',
})
```

A signed credential is valid for its own lifetime regardless of what
happens to the token behind it, so revoking a token stops anything new at
once, but a credential already issued keeps working until it expires.

## Snapshots

```typescript
const snapshot = await compute.snapshot.create(sandbox.sandboxId)
const copy = await compute.sandbox.create({ snapshotId: snapshot.id })
```

This is the fastest way to get N copies of a prepared environment.

## Preview URLs

`getUrl({ port })` returns a public HTTPS URL that reaches a server
running inside the sandbox:

```typescript
await sandbox.runCommand('sh', ['-c', 'cd app && (npm run dev > /tmp/dev.log 2>&1 &)'])
const url = await sandbox.getUrl({ port: 3000 })
```

Three things decide whether it works:

- **The server listens on the sandbox's loopback.** `127.0.0.1:3000` is
  what dev servers bind by default and is exactly right. The host reaches
  in over vsock and the guest dials its own loopback, so no packet
  arrives on the guest's network interface, and a sandbox prepared with
  `egress: 'none'` serves a preview URL all the same.
- **The server outlives the command that started it.** `runCommand` waits
  for its command's output to end, so `npm run dev &` on its own holds
  the call open until its deadline and then dies with it. Redirect the
  output, as above.
- **The URL is the secret.** The hostname carries an unguessable
  capability, so treat it like a password. It expires (24 hours by
  default) and dies with the sandbox; `unexposePort(sandbox, port)`
  closes it sooner.

The call is idempotent per port, so the same port returns the same URL
with a refreshed expiry and there is nothing to cache. Streaming, SSE and
WebSocket all pass through; `protocol: 'wss'` returns the same URL with
the scheme swapped.

## Features

| Feature | Supported |
|---|---|
| Create / get / list / destroy | yes |
| Run commands (cwd, env, background, timeout) | yes |
| Filesystem operations | yes |
| Templates from a container image | yes |
| Snapshots | yes |
| Preview URLs (`getUrl`) | yes |

## Limitations

- **A preview URL is HTTP(S) only, and it is a preview rather than a
  CDN.** Requests ride one proxy hop, which suits a dev server or an API
  you are testing and not production traffic. A raw TCP port cannot be
  exposed.
- **Container images must be digest-pinned and registry-qualified**, and
  the first sandbox from a new one is slow.
- **`writeFile` is bounded** by the guest's ARG_MAX, around 1.5 MB of
  content, because the content travels as one argument.
- **Regional endpoints are not interchangeable.** Set `baseUrl` to the one
  nearest your workload.
