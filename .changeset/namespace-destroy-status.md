---
"@computesdk/namespace": patch
---

fix(namespace): report destroyed instances as gone

DescribeInstance keeps returning an instance while it is DESTROYING or
DESTROYED — NotFound only comes later — so getById (and list) saw deleted
sandboxes as alive forever. getById now maps InstanceMetadata.status
DESTROYING/DESTROYED (name or number encoding) to null, list filters them,
NamespaceSandbox carries the lowercased status into getInfo, and destroy
rejects on API failure instead of warning-and-succeeding.
