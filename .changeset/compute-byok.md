---
'@computesdk/cli': minor
---

New `compute byok` commands for the org's BYOK providers over `/api/v1/providers`: `compute byok [list]`, `show`, `configure [--verify]`, `verify`, `remove [-y]`, and `rate set <provider> <usd> [--per]` / `rate clear` for custom rates. A custom rate is for the org's own cost reporting only — it never changes billing. `compute actions providers configure|verify|remove` are deprecated in favour of `compute byok`. User logins need `compute login` once more to pick up the `providers` scopes.
