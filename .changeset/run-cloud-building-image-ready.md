---
"@computesdk/run-cloud": patch
---

Wait for a new sandbox to reach `running` before returning from `create`. Run Cloud can hand back sandboxes in `building_image`, and every subsequent operation failed with `4409: sandbox is building_image, not running`. Creates now poll `get()` until `running` (also for snapshot restores), destroying the sandbox on terminal states, timeout, or abort.
