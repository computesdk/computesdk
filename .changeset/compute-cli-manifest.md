---
'@computesdk/cli': patch
---

Add a hidden `compute __manifest` command that prints the CLI's command tree (commands, aliases, arguments, flags, global flags, and the bundled `@benchsdk/runner` / `@benchsdk/cli` versions behind `compute bench`) as JSON. The package now ships the generated `cli-manifest.json`; regenerate it with `pnpm --filter @computesdk/cli run manifest`.
