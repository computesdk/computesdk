---
'@computesdk/provider': patch
'@computesdk/beam': patch
'@computesdk/blaxel': patch
'@computesdk/microsandbox': patch
'@computesdk/lightning': patch
---

Serialize process-global provider credentials with a shared config gate

Adds `createConfigGate` / `createConfigStamp` to `@computesdk/provider` and applies them to the adapters whose vendor SDKs hold credentials in module-global state: beam (`beamOpts` + singleton client), blaxel (`initialize()` mutates global settings), microsandbox (`setDefaultBackend`), and lightning (refactored from its local gate onto the shared one).

Same-config operations still run concurrently. A different config waits for the active operations to drain, then installs itself once — so two API keys on one process can no longer clobber each other mid-request. Created and connected sandboxes are stamped with their config so instance operations (runCommand, filesystem, getUrl) re-enter the gate under their originating credentials.

For `@computesdk/microsandbox` this replaces the one-backend-per-process pin that threw "Microsandbox supports one backend configuration per process": distinct explicit selections now serialize instead of failing.
