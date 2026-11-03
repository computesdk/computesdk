---
"@computesdk/agentuity": patch
"@computesdk/declaw": patch
"@computesdk/tensorlake": patch
---

Use authoritative resource lookups, preserve non-missing lifecycle failures,
validate resource identities before native routing, and stop treating failed
deletion as success. Agentuity uses the supported resource endpoint and rejects
malformed lifecycle responses without exposing their JSON parser snippets.
Retained terminal metadata is not filtered into invented absence.
