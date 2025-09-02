---
"computesdk": minor
---

Improve getInstance() type inference with generic setConfig. When using setConfig with a defaultProvider, getInstance() now returns the properly typed native provider instance instead of 'any', enabling full type safety and autocomplete for provider-specific APIs.
