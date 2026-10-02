# RFC 0001: daemond dial-out tunnel for provider-agnostic sandbox port access

- Status: Draft
- Author: Devin (for garrison@computesdk.com)
- Prototype: `examples/daemond-tunnel-prototype/`

## Summary

Let a control-plane application reach TCP/HTTP/WebSocket services running
*inside* a sandbox on **every** provider, without per-provider changes. The
sandbox's exec daemon (`daemond`) dials **out** to the control plane over a
single WebSocket and the control plane multiplexes many logical streams back
over that link. The control plane sees the sandbox's `localhost:<port>` as a
`fetch`-compatible target or a local TCP listener.

## Problem

`sandbox.getUrl({ port })` is the only SDK affordance for reaching a service in
a sandbox, and it is the least portable method we have. A survey of
`packages/*/src/index.ts` on `main`:

| Behaviour of `getUrl` | Providers |
| --- | --- |
| Throws unconditionally | agentcore, arker, cloud-run, cloudflare, collimate, freestyle, just-bash, namespace, railway, secure-exec, superserve |
| Throws unless the port was declared at create time / a service was pre-configured | archil, microsandbox, modal, sandbox0, upstash (ephemeral), quilt |
| Returns a URL but with caveats: auth headers, TTLs, https-only, per-port DNS records | mosaic (https only, previews expire), northflank (creates DNS entries), runloop (tunnel keys), codesandbox, daytona, e2b, vercel, ... |
| Returns a placeholder that never routes | k8s (`k8s-sandbox-url-not-configured.invalid`), sail (`undefined`) |

Roughly a third of providers cannot expose a port at all, and most of the rest
expose it differently. Callers that need to talk to something in the sandbox
(a dev server, an LSP, a debugger, a browser CDP endpoint, our own SSE event
stream) end up provider-specific.

We already have one such workaround in the framework. `packages/provider/src/factory.ts`
streams `runCommand` output by bootstrapping `daemond` and then subscribing to
its SSE endpoint — which requires `getUrl` to route to daemond's `ssePort`
(`resolveDaemonSseUrl`). Because that fails on the providers above, the
`SandboxMethods.streamCommand` escape hatch lets a provider supply a native
streaming path instead. That is a per-provider patch for one use case; the
next in-sandbox service will need another one.

Every sandbox we support has outbound internet (that is how they install
packages and how `daemond` bootstraps). So invert the direction: the sandbox
connects to us.

## Goals / non-goals

Goals

- Reach any `localhost:<port>` inside a sandbox from a control plane, on all
  providers, with one code path.
- HTTP (including streaming responses and SSE), WebSocket, and raw TCP.
- No extra binaries in the sandbox; Node only (daemond already requires Node).
- Reuse daemond's existing bootstrap, token, socket protocol, and SSE events.
- Explicit opt-in. Nothing changes for callers who do not ask for a tunnel.

Non-goals

- Replacing `getUrl`. Public, unauthenticated preview URLs for end users are a
  different product feature and stay provider-native.
- Sandbox-to-sandbox networking.
- Changing how output streaming works today (it is a follow-up, see below).

## Topology

```
control plane (Node)                              sandbox (any provider)
┌────────────────────────────┐                    ┌────────────────────────────┐
│ @computesdk/tunnel         │   wss:// dial-out  │ daemond                     │
│ createTunnelServer()       │◀───────────────────│  tunnel client              │
│   authenticate(token)      │  one WS / sandbox  │   reconnect + backoff       │
│   waitFor(sandboxId)       │                    │                             │
│   conn.fetch(url)   ──────▶│ open/data/close ──▶│ net.connect(127.0.0.1:port) │
│   conn.listen(l, r) ──────▶│   multiplexed      │   ◀──▶ app on :8787         │
└────────────────────────────┘                    └────────────────────────────┘
```

1. The control plane runs a tunnel endpoint (`createTunnelServer`) on a URL it
   knows about itself, e.g. `wss://cp.example.com/tunnel`.
2. When it creates a sandbox it mints a per-sandbox token and asks daemond to
   connect: `{ tunnel: { connect: url, token } }` via the seed launcher.
3. daemond opens **one** outbound WebSocket and authenticates. The control
   plane maps that socket to a `sandboxId`.
4. The control plane opens logical streams over the socket. For each stream,
   daemond opens a TCP connection to `127.0.0.1:<port>` and pipes bytes both
   ways. The control plane wraps each stream as a Node `Duplex`, so a normal
   `http.request` (with `createConnection`) or a local `net.Server` can sit on
   top of it.

