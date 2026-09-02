---
"@computesdk/miosa": patch
---

Route MIOSA sandbox requests over ready HTTP/2 sessions, with a quorum-based cold-start gate. The provider now tracks connected sessions and dispatches only onto warm connections; on a cold pool it waits for the first session to connect and up to 250 ms for a quorum of 8, improving burst median TTI. The wait is bounded by a 1 second deadline and re-armed when the pool is fully recycled, preventing hangs and stale gates.
