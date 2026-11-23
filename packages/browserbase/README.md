# @computesdk/browserbase

Browserbase adapter for ComputeSDK. Create cloud browser sessions and connect over CDP.

## Install

```bash
npm install @computesdk/browserbase
```

Configure the `browserbase` adapter with `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID`.

Create a session with `.session.create()` and use its `connectUrl` with a CDP client. Release it with `.session.destroy(sessionId)` when finished.

---

[Browser providers](https://www.computesdk.com/providers/browsers) · [Public benchmarks](https://www.computesdk.com/benchmarks)
