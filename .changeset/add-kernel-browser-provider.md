---
"@computesdk/kernel": minor
---

Add Kernel browser provider package for cloud browser sessions powered by Kernel:

- Full session lifecycle: create, retrieve, list, delete, and getConnectUrl via `@onkernel/sdk`
- Profiles: create, get, list, delete via Kernel REST API
- Extensions: upload (multipart), get, delete via Kernel REST API
- Logs: list by consuming SSE stream from `/browsers/{id}/logs/stream`
- Recordings: start replay via `/browsers/{id}/replays`
