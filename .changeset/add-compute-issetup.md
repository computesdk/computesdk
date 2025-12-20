---
"@computesdk/cmd": minor
"@computesdk/workbench": patch
---

Add compute.isSetup() command to check daemon status

Added `compute.isSetup()` command to check if the ComputeSDK daemon is installed and running, enabling conditional setup workflows.

**New Command:**
- `compute.isSetup()` - Returns exit 0 if daemon is ready, exit 1 if setup needed
- Accepts optional `host` and `port` parameters for remote daemon checks

**Enhanced:**
- `compute.health()` now accepts `host` and `port` parameters (default: localhost:18080)

**Bug Fix:**
- Fixed default port from 3030 to 18080 across all compute commands

**Usage:**
```javascript
const result = await sandbox.runCommand(compute.isSetup());
if (result.exitCode === 0) {
  console.log('Daemon is ready!');
} else {
  await sandbox.runCommand(compute.setup({ apiKey: 'key' }));
}
```
