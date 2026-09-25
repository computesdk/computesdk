---
"@computesdk/blaxel": patch
---

Harden command execution and expose volumes. `runCommand` now delivers commands through daemond via a base64 launcher by default (`exec: 'daemon'`), so Blaxel's exec layer can no longer re-split or collapse quoting and the process's real exit code and signal are reported; `background: true` runs as a detached daemond job that frees the sandbox's single exec slot. Results carry `status`/`signal`/`jobId` (`BlaxelCommandResult`), and a non-`completed` status with no non-zero exit code (refused exec while another process runs, severed exec channel) throws `BlaxelExecError` instead of a fabricated `exitCode: 1`. Adds typed `volumes` on `BlaxelConfig` and `sandbox.create()` (`BlaxelVolume`), and documents the one-exec-at-a-time and managed-dockerd coupling limits.
