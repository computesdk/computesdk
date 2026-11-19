---
'computesdk': patch
'@computesdk/provider': patch
'@computesdk/archil': patch
'@computesdk/namespace': patch
'@computesdk/freestyle': patch
'@computesdk/gcp': patch
---

Add the `3xl` standard size (32 vCPU / 64 GiB). Size mappings can now record the provider's listed shape in `resolved` (including `diskMiB`). vCPU picks the size: a shape needs at least the size's vCPU and fewer than the next size's. Memory is a floor with a 10% tolerance (`INSTANCE_SIZE_MEMORY_TOLERANCE`): extra RAM is allowed, and RAM below the size needs `belowStandard` with the provider limit and is recorded as `memoryShortfallMiB`. Archil `3xl` is now supported (32 vCPU / 64 GiB); Namespace maps `xs` to its 1x2 minimum shape and `3xl` to 32x64.
