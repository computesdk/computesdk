---
"@computesdk/freestyle": patch
---

Default sandboxes can now be paused and resumed (kept 5 minutes after stop instead of deleted on stop; `ephemeral: true` keeps the old behaviour), honour `sizeClass` `lg`/`xl` and `cpu`/`memory` by growing the VM with `resize`, and run commands longer than five minutes on a re-baked runtime snapshot with the current guest agent.
