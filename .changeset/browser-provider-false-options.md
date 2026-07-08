---
"@computesdk/anchorbrowser": patch
"@computesdk/browserbase": patch
"@computesdk/browseruse": patch
"@computesdk/hyperbrowser": patch
"@computesdk/kernel": patch
"@computesdk/notte": patch
"@computesdk/steel": patch
---

Preserve explicit `stealth: false` and `proxies: false` browser session options where provider APIs support them, and warn once when a provider cannot honor the option.
