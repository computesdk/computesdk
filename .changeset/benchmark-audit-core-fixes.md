---
"computesdk": patch
"@computesdk/provider": patch
"@computesdk/e2b": patch
"@computesdk/daytona": patch
---

Core SDK improvements from the `hpc-sandbox-benchmarks` provider audit:

- Export `DirectProvider` from `computesdk`.
- Add optional `user` to `RunCommandOptions` and pass it through in `@computesdk/e2b` using the native `commands.run` options (`cwd`, `envs`, `background`, `timeoutMs`) instead of shell-wrapping.
- Add optional `target` to `@computesdk/daytona` `DaytonaConfig` and use it when constructing the Daytona client for create, get, list, destroy, snapshot, and template calls.
