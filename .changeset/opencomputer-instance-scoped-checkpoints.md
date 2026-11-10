---
"@computesdk/opencomputer": patch
---

Declare OpenComputer snapshot listing as instance-scoped so unscoped requests report an unsupported operation before native calls. Keep native checkpoint listing available through canonical instanceId and legacy sandboxId scopes.
