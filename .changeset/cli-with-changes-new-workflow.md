---
"@computesdk/cli": patch
---

`compute actions dispatch --with-changes`: a workflow file that exists only in your working tree can now be dispatched. The CLI computes the diff before the catalog lookup and, when the diff creates the requested workflow, dispatches it by `repoFullName + workflowPath` so the platform builds the run from the diff. Dispatching a missing `.github/workflows/*` path from a dirty tree without the flag now hints at `--with-changes`.
