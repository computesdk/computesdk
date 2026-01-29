---
"@computesdk/vercel": patch
---

Fix credential precedence: config from setConfig() now correctly takes priority over environment variables

Previously, if `VERCEL_OIDC_TOKEN` was set in the environment, the provider would always use OIDC authentication and silently ignore any credentials passed via `setConfig()` or the provider constructor. This caused issues where explicitly configured credentials (token, teamId, projectId) were bypassed.

Now the precedence is:
1. Config values (from `setConfig()` or provider constructor) - always checked first
2. Environment variables - used as fallback only when config values are not provided
3. OIDC authentication - only used when no config credentials are provided AND `VERCEL_OIDC_TOKEN` is set

This fix affects all methods: `sandbox.create`, `sandbox.getById`, `sandbox.destroy`, `snapshot.create`, and `snapshot.delete`.
