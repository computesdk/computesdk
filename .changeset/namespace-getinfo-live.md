---
"@computesdk/namespace": patch
---

fix(namespace): refresh instance status in getInfo

getInfo returned the status snapshot captured when the handle was
attached, so a long-held handle kept reporting running after the
instance was suspended, errored, or destroyed. getInfo now describes
the instance live: terminal and suspended states map to stopped, a
describe 404 maps to stopped (NotFound only arrives once the terminal
statuses have passed), and the refreshed state is written back onto the
handle. Unrecognized or future statuses fall back to running instead of
reading as stopped.
