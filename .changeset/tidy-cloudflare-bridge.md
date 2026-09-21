---
"@computesdk/cloudflare": major
"@computesdk/workbench": patch
---

Use the Cloudflare sandbox demo Worker for remote and direct Cloudflare sandboxes. Direct mode now calls the Worker's Durable Object RPC API, sandbox IDs use native Durable Object IDs, and filesystem operations run through exec.
