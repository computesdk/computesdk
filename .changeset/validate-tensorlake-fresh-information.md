---
"@computesdk/tensorlake": patch
---

Stop fabricating a running sandbox when fresh information cannot be read.
Validate returned identity and state, retain the original canonical identity
across native handle updates, and report failed native sandboxes as errors.
