---
'@computesdk/cli': minor
---

`compute actions runs` works without a repo argument (every repo the org has) and takes the platform's run filters: `--event`, `--workflow` (path, name or file name), `--search`, `--archived` and `--reliability`. `--day <YYYY-MM-DD>` lists one day's runs page by page (`--time-zone`, `--cursor`, `--all` to follow every page). New `compute actions runs days` prints how many runs each day holds, and `compute actions runs archive|unarchive <run-id...>` archives or restores runs (owners/admins; confirm on a terminal or pass `-y`).
