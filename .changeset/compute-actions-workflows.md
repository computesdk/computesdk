---
'@computesdk/cli': minor
---

New `compute actions workflows [repo]` lists workflows with their controls (on/off, provider order, snapshot cap) and latest run; `--all` adds user-disabled workflows and those on disabled repos, and `--ref <ref>` lists the workflow files only that branch or tag has, with their inputs. `compute actions workflows enable|disable|set <repo> <workflow>` changes a workflow's controls (owners/admins; confirm on a terminal or pass `-y`). `compute actions dispatch --ref <ref>` now also finds a workflow that exists only on that ref and dispatches it by path.
