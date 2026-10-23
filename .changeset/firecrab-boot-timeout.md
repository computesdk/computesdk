---
"@computesdk/ec2-firecrab": patch
---

Add `bootTimeoutMs` config for the create→running wait (default 120s) so bursts on small hosts aren't truncated by the hardcoded boot deadline.
