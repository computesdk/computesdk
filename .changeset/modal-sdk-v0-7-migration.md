---
"@computesdk/modal": patch
---

Migrate to Modal JS SDK v0.7. Replaces the static API (App.lookup, Sandbox.fromId, app.createSandbox) with the new ModalClient subsystem API (client.apps.fromName, client.sandboxes.create, client.sandboxes.fromId), caches the App as a Promise<App> to keep the modal() factory synchronous, clarifies the auth error message to mention both config and env var credentials, and aligns the README with the v3 SDK.
