---
"@computesdk/createos-sandbox": patch
---

Fix and improve createos-sandbox provider (bump to @nodeops-createos/sandbox@0.7.1).

- Performance improvement by reducing double calls.
- Default `ingressEnabled` to `false` (was `true`) for both create and fork requests.
- Default rootfs to `devbox:1` when no image/runtime/rootfs is specified.
- Use direct HTTP DELETE for sandbox destroy instead of fetching the sandbox first.
- Add new create options: `envs`, `name`.
