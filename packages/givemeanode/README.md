# @computesdk/givemeanode

[givemeanode](https://givemeanode.com) provider for ComputeSDK. Firecracker
microVM sandboxes served from a per-region door, with a warm pool of
pre-forked guests behind it: a create the pool covers hands over a sandbox
that is already running, so it costs neither a boot nor a fork.

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
# Optional. Defaults to the public door in us-west-2. Point this at the
# door in YOUR region: the network is the largest term in a sandbox
# create once the door is fast.
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
| `baseUrl` | `string` | `GMN_API_HOST`, else `https://api.givemeanode.com` | Which regional door to talk to. |
| `fastToken` | `'absorb' \| 'prime' \| 'off'` | `'absorb'` | See below. |
| `ramGib` | `number` | 2 | Guest memory. `memoryMiB` / `memMiB` / `memory` on `create` are read too and rounded up to whole GiB. |
| `egress` | `'open' \| 'none'` | host default | Whether the guest can reach the network. Fixed at bake time, not per exec. |
| `timeout` | `number` | 120000 | Per-request timeout in ms. |

## The signed credential, and why you get it for free

Every authenticated request on the door normally opens with one indexed
database read that resolves the bearer to its org, workspace, scopes and
ban state. It is around 15 ms, it can only be served from the primary, and
a create-then-exec pays it **twice**.

The door removes it for callers that opt in, by handing a **signed**
credential back on the response of any request made with a `gmnt_` bearer:

```
gmn-fast-token:         gmns_<compact EdDSA JWT>
gmn-fast-token-expires: 2026-08-30T19:48:19Z
```

A request presenting that token is verified in CPU - a signature check and
two in-process hash lookups - and touches no database at all. This package
absorbs the offer and presents it automatically. There is **nothing to
configure, nothing new to store, and no extra round trip**: the offer rides
on a response you were already getting, and your `gmnt_` token stays the
only secret you hold. Every failure falls back to the ordinary credential,
so a token that cannot be verified is never worse than not having one.

Three modes, because the right one depends on your shape:

- **`absorb`** (default) never adds a round trip. Your first request pays
  the read, its response carries the token, and everything after it -
  including the exec leg of that very first create - is served in CPU.
- **`prime`** pays one cheap authenticated request up front, single-flighted
  across every caller sharing the credential. Use it when you start **N
  sandboxes at once**: without it all N take their own first call down the
  database path.
- **`off`** never presents one. Every request pays the read.

```typescript
const compute = givemeanode({
  apiKey: process.env.GMN_TOKEN,
  fastToken: 'prime', // starting a burst
})
```

What it costs, stated plainly: a signed token is valid for its own lifetime
regardless of what happens to the credential behind it, so `gman token
revoke` stops anything **new** immediately but a token already in a
client's hands keeps working until it expires. Bans behave the same way.
That window is one token lifetime and no longer.

## Snapshots and forks

A sandbox can be snapshotted, and a snapshot forked. A fork is the fastest
way to get N copies of a prepared environment, because it skips both the
boot and the bake:

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
| `snapshot.create` / `list` / `delete` | yes |
| `getUrl` (inbound ports) | **no** - see below |
| streaming stdout/stderr | not natively; the SDK's bridge applies |

## Two behaviours worth knowing about

**Writes go through base64, not a heredoc.** A heredoc's body is every line
up to its marker, so it can only ever produce a file *ending in a
newline*: writing `hello` and reading it back gave `hello\n`. Base64 has
no such rounding, needs no escaping (the alphabet is shell-inert), and
carries content a heredoc cannot - no trailing newline, a line equal to
the marker, arbitrary bytes. The cost is that the encoded content rides in
one argv entry, so **a single `writeFile` is bounded by the guest's
ARG_MAX**, typically around 1.5 MB of content. Every givemeanode image
ships coreutils, so `base64` is present in all of them.

**An exec is retried once, and only for one error.** The exec channel is a
websocket lane the host reaps when idle, so the first command after a
quiet stretch can find the lane gone; the door answers with "the sandbox's
host did not answer the exec call; retry" and a retry re-dials. Nothing
else is retried - a command that ran and failed has an exit code and is
returned as a result, not an exception. In the rare case where the host
did receive the request before the channel dropped, the retry means the
command can run twice, so pass `execRetries: 0` for a workload where that
matters.

## Limitations

- **No inbound ports.** A givemeanode sandbox reaches out; nothing dials
  in, and its egress posture is fixed when the guest is baked rather than
  per exec. `getUrl` throws. A workload that has to be reachable belongs on
  a givemeanode *node* rather than a sandbox.
- **Images are curated, not arbitrary.** `image` names one of givemeanode's
  images (`sbx-base`, `sbx-min`, `sbx-task`), not a Docker reference. The
  default, `sbx-base`, carries python3, node 24, git, curl and a compiler,
  so it serves both the `node` and `python` runtimes.
- **Regional doors are not interchangeable.** Set `baseUrl` to the door in
  your own region.
