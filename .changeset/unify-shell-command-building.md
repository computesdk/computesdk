---
"@computesdk/provider": minor
"@computesdk/docker": patch
"@computesdk/e2b": patch
"@computesdk/daytona": patch
"@computesdk/modal": patch
"@computesdk/namespace": patch
"@computesdk/sprites": patch
"@computesdk/codesandbox": patch
"@computesdk/hopx": patch
"@computesdk/beam": patch
"@computesdk/blaxel": patch
"@computesdk/upstash": patch
---

Add `buildShellCommand` utility to unify shell command building across providers

Centralizes cwd/env handling into a single `buildShellCommand` function in
`@computesdk/provider`, fixing bugs where env vars didn't work with cwd set
(docker, sprites, hopx) and where values weren't properly quoted (namespace,
sprites, hopx). All shell-based providers now use the shared utility.