Nothing listens for inbound traffic in the sandbox beyond what daemond already
binds on loopback.

### Wire protocol

One WebSocket, two frame kinds:

| Kind | WS frame | Content |
| --- | --- | --- |
| control | text | JSON object with a `t` discriminator |
| data | binary | `uint32be streamId` + payload (≤ 64 KiB per frame) |

Control messages:

| `t` | Direction | Fields | Meaning |
| --- | --- | --- | --- |
| `auth` | sandbox → cp | `token` | First frame when the token could not be sent as a header (Node's global `WebSocket` cannot set headers; the query string is also accepted) |
| `open` | cp → sandbox | `id`, `port`, `host?` | Connect to `host:port` (host must be loopback) |
| `opened` | sandbox → cp | `id` | TCP connect succeeded; data may flow |
| `close` | both | `id` | Half-close: sender sends no more data on `id` |
| `error` | both | `id?`, `code`, `message` | Stream-level (`ECONNREFUSED`, `PORT_NOT_ALLOWED`, `TOO_MANY_STREAMS`) or link-level when `id` is absent |
| `ping` / `pong` | both | `ts` | Liveness; the control plane pings every 15 s and drops the link after 10 s without a `pong` |

Stream ids are allocated by the control plane (odd, increasing) so that a
future sandbox-initiated stream (even ids) cannot collide. Data frames for an
unknown id are dropped; a `close` for an unknown id is ignored.

The design deliberately mirrors what yamux/SSH channels do, but stripped to the
minimum that a JSON+binary WebSocket can express in ~200 lines.

### Alternatives considered

| Option | Why not |
| --- | --- |
| **SSH reverse tunnel** (`ssh -R`) from the sandbox | Needs an `ssh` binary and a key in every image, an sshd on the control plane with per-sandbox key management, and TCP-only semantics. Several minimal images (distroless Node) lack `ssh`. |
| **Provider-native port forwarding** (`getUrl`, Modal tunnels, Runloop tunnel keys, ...) | This is the status quo; ~1/3 of providers cannot do it and the rest disagree on auth, TTL and protocol. Would remain N implementations. |
| **frp / chisel / bore / ngrok agent inside the sandbox** | Extra binary to download per architecture, another process to supervise, a separate auth model, and a second config surface. They also solve a broader problem (public ingress) than we need. |
| **HTTP long-poll / SSE + POST** instead of WebSocket | Works through the most restrictive egress but doubles round trips and complicates raw TCP. Kept as a documented fallback transport, not the default. |
| **WebSocket multiplexer inside daemond** (this RFC) | Zero extra binaries; Node ≥ 22 ships a `WebSocket` client, and daemond already has the bootstrap, token, supervisor and event bus. One implementation for all providers. |

## daemond protocol additions

daemond speaks newline-delimited JSON over its Unix socket (`health`, `exec`,
`wait`, `status`, `kill`, `subscribe`, `stop`). Add one message type, `tunnel`,
that carries one of three payloads. All require the daemon token like `exec`.

```jsonc
{ "type": "tunnel", "token": "<daemon token>", "payload": { "connect": "wss://cp.example.com/tunnel", "tunnelToken": "<per-sandbox token>", "allowPorts": [8787, "3000-3999"] } }
{ "type": "tunnel", "token": "...", "payload": { "status": true } }
{ "type": "tunnel", "token": "...", "payload": { "disconnect": true } }
```

Replies (`type: "tunnel_result"`):

```jsonc
{ "state": "connecting" | "connected" | "disconnected", "url": "wss://...", "connectedAt": 1710000000000, "reconnects": 3, "streamsOpen": 2, "lastError": null }
```

The seed launcher's `parseInput` today recognises `{ command }`, `{ wait }`,
`{ status }`, `{ kill }`; it gains `{ tunnel: { connect | status | disconnect } }`
so the SDK can drive it with the existing `daemonSeedScriptCommand(config, payload)`
helper — no new exec channel.

Runtime behaviour inside the daemon:

- Exactly one tunnel per daemon. A second `connect` with a different URL
  replaces the first; the same URL is a no-op that returns the current status.
- Reconnect with exponential backoff: 500 ms, doubling to a 10 s cap, ±25 %
  jitter, forever, until `disconnect` or `stop`. Streams do not survive a
  reconnect; the control plane sees them closed with `error {code:"LINK_LOST"}`.
- Published events on the existing bus (socket `subscribe` and the SSE
  `/events` endpoint): `tunnel.connected { url }`, `tunnel.disconnected { url, code, reason, willRetry }`,
  `tunnel.stream.error { id, code }` (debug-level, rate limited).
- The tunnel URL is part of the **seed invocation**, not the launcher script:
  the control plane knows its own URL, so it passes it in the payload exactly
  like `command`/`cwd`/`env` today. The `daemonSeedScript` config is not
  changed, which keeps the script hash — and therefore daemon reuse — stable.
- The tunnel client uses Node's global `WebSocket` (Node ≥ 22; Node 20 behind
  `--experimental-websocket`). Because that client cannot set request headers
  the token travels in the URL query (`?token=`) **and** as the first `auth`
  text frame; the server accepts either so a future header-capable client can
  drop the query form. The daemon-bootstrap Node version check already exists
  in the launcher; it gains a `tunnel requires Node >= 22` error path.

