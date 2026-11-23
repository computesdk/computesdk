---
'@computesdk/arker': patch
---

`create({ image })` boots the given OCI image from a public registry instead of ignoring it, and Arker gets volumes: `volume.create/get/list/delete` on Arker filesystems, create-time `volumes`, and `attachVolume`/`detachVolume` on a running sandbox.
