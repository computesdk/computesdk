---
"@computesdk/microsandbox": patch
---

Remove backend serialization for concurrent operations using one backend configuration per process. Accept memoryMib and rootDiskMib in sandbox create options so requested resources are not silently replaced by defaults. Retry sandbox shutdown and deletion, and report failed cleanup of cancelled sandbox creation. Require Microsandbox SDK 0.6.18 or newer within the 0.6 release line. Default to ephemeral sandboxes with a 15-minute idle timeout; support explicit persistent and idle timeout overrides.
