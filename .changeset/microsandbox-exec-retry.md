---
"@computesdk/microsandbox": patch
---

Retry `runCommand` once when the agent's exec stream ends without an exit event — a channel-level flake that was surfacing as a hard failure and dropping all captured output.
