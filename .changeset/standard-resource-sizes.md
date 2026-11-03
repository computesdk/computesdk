---
"computesdk": patch
"@computesdk/provider": patch
"@computesdk/namespace": patch
"@computesdk/archil": patch
---

Add additive standard CPU/RAM sizeClass requests, immutable pure provider capability resolution and request metadata, with typed pre-create failures instead of silently ignored or default-sized requests. Initially map sm/md/lg/xl for Namespace Linux amd64 and new Archil persistent VMs; preserve every legacy create path without sizeClass. Other mappings remain explicitly unknown; no builds, live availability checks, or consumer migrations are performed.
