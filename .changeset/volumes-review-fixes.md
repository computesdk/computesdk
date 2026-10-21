---
"computesdk": patch
"@computesdk/novita": patch
"@computesdk/namespace": patch
"@computesdk/createos-sandbox": patch
---

Volume surface review fixes: list() no longer swallows real provider failures (only the not-supported stub), delete() only targets the known owning provider, novita create-mounts resolve the volume name (not the native object), namespace delete resolves id→tag, and createos snapshot forks attach requested volumes post-fork.
