---
"@computesdk/provider": patch
"@computesdk/daytona": patch
"@computesdk/microsandbox": patch
"@computesdk/miosa": patch
---

fix(volumes): soak-2 — settle-wrap attach + create-time mounts, daytona ready-wait, microsandbox named(), miosa computer-only error

- factory: `attachVolume` and `create({volumes})` run inside `withVolumeSettle` — re-attaching a volume right after `destroy()` raced the provider's async unmount (blaxel "already attached", tenki `SYNC_PENDING`); the settle window absorbs it for every provider at once.
- daytona: `volume.create` returns a ready handle and `volume.delete` waits out `pending_create` — both operations reject the transitional state.
- microsandbox: mount via `named()` — the backend rejects the `ensure-exists` inline-create option on sandbox create.
- miosa: `attachVolume`/`detachVolume` throw a clear "volumes attach to computers, not sandboxes" error when the record carries no `computer_id`, instead of POSTing an id that always 404s.
