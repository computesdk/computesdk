---
"@computesdk/tensorlake": patch
---

Fix disk sizing on sandbox create: `ephemeralDiskMb` was passed under a name the Tensorlake SDK's `Sandbox.create` ignores — it now maps to `diskMb`, so the requested disk size is honored.
