---
"computesdk": minor
---

Add server health check support

- Add `health_check` configuration option to `ServerStartOptions` and `SandboxServerConfig`
- Add `HealthCheckConfig` interface with `path`, `interval_ms`, `timeout_ms`, and `delay_ms` options
- Add `healthy` and `health_status` fields to `ServerInfo` response
- Add `healthy` field to `ReadyResponse` for overall health status
- Add `healthy` and `health_check` fields to `SandboxServerInfo` in ready response
