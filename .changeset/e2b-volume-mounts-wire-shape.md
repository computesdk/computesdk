---
"@computesdk/e2b": patch
---

Fix unified volume mounts on `instances.create`: `volumes: [{ volume, mountPath }]` was sent to the E2B SDK as an array, but E2B's `volumeMounts` option is a `{ [mountPath]: volumeName }` record. `Object.entries` on the array turned every mount path into its index, so volumes mounted at `"0"`, `"1"`, … instead of the requested path. The adapter now builds the record the SDK expects.
