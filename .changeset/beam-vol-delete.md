---
'@computesdk/beam': patch
'@computesdk/provider': patch
---

Implement `volume.delete` for beam via the gateway's transcoded DeleteVolume route (`POST /api/v1/gateway/volumes/{name}/delete`), and normalize beam `Volume.id` to the name — every beam volume op is name-keyed. Widen the attach-side settle deadline to 180s: provider attach-consistency windows run ~120s, leaving ~0 margin at the 120s default.
