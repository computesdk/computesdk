---
"@computesdk/sail": patch
---

Add an optional `region` to the Sail provider config, typed as `'us-west' | 'us-east'`. New Sailboxes are created in that Sail region, such as `sail({ region: 'us-east' })`, so a client can pick the region closest to it. When omitted, Sail uses its default region as before. Snapshot restores are unchanged.
