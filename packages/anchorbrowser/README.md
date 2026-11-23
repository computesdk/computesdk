# @computesdk/anchorbrowser

Anchor Browser adapter for ComputeSDK. Create cloud browser sessions and connect over CDP.

## Install

```bash
npm install @computesdk/anchorbrowser
```

Configure the `anchorbrowser` adapter with `ANCHORBROWSER_API_KEY`.

Create a session with `.session.create()` and use its `connectUrl` with a CDP client. Release it with `.session.destroy(sessionId)` when finished.

---

[Browser providers](https://www.computesdk.com/providers/browsers) · [Public benchmarks](https://www.computesdk.com/benchmarks)
