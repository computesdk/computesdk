---
"@computesdk/cli": major
---

Remove the legacy console auth and its commands. `compute create`,
`compute sandbox`, `compute connect`, `compute workspace`, `compute run`, and
the interactive REPL are gone — sandbox management lives under
`compute sandboxes` (the platform `/api/v1/sandboxes` API).

Auth now follows the Actions CLI: `compute login` / `compute logout` /
`compute --login` / `compute --logout` run the platform OAuth device flow
through `@benchsdk/cli` and share `~/.benchsdk/credentials.json` with
`compute bench auth login` (which still works). The browser flow to
console.computesdk.com and the `~/.computesdk/credentials.json` store were
deleted — run `compute login` once after upgrading.