### Token minting and verification

- The **daemon token** (already exists, stable per workspace daemon) protects
  the Unix socket and SSE endpoint inside the sandbox. It never leaves the
  sandbox except in the launcher's stdout JSON that the SDK already reads.
- The **tunnel token** is minted by the control plane per sandbox, before the
  `connect` payload is sent, and is opaque to daemond. Recommended shape: a
  random 32-byte value stored server-side keyed by `sandboxId`, or a short-lived
  signed token (`HMAC(sandboxId, exp)`) if the control plane is multi-instance
  and does not want shared state. `createTunnelServer({ authenticate })` takes a
  callback precisely so both are possible.
- Verification happens once per WebSocket, at upgrade (query) or on the first
  `auth` frame; unauthenticated sockets are closed with `4401` after 5 s.
  A second successful connection for the same `sandboxId` replaces the first
  (`4409` to the old one), which is what makes daemon reconnects and
  control-plane restarts converge.
- The tunnel token reaches the sandbox via the exec channel (the provider's
  `runCommand`), the same channel that carries `env` secrets today. Providers
  that log commands would log it; `argvEncoding: "base64"` already obscures it
  from naive shell logging and the token can be rotated by re-issuing `connect`.

## SDK surface

### Sandbox side (`@computesdk/provider`, later `computesdk`)

```ts
interface TunnelOptions {
  url: string;          // wss://control-plane/tunnel
  token: string;        // per-sandbox token minted by the control plane
  allowPorts?: Array<number | `${number}-${number}`>; // default: any loopback port
  timeoutMs?: number;   // wait for tunnel.connected, default 30_000
}

interface TunnelHandle {
  readonly url: string;
  status(): Promise<TunnelStatus>;
  disconnect(): Promise<void>;
}

// on Sandbox
connectTunnel(options: TunnelOptions): Promise<TunnelHandle>;
```

`connectTunnel` bootstraps daemond if needed (same path as streaming), sends
`{ tunnel: { connect } }`, and resolves once the daemon reports
`state: "connected"` (polling `status` or watching the `tunnel.connected`
event through the existing SSE bridge if it is available). It throws a
`daemond:`-prefixed error on sandboxes without a usable Node, matching the
existing convention in `parseDaemonSeedResult`.

### Control-plane side: new package `@computesdk/tunnel`

Node-only, depends on `ws` and nothing from `packages/*`; a control plane that
never creates sandboxes itself can still run the server.

```ts
const server = createTunnelServer({
  port?: number;                    // or
  server?: http.Server;             // attach to an existing server (path defaults to /tunnel)
  path?: string;
  authenticate(token: string): Promise<string | null> | string | null; // → sandboxId
  maxStreamsPerConnection?: number; // default 256
  pingIntervalMs?: number;          // default 15_000
});

const conn = await server.waitFor(sandboxId, { timeoutMs });   // resolves when the sandbox dials in

conn.fetch(input, init?): Promise<Response>;                   // WHATWG fetch; host:port of the URL selects the in-sandbox port
conn.open(port, host?): Promise<stream.Duplex>;                // raw stream, for WebSocket clients, DB drivers, CDP, ...
conn.listen(localPort, remotePort, localHost?): Promise<net.Server>; // optional local TCP forward
conn.on("close", (info) => {});
conn.stats; // { streamsOpen, bytesIn, bytesOut }
server.close();
```

