---
"@computesdk/cli": patch
---

`run -d`/Ctrl-C-`d` summary: print the full instance id and a bare `destroy` hint (the short `3f2a…` form was not accepted back by the command). `snapshot-delete <id>` on the implicit instance now logs the resolved id instead of "undefined".
