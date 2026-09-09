---
"@computesdk/archil": patch
---

feat(archil): use the official `disk` client instead of hand-rolled fetch calls

Replaces the provider's bespoke `callApi` helper with Archil's official `disk`
package (`^1.1.2`), so auth headers, response envelopes, and endpoint paths are
maintained upstream rather than duplicated here.
