# @computesdk/hyperbrowser

Hyperbrowser adapter for ComputeSDK. Create cloud browser sessions and connect over CDP.

## Install

```bash
npm install @computesdk/hyperbrowser
```

Configure the `hyperbrowser` adapter with `HYPERBROWSER_API_KEY`.

Create a session with `.session.create()` and use its `connectUrl` with a CDP client. Release it with `.session.destroy(sessionId)` when finished.

---

[Browser providers](https://www.computesdk.com/providers/browsers) · [Public benchmarks](https://www.computesdk.com/benchmarks)
