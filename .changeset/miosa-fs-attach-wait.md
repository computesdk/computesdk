---
"@computesdk/miosa": patch
---

Account-API fs 404s on a young sandbox now wait out the boot via exec's `wait` readiness hold plus a 10s post-attach grace, instead of replaying 404s for the whole window — a missing file on a fresh sandbox surfaces within ~10s rather than stalling for two minutes.