`conn.fetch` is implemented with `node:http`'s `createConnection` option
pointing at `conn.open(port)`, so redirects, chunked encoding, streaming
bodies and `Response.body` as a `ReadableStream` come for free. For `https://`
URLs the sandbox app's TLS is terminated by the caller on top of the duplex
(rare; documented, not special-cased).

### `getUrl` is not changed

Tunnels are an explicit opt-in and `getUrl` keeps its current semantics, for
three reasons:

1. **Different consumers.** `getUrl` yields a URL a *browser or third party*
   can open. A tunnel yields a connection only the control-plane process that
   holds `conn` can use. Returning `http://127.0.0.1:54321` (a `listen`
   forward) from `getUrl` would be a URL that works on exactly one machine and
   silently breaks the moment it is handed to a user.
2. **Lifecycle.** A tunnel exists only while the control plane process is
   alive and has called `connectTunnel`. `getUrl` today is stateless. Making it
   depend on hidden tunnel state would make failures non-local.
3. **Cost and security.** Establishing a tunnel spawns daemond and holds a
   persistent outbound socket; it must not happen as a side effect of a
   read-only-looking call, and the port allowlist is a per-tunnel decision.

Instead, callers pick: `getUrl` for public previews where the provider supports
it, `connectTunnel` for control-plane access everywhere. A convenience
`compute.sandbox.create({ tunnel: { url, token } })` option can connect at
creation time in a later PR.

### Self-hosting

There is no separate service to deploy. The tunnel endpoint is a WebSocket
route inside the control-plane application that already creates sandboxes:

```ts
import { createTunnelServer } from "@computesdk/tunnel";

// 1. attach to the HTTP server you already run, behind your existing LB/TLS
const tunnel = createTunnelServer({
  server: httpServer,
  path: "/tunnel",
  authenticate: (token) => db.sandboxIdForTunnelToken(token), // you mint + verify
});

// 2. per sandbox: mint a token, tell daemond where to dial
const sandbox = await compute.sandbox.create();
const token = randomToken();
await db.saveTunnelToken(sandbox.sandboxId, token);
await sandbox.connectTunnel({ url: "wss://cp.example.com/tunnel", token });

// 3. use it
const conn = await tunnel.waitFor(sandbox.sandboxId);
await conn.fetch("http://localhost:8787/health");
```

