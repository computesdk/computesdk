---
"@computesdk/cli": patch
---

`compute actions dispatch --with-changes`: fix untracked files being dropped or misplaced when run from a subdirectory — `ls-files --others` and the `diff --no-index` for each untracked file now run from the repository root so patch paths stay repo-relative.
