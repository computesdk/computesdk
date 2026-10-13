---
"@computesdk/microsandbox": patch
---

Remove the named sandbox when `create` fails after the sandbox already exists
(for example, a cloud sandbox that does not reach `running` before the SDK's
readiness wait expires). These sandboxes were previously left behind because
the caller never received an id to destroy. `destroy` now also stops sandboxes
in any non-terminal state (`created`, `starting`, `paused`) before removing them.
