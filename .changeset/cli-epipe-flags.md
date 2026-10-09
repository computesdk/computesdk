---
"@computesdk/cli": patch
---

Exit quietly on EPIPE when stdout/stderr closes early (e.g. piping into `jq`), and add `--json`/`--base-url` to `whoami`/`org current`, and `--json` to `logout` for consistency with the rest of the CLI.
