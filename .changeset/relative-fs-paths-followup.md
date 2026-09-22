---
"@computesdk/modal": patch
"@computesdk/sail": patch
"@computesdk/createos-sandbox": patch
---

Harden the relative `filesystem.*` path resolution: `remove(''|'.'|'./')` no longer collapses to the sandbox workdir (it is rejected before resolution instead of recursively deleting it), and a failed `pwd` workdir probe is evicted instead of being cached as `/` forever — the next filesystem operation probes again.
