---
"@computesdk/bench": patch
---

Add optional local raw-event storage for benchmark telemetry. When enabled, benchmark events are written to chunked JSONL files with a per-run manifest under a configurable directory (defaulting to `~/.benchmark`).
