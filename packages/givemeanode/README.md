# @computesdk/givemeanode

[givemeanode](https://givemeanode.com) provider for ComputeSDK. Very fast
microVM sandboxes.

## Installation & Setup

```bash
npm install @computesdk/givemeanode
```

Mint a token and put it in a `.env` file. Any org admin can mint one from
[/team](https://givemeanode.com/team) or the CLI; it is shown once.

```bash
gman token create --name computesdk --workspace my-workspace
# prints GMN_TOKEN=gmnt_... once
```

```bash
GMN_TOKEN=gmnt_your_token
# Optional. Defaults to us-west-2. givemeanode runs an endpoint per region
# and they are not interchangeable for latency, so set this to the one
# nearest your workload.
GMN_API_HOST=https://api.use1.givemeanode.com
```

## Usage

```typescript
import { givemeanode } from '@computesdk/givemeanode'

const compute = givemeanode({ apiKey: process.env.GMN_TOKEN })

const sandbox = await compute.sandbox.create()
const result = await sandbox.runCommand('node -v')
console.log(result.stdout) // v24.19.0
await sandbox.destroy()
```

## Configuration

| Option | Type | Default | What it does |
|---|---|---|---|
| `apiKey` | `string` | `GMN_TOKEN` | The `gmnt_` org service token. |
| `baseUrl` | `string` | `GMN_API_HOST`, else `https://api.givemeanode.com` | Which regional endpoint to use. |
| `fastToken` | `'absorb' \| 'prime' \| 'off'` | `'absorb'` | See below. |
| `ramGib` | `number` | 2 | Guest memory. `memoryMiB` / `memMiB` / `memory` on `create` are read too and rounded up to whole GiB. |
| `egress` | `'open' \| 'none'` | account default | Whether the guest can reach the network. Fixed when the guest image is prepared, not per command. |
| `execRetries` | `number` | 1 | See "Two behaviours worth knowing about". |
| `timeout` | `number` | 120000 | Per-request timeout in ms. |

## Container images

Pass any container image by digest and givemeanode will run it:

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

Three things to know:

- **The reference must be digest-pinned.** `ghcr.io/acme/task:latest` is
  refused; `ghcr.io/acme/task@sha256:<64 hex>` is accepted. A tag can be
  moved to point at different bytes, and the prepared image is cached under
  the image's identity, so a tag would eventually start a sandbox from
  content that no longer answers to that name. Read a digest with
  `docker buildx imagetools inspect <ref>` or `crane digest <ref>`.
- **Write the registry host in full.** `alpine@sha256:...` is refused
  because it does not say which registry to authenticate to.
- **The first sandbox from a new image is slow**, because the image has to
  be prepared before anything can start; every one after it is fast. Use
  `template.create` when you know the image up front. The provider prepares
  a given image only once per process and shares the result, so starting N
  sandboxes from one image does not prepare it N times.

givemeanode's own curated images are also available by name (`sbx-base`,
the default, has python3, node 24, git, curl and a compiler; `sbx-min` and
`sbx-task` are smaller). Anything containing `@sha256:` is treated as a
container image; anything else is treated as a curated name.

## The signed credential, and why you get it for free

Authenticating a request costs a round trip that presenting a signed
credential does not. givemeanode hands one back on the response to any
request made with your `gmnt_` token:

```
gmn-fast-token:         gmns_<compact JWT>
gmn-fast-token-expires: 2026-08-30T19:48:19Z
```

This package absorbs that offer and presents it automatically. There is
**nothing to configure, nothing new to store, and no extra round trip**:
the offer rides on a response you were already getting, and your `gmnt_`
token stays the only secret you hold. Every failure falls back to the
ordinary credential, so a credential that cannot be used is never worse
than not having one.

Three modes, because the right one depends on your shape:

- **`absorb`** (default) never adds a round trip. Your first request pays
  the ordinary cost, its response carries the credential, and everything
  after it is cheaper.
- **`prime`** pays one cheap request up front, single-flighted across every
  caller sharing the token. Use it when you start **N sandboxes at once**:
  without it, all N take the ordinary path.
- **`off`** never presents one.

```typescript
const compute = givemeanode({
  apiKey: process.env.GMN_TOKEN,
  fastToken: 'prime', // starting a burst
})
```

What it costs, stated plainly: a signed credential is valid for its own
lifetime regardless of what happens to the token behind it, so `gman token
revoke` stops anything **new** immediately, but a credential already in a
client's hands keeps working until it expires. Bans behave the same way.
That window is one credential lifetime and no longer.

## Snapshots

A sandbox can be snapshotted, and a snapshot started from. This is the
fastest way to get N copies of a prepared environment:

```typescript
const snapshot = await compute.snapshot.create(sandbox.sandboxId)
const copy = await compute.sandbox.create({ snapshotId: snapshot.id })
```

## Supported

| Feature | Supported |
|---|---|
| `sandbox.create` / `getById` / `list` / `destroy` | yes |
| `runCommand` (cwd, env, background, timeout) | yes |
| `filesystem` (read, write, mkdir, readdir, exists, remove) | yes, over `runCommand` |
| `template.create` / `list` / `destroy` | yes, from a container image |
| `snapshot.create` / `list` / `delete` | yes |
| `getUrl` (inbound ports) | **no** - see below |
| streaming stdout/stderr | not natively; the SDK's bridge applies |

## Two behaviours worth knowing about

**Writes go through base64, not a heredoc.** A heredoc's body is every line
up to its marker, so it can only ever produce a file *ending in a
newline*: writing `hello` and reading it back gave `hello\n`. Base64 has no
such rounding, needs no escaping (the alphabet is shell-inert), and carries
content a heredoc cannot - no trailing newline, a line equal to the marker,
arbitrary bytes. The cost is that the encoded content rides in one argv
entry, so **a single `writeFile` is bounded by the guest's ARG_MAX**,
typically around 1.5 MB of content. Every givemeanode image ships
coreutils, so `base64` is present.

**A command is retried once, and only for one error.** The connection to a
sandbox is re-established on demand, so the first command after a quiet
stretch can find it closed and needs a redial. Nothing else is retried - a
command that ran and failed has an exit code and is returned as a result,
not an exception. In the rare case where the sandbox did receive the
request before the connection dropped, the retry means the command can run
twice, so pass `execRetries: 0` for a workload where that matters.

## Limitations

- **No inbound ports.** A givemeanode sandbox reaches out; nothing dials
  in, and whether it has network at all is fixed when its image is
  prepared rather than per command. `getUrl` throws. A workload that has to
  be reachable belongs on a givemeanode *node* rather than a sandbox.
- **Container images must be digest-pinned and registry-qualified**, and
  the first sandbox from a new one is slow. See "Container images".
- **Regional endpoints are not interchangeable.** Set `baseUrl` to the one
  nearest your workload.
