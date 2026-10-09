---
"@computesdk/neevcloud": patch
---

NeevCloud: move to `@neevcloud/sdk` 0.8 and cover more of the provider contract.

- `create()` now honors `name`, `envs`, `cpu`, `memory`, `timeout` (sandbox lifetime), `snapshotId` and `signal`.
- Snapshots: `snapshot.create` / `list` / `delete`, restored through `create({ snapshotId })`.
- Templates: `template.list()` returns the sandbox template catalogue.
- `onStdout` / `onStderr` stream through the NeevCloud exec API instead of the in-sandbox daemon, and a command past its `timeout` returns exit code 124.
- `getInfo()` reports the sandbox lifetime and its name, region and template.
- `filesystem.remove()` deletes a non-empty directory instead of failing.
- Paths: an absolute path is now used as is instead of being re-rooted at the workspace, so `/workspace/a.txt` and `/tmp/a.txt` mean what they say in `filesystem` calls and `runCommand`. Code that wrote `/app.txt` to mean the workspace file should use `app.txt`.
