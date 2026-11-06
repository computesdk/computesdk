---
"@computesdk/microsandbox": patch
---

Use `MSB_API_KEY` (and `MSB_API_URL`) from the environment to select the cloud backend, and refuse to snapshot running ephemeral sandboxes instead of stopping them away.
