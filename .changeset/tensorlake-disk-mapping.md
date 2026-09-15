---
"@computesdk/tensorlake": patch
"computesdk": patch
---

Fix disk sizing on sandbox create: `ephemeralDiskMb` was passed under a name the Tensorlake SDK's `Sandbox.create` ignores — it now maps to `diskMb`, so the requested disk size is honored. `SandboxResourceOptions` gains a typed `diskMb` field (Tensorlake), and the adapter accepts `diskMb` directly with `ephemeralDiskMb` kept as an alias.
