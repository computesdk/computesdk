---
'@computesdk/cli': minor
---

Actions parity with the dashboard:

- `compute actions runs` works without a repo argument (every repo the org has) and takes the platform's run filters: `--event`, `--workflow` (path, name or file name), `--search`, `--archived` and `--reliability`. `--day <YYYY-MM-DD>` lists one day's runs page by page (`--time-zone`, `--cursor`, `--all` to follow every page). New `compute actions runs days` prints how many runs each day holds, and `compute actions runs archive|unarchive <run-id...>` archives or restores runs.
- New `compute actions workflows [repo]` lists workflows with their controls (on/off, provider order, snapshot cap) and latest run; `--all` adds user-disabled workflows and those on disabled repos, and `--ref <ref>` lists the workflow files only that branch or tag has, with their inputs. `compute actions workflows enable|disable|set <repo> <workflow>` changes a workflow's controls. `compute actions dispatch --ref <ref>` now also finds a workflow that exists only on that ref and dispatches it by path.
- `compute actions repos` rows show each repo's run count, latest run and next poll. New `compute actions branches <repo>` lists a repo's refs (`--search`, `--archived`), `compute actions repos poll <repo>` polls it now (one poll per 30 s; a second prints when to retry), and `compute actions repos set <repo> --fork-prs allow|refuse` sets whether fork pull requests run CI.

Archive/unarchive, workflow enable/disable/set, repos poll and repos set need an owner or admin, ask for confirmation on a terminal, and need `-y` elsewhere (they exit 1 without it).
