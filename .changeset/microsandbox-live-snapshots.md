---
"@computesdk/microsandbox": patch
"@computesdk/provider": patch
"computesdk": patch
---

`CreateSnapshotOptions` gains an optional `scope: 'disk' | 'full'` hint (both the universal-instance and provider-factory surfaces).

`snapshot.create` now tries a live full-scope capture first — `Snapshot.builder(name).fromSandbox(id).full().guestFlush('auto')` — so on backends that support it (SDK `scope: "full"` / checkpoint), the source keeps running and memory/process state is preserved. When the backend rejects live capture, it falls back to the previous disk-only stop/capture/restart path. Restores of `scope === "full"` snapshots request `cowMemory()` so the captured execution resumes.
