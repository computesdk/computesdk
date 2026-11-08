---
'@computesdk/modal': patch
---

Share the Modal client, app lookup, and image preparation across provider instances with matching connection settings. Concurrent sandbox creation reuses in-flight initialization while preserving distinct sandbox options. Bound cache retention and retry failed lookups.
