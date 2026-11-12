---
"@computesdk/cli": patch
"@computesdk/platform": patch
---

Make the CLI router-first. `compute sandboxes settings` / `compute actions settings` show the router: managed routing (ComputeSDK default or your own managed order) and BYOK use, and `settings set` takes `--routing`, `--byok off|first|fallback|only` and `--byok-order` (`--order` stays as a hidden alias). New `compute sandboxes route` shows where a create would land, whether it's billed from ComputeSDK credit (managed) or by your provider (BYOK), the price and the router's walk; `quote` remains as a hidden alias. Sandbox output labels each placement managed or BYOK. Market commands and flags are hidden from help. `compute sandboxes create|route --provider daytona[,e2b]` narrows the router to those providers for one request, keeping its BYOK mode and order. Add `--byok` (only your own keys) or `--managed` (only ComputeSDK managed accounts) to override the router's BYOK mode for that request. `create --order` is hidden (still accepted). New `compute new` is short for `compute sandboxes create`; `compute new vercel` or `compute new --vercel` picks the provider (same as `--provider vercel`).
