---
"computesdk": minor
---

Add server logs API for retrieving captured output from managed servers

- Add `sandbox.server.logs(slug)` to retrieve combined stdout/stderr logs
- Add `sandbox.server.logs(slug, { stream: 'stdout' })` to get only stdout
- Add `sandbox.server.logs(slug, { stream: 'stderr' })` to get only stderr
- Returns `ServerLogsInfo` with slug, stream type, and logs content
