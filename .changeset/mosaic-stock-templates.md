---
"@computesdk/mosaic": patch
---

Recognize the full stock template list the API serves (`base`, `node-20/22/26`, `node-22-agents`, `python-3.11/3.14`) instead of only `node-20`/`python-3.11`. Stock ids other than those two were mis-routed to `snapshot_id` at create time, so `templateId: 'node-22-agents'` (the image with pinned coding agents) and the other public templates could not be booted.
