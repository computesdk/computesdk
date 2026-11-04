---
"computesdk": patch
---

Keep known snapshot operations on their recorded provider instead of retrying another backend with a provider-local resource ID.

Restoring or deleting a known snapshot and snapshotting a known instance no longer fall back across providers. Conflicting restore/create provider overrides and ambiguous snapshot ownership reject before provider calls. Snapshot ownership collisions are retained rather than overwritten.

These safeguards use in-memory ownership learned from create/list operations and reset on reconfiguration. Unknown IDs retain their existing discovery/fallback behavior; general instance routing and provider-name deduplication are unchanged.
