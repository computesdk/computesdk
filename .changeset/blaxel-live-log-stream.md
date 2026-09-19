---
"@computesdk/blaxel": patch
---

fix(blaxel): capture runCommand output via the live log stream while the process runs

On Mark 3 infra, process output isn't retained for the `logs` GET after the process exits — `exec` returns `status: 'running'`, the process finishes, and every post-hoc read stays empty. `executeWithStreaming` now attaches `process.streamLogs(pid)` before polling to a terminal state, so output emitted while the process finishes is captured live. Post-completion `logs(pid)` remains as a fallback.
