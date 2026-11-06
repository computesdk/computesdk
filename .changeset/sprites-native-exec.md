---
"@computesdk/sprites": patch
---

Sprites: pass env/cwd through the exec API's native `env`/`dir` fields (env now reaches every part of a compound command, values kept verbatim), parse the exec response's stdout/stderr/exit frames instead of stripping control characters, stream `onStdout`/`onStderr` natively from those frames, and read `sprites[]` with pagination in `list()`.

`runCommand(..., { background: true })` now launches through the shell process tier and returns once the command starts, instead of waiting for it to exit.
