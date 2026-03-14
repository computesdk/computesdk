---
"@computesdk/beam": patch
"@computesdk/blaxel": patch
"@computesdk/cloudflare": patch
"@computesdk/codesandbox": patch
"@computesdk/daytona": patch
"@computesdk/docker": patch
"@computesdk/e2b": patch
"@computesdk/fly": patch
"@computesdk/hopx": patch
"@computesdk/modal": patch
"@computesdk/runloop": patch
"@computesdk/sprites": patch
"@computesdk/vercel": patch
---

Forward CreateSandboxOptions consistently to all provider SDKs. Known fields (timeout, envs, name, metadata, templateId, snapshotId) are now properly mapped and forwarded with correct renaming per provider. Arbitrary provider-specific options are passed through via rest-spread so users can set options like cpu, memory, gpu, resources, etc. through the unified interface.
