---
"computesdk": patch
"@computesdk/provider": patch
"@computesdk/e2b": patch
"@computesdk/modal": patch
"@computesdk/createos-sandbox": patch
"@computesdk/archil": patch
---

Add first-class, provider-agnostic volume support alongside sandbox, template, and snapshot. Introduces `Volume` universal types, optional `volume` managers on providers, and `ComputeManager.volume` routing. E2B, Modal, CreateOS, and Archil now expose volume lifecycle methods and honor `CreateSandboxOptions.volumeIds` at sandbox creation time.
