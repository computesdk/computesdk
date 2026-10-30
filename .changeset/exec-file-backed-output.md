---
"@computesdk/createos-sandbox": patch
"@computesdk/isorun": patch
"@computesdk/microsandbox": patch
"@computesdk/modal": patch
"@computesdk/sandbox0": patch
---

runCommand: capture output via guest files instead of streamed exec output. Provider exec transports can drop a contiguous chunk mid-stream (observed across all five providers during a CPU-bound quiet stretch) while still reporting success, silently corrupting captured stdout/stderr. Commands now redirect output to files inside the sandbox and the adapter reads them back with short-lived commands, verified against byte counts the command writes alongside. Microsandbox additionally records byte counts and re-reads through the alternate transport on a mismatch.
