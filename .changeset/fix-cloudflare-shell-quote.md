---
"@computesdk/cloudflare": patch
---

Fix shell injection risk in the Cloudflare provider's `readdir` direct mode by quoting filesystem paths with `shellQuote` (single-quote based) instead of the insufficient double-quote `shellEscape`. Paths containing `$`, backticks, or backslashes are now treated as inert literals.
