---
"computesdk": patch
"@computesdk/provider": patch
"@computesdk/daytona": patch
"@computesdk/e2b": patch
"@computesdk/modal": patch
"@computesdk/beam": patch
"@computesdk/blaxel": patch
"@computesdk/declaw": patch
"@computesdk/sandbox0": patch
"@computesdk/vercel": patch
"@computesdk/namespace": patch
"@computesdk/northflank": patch
"@computesdk/microsandbox": patch
"@computesdk/novita": patch
"@computesdk/miosa": patch
"@computesdk/tenki": patch
"@computesdk/createos-sandbox": patch
---

Add a unified persistent-volume surface: `CreateInstanceOptions.volumes` (create-time mounts), `compute.volume.create/get/list/delete` with multi-provider routing, and `instance.attachVolume`/`detachVolume` where the provider exposes runtime attach. Provider plumbing maps the unified `VolumeMount[]` onto each native wire shape (daytona `volumes[]`, e2b `volumeMounts`, modal `volumes` map, vercel `mounts`, namespace `volumes[]` with `persistency_kind`, northflank `volumesToAttach`, sandbox0 claim `mounts`, tenki `CreateOptions.volumes`, novita `volumeMounts`, createos `disks` attachments, plus volume managers for blaxel, declaw, beam, microsandbox, miosa).
