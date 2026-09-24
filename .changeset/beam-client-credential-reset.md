---
"@computesdk/beam": patch
---

Reset the beam-js singleton client's cached axios instance whenever `configureBeamOpts` applies different credentials. `BeamClient` bakes `Authorization: Bearer <token>` into `_client` on its first request and never rebuilds it, so a second credential in the same process (e.g. two orgs' keys under one runner) silently kept authenticating with the first token. The adapter now drops `_client` when the effective token/workspaceId/gatewayUrl/timeout changes.
