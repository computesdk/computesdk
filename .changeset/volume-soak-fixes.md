---
"@computesdk/provider": patch
"@computesdk/blaxel": patch
"@computesdk/daytona": patch
"@computesdk/miosa": patch
"@computesdk/modal": patch
"@computesdk/namespace": patch
"@computesdk/northflank": patch
"@computesdk/novita": patch
"@computesdk/sandbox0": patch
"@computesdk/tenki": patch
"@computesdk/vercel": patch
"@computesdk/microsandbox": patch
"@computesdk/declaw": patch
"@computesdk/e2b": patch
"@computesdk/createos-sandbox": patch
---

Volume soak fixes: `withVolumeSettle` retries volume delete while the provider reports it still attached (sandbox.destroy() returns before the control plane unmounts); daytona volume get/delete resolve by id or name (`volume.get` is name-keyed); miosa create defaults size_bytes to 1 GiB (missing field 422s); sandbox0 create sends the explicit s0fs/RWO request.
