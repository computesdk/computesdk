# daemond dial-out tunnel prototype

Prototype of a control-plane ↔ sandbox multiplexed tunnel carried over a single
WebSocket. The sandbox (daemond) dials **out** to the control plane, so no inbound
connectivity to the sandbox is required. See `docs/rfcs/0001-daemond-dial-out-tunnel.md`.

## Run

```sh
pnpm install
pnpm --filter @computesdk/example-daemond-tunnel-prototype demo
# or directly:
node examples/daemond-tunnel-prototype/demo.mjs
```

Local mode starts the tunnel server, an in-process tunnel client (stand-in for
daemond), and a small HTTP server on `127.0.0.1:8787` playing the role of a
service inside the sandbox. It then exercises fetch-over-tunnel, streaming,
concurrency, raw TCP forwarding, port allow-listing, and reconnect.

## What it demonstrates

- One WebSocket multiplexing many bidirectional byte streams (stream ids are odd,
  allocated by the control plane).
- `conn.fetch()` — a real HTTP client (`http.request`) over a tunneled `Duplex`,
  returning a WHATWG `Response`.
- `conn.listen()` — raw TCP forwarding from a local port into the sandbox.
- Token auth (`?token=` query or first `{"t":"auth"}` frame; Node's global
  `WebSocket` cannot set headers, so the client sends both).
- Client-side port allow-listing (`PORT_NOT_ALLOWED`), `ECONNREFUSED` surfacing,
  ping/pong keepalive, and exponential-backoff reconnect.

## Frame format

| Frame | WS type | Contents |
|---|---|---|
| `{"t":"open","id,"port","host"}` | text (JSON) | control plane → sandbox: open stream |
| `{"t":"opened","id"}` | text (JSON) | sandbox → control plane: local TCP connect succeeded |
| `{"t":"close","id"}` | text (JSON) | either direction: half-close (no more data) |
| `{"t":"error","id"?,"code","message"}` | text (JSON) | e.g. `ECONNREFUSED`, `PORT_NOT_ALLOWED`, `TOO_MANY_STREAMS` |
| `{"t":"ping"/"pong","ts"}` | text (JSON) | app-level keepalive |
| `{"t":"auth","token"}` | text (JSON) | first client frame when `?token=` is unavailable |
| data | binary | 4-byte big-endian stream id + payload (≤ 64 KiB per frame) |

## Files

- `protocol.mjs` — frame encode/decode shared by both sides.
- `tunnel-client.mjs` — embedded-in-daemond side; **zero deps**, Node 22 global `WebSocket`.
- `tunnel-server.mjs` — control-plane side (`ws`), `createTunnelServer` / `waitFor` / `TunnelConnection`.
- `demo.mjs` — the local demo and checks.

## Sandbox mode (experimental)

Requires the tunnel server to be reachable from inside the sandbox:

```sh
export COMPUTESDK_API_KEY=...
export TUNNEL_PUBLIC_URL=wss://your-host/tunnel
node demo.mjs --sandbox
```

This creates a real ComputeSDK sandbox, writes `tunnel-client.mjs` +
`protocol.mjs` to `/tmp`, starts a background HTTP server and the tunnel client,
and fetches `/hello` through the tunnel. Without `TUNNEL_PUBLIC_URL` it prints
"no public ingress" and exits.
