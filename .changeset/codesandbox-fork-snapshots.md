---
'@computesdk/codesandbox': patch
---

Snapshots are now hibernated forks of the running sandbox (memory, processes and disk) that restore into new sandboxes via `snapshotId`, and can be listed and deleted. Sandboxes expose native `pause()`/`resume()` (hibernate/wake). Commands use CodeSandbox's native `env`/`cwd`, report stdout and stderr separately with the real exit code, enforce `timeout` in the box, and the provider now runs the streaming and process conformance suites. `destroy` closes the session and shuts the VM down before deleting, retrying transient delete failures.
