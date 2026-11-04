---
"computesdk": patch
---

Make `snapshot.list()` creation timestamps optional when a provider cannot report them.

Absent timestamps are omitted rather than converted to `Invalid Date`; valid timestamps are normalized and explicitly invalid timestamps reject without learning invalid snapshot ownership. Consumers must check for an absent `createdAt`. Snapshot creation behavior is unchanged.
