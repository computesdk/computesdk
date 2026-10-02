---
"@computesdk/beam": patch
---

Reset the beam-js singleton client's cached axios instance whenever `configureBeamOpts` applies different credentials. `BeamClient` bakes `Authorization: Bearer <token>` into `_client` on its first request and never rebuilds it, so a second credential in the same process (e.g. two orgs' keys under one runner) silently kept authenticating with the first token. The adapter now drops `_client` when the effective token/workspaceId/gatewayUrl/timeout changes, and falls back to the SDK defaults for gatewayUrl/timeout so a previous configuration's custom values cannot carry over.

Default the node runtime image to `node:24` instead of `node:24-slim` — the slim variant has no git, so checkout-style workflows cannot run in a default sandbox.
