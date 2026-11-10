---
"@computesdk/provider": patch
"computesdk": patch
"@computesdk/test-utils": patch
---

Make unsupported snapshot/template list and delete hooks optional, expose operation
availability, and reject omitted operations with `code: 'unsupported'` instead of
false success. Support instance-scoped snapshot inventory, including through
`compute.snapshot.list({ instanceId, limit })`. Route scoped inventory only to a
known owner or a single configured provider, and reject unidentifiable snapshot
sources rather than returning unrelated inventory. Apply listing limits to the
combined, instance-filtered results, not separately per provider. Preserve known-owner deletion
failures rather than trying a different provider.

Reject callback-based streaming on stateless shell runtimes instead of replaying
completed output as live callbacks. Buffered commands remain supported; detected
stateless instances report streaming as unsupported.
