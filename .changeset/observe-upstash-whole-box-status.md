---
"@computesdk/upstash": patch
---

Read fresh, identity-checked whole Box metadata when the native auxiliary status
endpoint returns HTTP 404. Keep each full Box bound to its original account and
region, and never interpret an auxiliary error as resource absence.
