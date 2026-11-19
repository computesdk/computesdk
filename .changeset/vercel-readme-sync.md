---
"@computesdk/vercel": patch
---

Docs: sync the `@computesdk/vercel` README with the implemented provider. The README still claimed Vercel sandboxes were ephemeral and single-use with no listing or reconnection, and advertised Node.js 22 / Python 3.13. It now documents `getById`/`list`, persistent sandboxes with `pause()`/`resume()`, rootfs snapshots, Drive-backed volumes, native streaming, the default `vercel/sandbox/universal` image (Node.js 24, Python 3.14) and the `node24`/`python3.13` runtime mapping, the `daemonSsePort` option, and the accurate per-session timeout limits.
