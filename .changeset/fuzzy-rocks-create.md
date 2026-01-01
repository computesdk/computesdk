---
"@computesdk/cmd": minor
"@computesdk/workbench": patch
---

refactor: remove cmd() callable, separate shell wrapping from command building

**Breaking Change**: The `cmd` export is no longer callable. It's now a pure namespace for command builders.

**Before:**
```typescript
import { cmd } from '@computesdk/cmd';

cmd.npm.install()               // Building ✅
cmd(npm.install(), { cwd })     // Wrapping ❌ NO LONGER WORKS
```

**After:**
```typescript
import { npm, shell } from '@computesdk/cmd';

npm.install()                   // Building ✅
shell(npm.install(), { cwd })   // Wrapping ✅ Use shell() instead
```

**Better (Recommended):**
```typescript
// Let sandbox handle options
await sandbox.runCommand('npm install', { cwd: '/app' })
```

**Why:**
- Separates concerns: building vs. shell wrapping
- Aligns with modern `runCommand(command, options)` API
- Removes confusion from dual-purpose export
- Completes the clean command execution refactor from #192 and #193

**Migration:**
- Replace `cmd(command, options)` with `shell(command, options)`
- Or better: use `sandbox.runCommand(command, options)` directly
