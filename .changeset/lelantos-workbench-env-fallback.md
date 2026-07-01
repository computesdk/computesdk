---
'@computesdk/workbench': patch
---

Workbench now honors the Lelantos provider's `E2B_API_KEY` / `E2B_DOMAIN` / `E2B_API_URL` fallback. Previously only `LELANTOS_*` was recognized, so a user who had configured Lelantos via the `E2B_*` variables (which the provider itself accepts) saw it reported as unconfigured and got no auto-config from the environment.
