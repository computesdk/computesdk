---
"@computesdk/cli": patch
---

`compute actions dispatch --with-changes`: run your local changes without committing. Everything the working tree has beyond `origin/<ref>` (local commits, edits, untracked files) is sent as a unified diff via `POST /api/v1/actions/patches` and applied after checkout; `--ref` defaults to the current branch. Dispatching from a dirty tree without the flag prints a hint.
