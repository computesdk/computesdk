---
'computesdk': patch
'@computesdk/provider': patch
'@computesdk/archil': patch
'@computesdk/namespace': patch
'@computesdk/freestyle': patch
'@computesdk/gcp': patch
---

Add the `3xl` standard size (32 vCPU / 128 GiB). Size mappings can now record the provider's listed shape in `resolved` (including `diskMiB`); a shape below the standard size needs `belowStandard` with the provider limit that causes it.
