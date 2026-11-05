---
"@computesdk/blaxel": patch
---

Run commands through Blaxel's process API natively: env and cwd use the request's `env`/`workingDir` fields so they apply to every part of a compound command, background commands start without waiting, `streamCommand` streams output live, and timed-out commands are killed in the box.