Requirements: a hostname the sandbox can reach (public, or routable from the
provider's network), outbound internet from the sandbox, and Node ≥ 22 in the
sandbox (already required by daemond). State is one `token → sandboxId`
mapping. Multi-instance control planes route by `sandboxId` (sticky endpoint
or a thin router in front; see Failure modes).

The cost of self-hosting is that a machine without ingress — a laptop behind
NAT, a CI runner — cannot receive the dial-back. This is why the tunnel is
opt-in rather than implicit, why a dev-tunnel workflow (`cloudflared`,
`ngrok`, …) should be documented, and why a ComputeSDK-hosted endpoint
(below) is the natural default for users who do not want to expose anything.

## Interaction with existing streaming (follow-up, not in this RFC's PRs 1–2)

Once a tunnel is connected, `factory.ts` no longer needs a routable port for
daemond's SSE endpoint: `resolveDaemonSseUrl` can return the SSE URL unchanged
and `streamDaemonEvents` can call `conn.fetch(sseUrl)` instead of global
`fetch`. That removes the `getUrl` dependency from streaming on every provider
and makes `streamCommand` an optimisation rather than a requirement. The
change is contained (two functions and a way for the `Sandbox` to find its
`TunnelConnection`, e.g. `options.tunnel` on `runCommand` or a sandbox-level
default) and is tracked as PR 3 below.

## Security

- **Authentication**: one token per sandbox, verified by the control plane at
  connect time. daemond never accepts inbound connections for the tunnel; it
  only initiates them. The control plane cannot open a stream before
  authentication succeeds.
- **Authorisation of targets**: daemond only connects to loopback
  (`127.0.0.1`, `::1`, `localhost`). `allowPorts` restricts further; the
  default is any loopback port because the control plane already has
  arbitrary exec in the sandbox, so port restriction is defence in depth
  rather than a boundary. Denied opens return `PORT_NOT_ALLOWED`.
- **No new inbound listener** in the sandbox. The SSE server daemond already
  binds on `127.0.0.1` is unchanged.
- **Transport**: `wss://` in production; the server refuses to start with a
  plain `ws://` URL unless `allowInsecure: true` (local dev, tests).
- **Blast radius**: a leaked tunnel token lets an attacker impersonate one
  sandbox's daemon to the control plane — i.e. answer the control plane's
  requests with attacker data. It does not grant access into the sandbox.
  Tokens are revoked by `disconnect` + rotating server-side state.
- **Resource limits**: per-connection max streams (default 256), per-frame
  payload cap (64 KiB), server-side idle timeout, and `authenticate` is the
  natural place for per-tenant connection quotas.

## Failure modes

| Scenario | Behaviour |
| --- | --- |
| Control plane restart | All sockets drop. daemond reconnects with backoff (converges within ~10 s of the endpoint returning). `waitFor(sandboxId)` on the new process resolves when the daemon dials in; in-flight streams are lost and surface as `LINK_LOST` to the old process only. Multi-instance control planes need the tunnel endpoint to be sticky or to route by `sandboxId` (out of scope; `authenticate` returns the id so a router can be layered). |
| Sandbox pause/resume (snapshot providers) | The socket is dead on resume. daemond's timer fires, detects the closed socket (or the control plane's ping timeout does) and reconnects. If the daemon process itself is not restored, the next `connectTunnel`/streaming call re-bootstraps it — same as today. |
| Sandbox destroyed | Control plane sees the socket close; `conn` emits `close`; pending `open`s reject. |
| Target port not listening | `error { id, code: "ECONNREFUSED" }`; `conn.open` rejects; `conn.fetch` throws a `TypeError` like fetch does for network errors. |
| Backpressure | Per-stream: the sandbox pauses the TCP socket when `ws.bufferedAmount` exceeds 1 MiB and resumes on drain; the control plane's `Duplex` honours `push()` return values and pauses reads the same way. Because one WS carries all streams, a slow consumer on one stream can slow others (head-of-line blocking). Acceptable for v1; per-stream window credits (like yamux) are the documented upgrade path if it bites. |
| Max concurrent streams | `TOO_MANY_STREAMS` error for the `open`; existing streams are unaffected. |
| Frame size | Payloads are chunked at 64 KiB by the sender; the server sets `maxPayload` to 64 KiB + 4 and closes the socket with `1009` on violation. |
| Egress blocks WebSockets | Detected as a persistent connect failure; `tunnel.disconnected` carries the error; `connectTunnel` rejects after `timeoutMs`. Long-poll fallback transport is the future answer. |
| Node < 22 in the sandbox | `connectTunnel` fails fast with `daemond: tunnel requires Node >= 22`. |

## Rollout

| PR | Contents | Size |
| --- | --- | --- |
| 1 | daemond: `tunnel` socket message, tunnel client (`connect`/reconnect/backoff, `open`/`opened`/`close`/`error`/`ping`), `tunnel.*` events, `allowPorts`, unit tests against an in-process `ws` server, Docker integration test | **medium** — ~400 lines in `seed-launcher.ts` + launcher `parseInput`, most of the work is tests |
| 2 | new `@computesdk/tunnel` (server, `TunnelConnection`, `fetch`/`open`/`listen`), `Sandbox.connectTunnel` in `@computesdk/provider` + `computesdk`, docs page | **medium** — the prototype is ~80 % of the server; SDK plumbing is small |
| 3 | route the daemond SSE bridge in `factory.ts` over the tunnel when one exists; `streamCommand` becomes optional-optimisation | **small** — two functions, plus a test on a provider whose `getUrl` throws (namespace/railway) |

Each PR ships a `patch` changeset per repo policy.

## Prototype findings

_Filled in from `examples/daemond-tunnel-prototype/demo.mjs`; see the README in that
directory for how to reproduce._

What was built (~800 lines of plain `.mjs`, no build step):

- `protocol.mjs` — frame codec (JSON text control frames, binary
  `uint32be id + payload` data frames, 64 KiB payload cap, odd id allocator).
- `tunnel-client.mjs` — the daemond side, using only `node:net` and Node 22's
  global `WebSocket`; allowlist, backpressure, jittered backoff reconnect.
- `tunnel-server.mjs` — `createTunnelServer` on `ws`; `TunnelConnection` with
  `open()` → `Duplex`, `fetch()` built on `http.request({ createConnection })`
  returning a WHATWG `Response`, `listen()` raw TCP forward.
- `demo.mjs` — local end-to-end run; sandbox mode gated on
  `COMPUTESDK_API_KEY` + `TUNNEL_PUBLIC_URL`.

Local mode results (Node 22.23, Linux, 3 runs, 11/11 checks each, exit 0):

