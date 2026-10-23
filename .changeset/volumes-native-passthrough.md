---
'@computesdk/provider': patch
'@computesdk/blaxel': patch
'@computesdk/beam': patch
'@computesdk/daytona': patch
'@computesdk/declaw': patch
'@computesdk/e2b': patch
'@computesdk/modal': patch
'@computesdk/vercel': patch
'@computesdk/northflank': patch
'@computesdk/namespace': patch
'@computesdk/novita': patch
'@computesdk/sandbox0': patch
'@computesdk/tenki': patch
'@computesdk/createos-sandbox': patch
'@computesdk/microsandbox': patch
---

Restore native `volumes` passthrough in `create()`. The unified-volume surface made `options.volumes` mean `VolumeMount[]` on every provider, which silently mangled provider-native volume specs callers were already passing: entries without a `volume` key resolved `name`/`volumeId` to `undefined`, so e.g. blaxel's `{name, type, sizeMb, mountPath}` hit the wire as `{"mountPath":"/","type":"persistent"}` and failed validation (`Volume binding 'name' and 'mountPath' must be strings`). Modal's native `volumes` dict was dropped entirely.

`volumes` is now treated as unified mounts only when it is a non-empty array where every entry carries `volume` (new `isUnifiedVolumeMounts` guard in `@computesdk/provider`). Anything else stays in provider options and reaches the provider untouched, restoring the pre-unified passthrough.
