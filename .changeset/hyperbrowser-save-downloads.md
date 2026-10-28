---
"@computesdk/provider": patch
"@computesdk/hyperbrowser": patch
---

Add `saveDownloads` to `CreateBrowserSessionOptions` and forward it to Hyperbrowser's create-session params. Previously the option was silently dropped by `mapSessionOptions`, so sessions were always created with downloads disabled and the session downloads API reported `not_enabled`.
