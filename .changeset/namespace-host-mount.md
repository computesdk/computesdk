---
"@computesdk/namespace": patch
---

fix(namespace): attach volumes at VM level + bind into container — nsc recipe

Runtime-attached volumes were mounted directly at the requested `mountPath` on
the instance's VM namespace, which the CommandService container never sees —
and instances whose volumes can't provision that way are destroyed while
waiting for readiness. Mirrors nsc's `cluster run --volume` recipe: the volume
mounts VM-side at `/volumes/volumeN` and an `experimental.host_mount` bind
exposes it inside the container at the requested `mountPath`.
