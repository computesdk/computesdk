---
"@computesdk/namespace": patch
---

Honor `options.timeout` on sandbox create: the instance `deadline` was hard-coded to one hour, so every instance was destroyed ~60 minutes after creation regardless of the requested timeout. Callers that pass a longer timeout (e.g. a warm pool holding 6h boxes) now get the lifetime they asked for; the one-hour default is unchanged when no timeout is given.
