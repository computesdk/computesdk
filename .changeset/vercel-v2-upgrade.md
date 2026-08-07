---
"@computesdk/vercel": patch
---

Upgrade the Vercel provider to `@vercel/sandbox` v2.

- Switches sandbox lifecycle from v1 `sandboxId`/`token` to v2 name-keyed `Sandbox.create`, `Sandbox.get({ resume: false })`, `Sandbox.list`, and `sandbox.delete()`.
- Uses `sandbox.currentSession().runCommand` for command execution, with native `detached` support for `background: true`.
- Adds `image`, `vcpus`, and `runtime` to `VercelConfig`; removes the v1 credential fields (now handled by OIDC/environment credentials).
- Supports restoring from a snapshot via `options.snapshotId` or `options.source`.
- Adds filesystem and snapshot method implementations using v2 `Session`/`Snapshot` APIs.
- Updates unit tests to match v2 call shapes.
