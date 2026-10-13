---
"@computesdk/agentcore": patch
---

Deprecate `@computesdk/agentcore`: it is now a thin re-export of `@computesdk/aws/agentcore`. Existing imports keep working; switch to `import { agentcore } from '@computesdk/aws/agentcore'`.
