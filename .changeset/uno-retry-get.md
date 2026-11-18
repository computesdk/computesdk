---
'@computesdk/uno': patch
---

Repeat a box read (`getBox`, readiness polling) lost on the way — dropped connection, timeout, 429 or 5xx — up to 4 times over ~3 s, so one dropped poll right after create no longer fails the create and deletes a healthy machine.
