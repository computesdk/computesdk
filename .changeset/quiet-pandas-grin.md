---
'@computesdk/freestyle': patch
---

Resolve the runtime snapshot on the create instead of looking it up first.

Every cold `create` began by paging `vms.snapshots.list` to find the
`computesdk-freestyle-runtime` snapshot by slug, and only then booted a VM. The
Freestyle API already resolves `snapshotId` from an id, your own slug, or a
public `{owner}/{slug}`, so that lookup was a round trip for something the
create could do itself — and it landed in the worst place, since concurrent
sandboxes all waited on the one shared lookup before any of them could start.

`create` now names the snapshot by slug and boots straight away. The bake still
happens, once, if the API answers `NOT_FOUND` — the existing in-flight promise
keeps a burst of misses from baking a snapshot each, and the slug persists the
result across processes.

Measured against the live API from a client one continent away, the lookup was
worth ~100ms on every sandbox in a burst.