| Check | Result |
| --- | --- |
| Auth via `?token=` and first `auth` frame | works; unknown token closed with `4401` |
| `GET /hello` round trip through `conn.fetch` | p50 **0.63 ms**, p99 16–28 ms over 50 sequential requests; p99 is the first-request outlier (stream open + TCP connect), steady-state max ≈ 2 ms |
| `POST /echo` 100 KB body | byte-exact round trip |
| `GET /big` 5 MiB | **~380–395 MB/s** through the multiplexer (64 KiB frames) |
| `GET /slow` chunked response | chunks observed at 0/201/402/603/804 ms — responses stream incrementally, so SSE over the tunnel is viable |
| 20 concurrent `fetch`es on one link | all succeed |
| `open(9)` (nothing listening) | `ECONNREFUSED` surfaces on the control plane as a rejected `open` |
| `allowPorts: p => p === 8787`, open 8788 | `PORT_NOT_ALLOWED` |
| `listen(0, 8787)` + plain global `fetch` on the local port | works (raw TCP forward) |
| Server-side `ws.terminate()` | client reconnects in **~520–650 ms** (500 ms backoff floor + jitter), `waitFor` resolves again, `fetch` works |

Surprises / things to carry into PR 1–2:

- Node's global `WebSocket` cannot set request headers, hence the
  query-string + `auth`-frame dual delivery in the protocol section.
- `http.request({ createConnection })` still resolves `host` via DNS unless
  `host` is an IP literal; set `host: '127.0.0.1'` and put the logical
  `Host` header in explicitly.
- A tunnelled `Duplex` needs a no-op `read()` and an `error` listener on every
  consumer, otherwise a stream destroyed after the response has been consumed
  raises an unhandled `'error'` and takes the process down.
- The `bufferedAmount` polling used for backpressure on the client is a
  20 ms interval; the real daemond implementation should use per-stream
  window credits instead of polling.

Sandbox mode was **not** run:

- Provisioning a sandbox needs a provider credential in addition to
  `COMPUTESDK_API_KEY` (`compute.sandbox.create()` → "No compute provider
  configured"; the `compute run` CLI likewise needs e.g. `NSC_TOKEN`). None
  is available in this environment.
- This machine sits behind NAT (private NIC `10.0.0.2`) with no public
  ingress, so even with a sandbox the control plane would not be reachable
  from it without third-party hosting, which was out of bounds. Inbound
  reachability was therefore not verified, only inferred from the network
  layout.

`demo.mjs --sandbox` implements the flow (create sandbox → `writeFile`
client → background `node` HTTP server + tunnel client → `waitFor` →
`fetch`) and prints the local listener port for whoever can supply
`TUNNEL_PUBLIC_URL`; running it on a host with ingress and a provider key is
the first task of PR 1.

## Future directions (not in this RFC's PRs)

The dial-out link is the primitive; this RFC only uses it for control-plane
→ sandbox access. The same link and frames support:

1. **Public HTTP ingress (replaces the need for `getUrl`)**. A reverse proxy in
   front of the tunnel server maps `https://<port>-<sandboxId>.<host>` to
   `conn.fetch`/`conn.open` (including WebSocket upgrades). With it, a
   browser-openable URL exists on every provider and provider-native `getUrl`
   becomes an optimisation rather than a requirement. Roughly **small** once
   PR 2 exists: an `http-proxy`-style handler plus wildcard TLS.
2. **Hosted endpoint**. ComputeSDK runs the same `@computesdk/tunnel` server
   at e.g. `tunnel.computesdk.com`, mints tokens at sandbox create, and the
   SDK relays `conn.fetch` through the API. Self-hosting stays possible;
   users without ingress get the feature without exposing anything.
3. **Egress through the control plane**. Sandbox-initiated `open` frames (even
   stream IDs are reserved for this) let daemond route outbound traffic via
   the control plane for allowlisting and observability.

## Open questions

1. Should the tunnel token be delivered via the exec channel (this RFC) or
   should daemond fetch it from the control plane using a bootstrap secret in
   `env`? Exec is simpler and matches how we deliver `env` today.
2. Do we want `conn.fetch` to also accept `http://<sandboxId>:<port>/...` so a
   single `fetch`-shaped dispatcher can serve many sandboxes? Easy to add on
   top of `server.connections`.
3. Per-stream flow-control windows in v1, or wait for evidence of head-of-line
   blocking?
