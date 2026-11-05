---
"@computesdk/namespace": patch
---

Send `env` and `cwd` in CommandService's own `Command.envVars` / `Command.cwd` fields instead of a shell prefix, so they apply to the whole command line (`echo $FOO`, `a && b` previously saw no env past the first word), and run `background` commands under `nohup sh -c` so compound commands detach as a whole.
