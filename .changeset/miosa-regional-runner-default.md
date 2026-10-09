---
'@computesdk/miosa': patch
---

Route sandbox create, exec and destroy through MIOSA's regional sandbox endpoint by default to cut client round-trip latency, falling back to the account API for any create the regional endpoint cannot serve; opt out with `runnerMode: false` or `MIOSA_RUNNER_MODE=0`.
