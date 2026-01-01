# Clean Command Execution - Summary

## PRs Created

### PR #192 - Gateway Client (MERGED ✅)
**Pull Request**: https://github.com/computesdk/computesdk/pull/192  
**Branch**: `fix/clean-command-execution`  
**Status**: Merged

### PR #193 - Provider Factory Alignment (IN PROGRESS ⏳)
**Pull Request**: https://github.com/computesdk/computesdk/pull/193  
**Branch**: `fix/align-provider-factory-with-clean-commands`  
**Status**: CI running - tests updated

### PR #194 - Remove cmd() Callable (PENDING 📋)
**Pull Request**: https://github.com/computesdk/computesdk/pull/194  
**Branch**: `refactor/remove-cmd-callable-separate-concerns`  
**Status**: Depends on #193

## What We Did

Fixed the SDK to send clean commands to the gateway server instead of preprocessing them with shell wrappers that conflicted with server-side execution.

### The Problem (Identified by Sandbox Service Team)

1. **Double shell wrapping** - SDK: `sh -c`, Server: `sh -c` → nested shells
2. **Lost output** - SDK added `> /dev/null 2>&1` → no stdout/stderr captured
3. **Broken tracking** - SDK added `&` → shell exits immediately, `cmd_id` useless
4. **No environment support** - `cwd` was `cd "path" &&`, couldn't add `env` vars
5. **Unsafe execution** - Shell `cd` instead of OS-level `cmd.Dir`

### The Solution

#### 1. Simplified API (Breaking Change)

**Before:**
```typescript
runCommand(
  commandOrArray: string | [string, ...string[]],
  argsOrOptions?: string[] | RunCommandOptions,
  maybeOptions?: RunCommandOptions
)
```

**After:**
```typescript
runCommand(command: string, options?: RunCommandOptions)
```

#### 2. Removed Preprocessing

**Before:**
```typescript
// SDK did this:
const finalCommand = cmd(commandParts, options);
// Added: sh -c, cd "/path" &&, nohup, > /dev/null 2>&1, &
const fullCommand = escapeArgs(finalCommand);
```

**After:**
```typescript
// SDK now does:
return this.run.command(command, options);
// Server handles everything!
```

#### 3. Added Server-Side Options

```typescript
interface CommandRunOptions {
  shell?: string;
  background?: boolean;
  cwd?: string;              // NEW - server uses cmd.Dir
  env?: Record<string, string>; // NEW - server uses cmd.Env
}
```

### HTTP Request Changes

**Before (Broken):**
```json
{
  "command": "sh -c 'cd \"/\" && nohup sleep 30 && mkdir /hello > /dev/null 2>&1 &'",
  "background": true
}
```

**After (Clean):**
```json
{
  "command": "sleep 30 && mkdir /hello",
  "background": true,
  "cwd": "/",
  "env": {}
}
```

## Benefits

✅ Output captured properly (no `> /dev/null`)  
✅ Status tracking works (server goroutines, not shell `&`)  
✅ Environment variables supported  
✅ Safer execution (OS-level `cmd.Dir`, not shell `cd`)  
✅ No double wrapping  
✅ Simpler code (~30 lines removed)  
✅ Clearer API (one way to do it)  

## Migration Required

Users need to update:

```typescript
// Old
sandbox.runCommand(['npm', 'install'], { cwd: '/app' })
sandbox.runCommand('npm', ['install'])

// New
sandbox.runCommand('npm install', { cwd: '/app' })
sandbox.runCommand('npm install')
```

Simple: join command parts into strings!

## Files Changed

### PR #192 - Gateway Client
1. **packages/computesdk/src/client/index.ts**
   - Simplified `runCommand()` signature
   - Removed `cmd()` preprocessing
   - Added `cwd` and `env` to `runCommandRequest()`
   - Updated `Run.command` handler to pass through options

2. **packages/computesdk/src/client/resources/run.ts**
   - Added `cwd` and `env` to `CommandRunOptions` interface

3. **packages/computesdk/src/types/universal-sandbox.ts**
   - Simplified universal interface signature to match

4. **packages/workbench/src/cli/commands.ts**
   - Updated to join command array before calling `runCommand()`

5. **packages/workbench/src/cli/repl.ts**
   - Updated exposed `runCommand` to use simplified signature

### PR #193 - Provider Factory Alignment
1. **packages/provider/src/factory.ts**
   - Removed `cmd()` preprocessing from `GeneratedSandbox.runCommand()`
   - Simplified signature to `runCommand(command: string, options?: RunCommandOptions)`
   - Updated `SandboxMethods` interface

2. **Updated 13 Providers** to align with factory:
   - **E2B, Modal, Cloudflare, Blaxel, Codesandbox, Daytona, Vercel, Runloop** - Handle `cwd`, `env`, `background` by wrapping with shell
   - **Railway, AVM, AWS ECS, AWS Lambda, Fly, Lambda, Namespace, Render** - Updated stub signatures

3. **packages/test-utils/src/provider-test-suite.ts**
   - Updated all test cases from `runCommand(cmd, [args])` to `runCommand('cmd args')`
   - Updated mock sandbox implementation to use new signature
   - Removed `args` parameter from test expectations

### PR #194 - Remove cmd() Callable
1. **packages/cmd/src/index.ts**
   - Removed callable `cmd(command, options)` function
   - Now `cmd` is just a namespace for command builders
   - Shell wrapping moved to explicit `shell()`, `bash()`, `zsh()` functions

## Testing Status

### PR #192 - Gateway Client
✅ **Merged** - All tests passed

### PR #193 - Provider Factory Alignment
✅ **Builds pass** - All packages build successfully  
✅ **Type checks pass** - No TypeScript errors  
⏳ **CI running** - Tests updated and running on GitHub

### PR #194 - Remove cmd() Callable
📋 **Pending** - Waiting for #193 to merge

## Work Done Today (Dec 31, 2025)

### Fixed Missing Runloop Provider Update
**Problem**: PR #193 was failing because runloop provider wasn't updated to new signature
**Solution**: Updated runloop provider to match other providers:
- Changed `runCommand(sandbox, command, args?: string[])` to `runCommand(sandbox, command, options?: RunCommandOptions)`
- Implemented options handling for `cwd`, `env`, and `background`
- Updated all filesystem helper methods to use new signature

**Commits**:
- `ec2ad70`: "fix: update runloop provider to use RunCommandOptions signature"
- `4400bbe`: "fix: update runloop filesystem methods to use new command signature"

### Fixed Test Suite
**Problem**: Test suite was still using old `runCommand(cmd, [args])` pattern
**Solution**: Updated test suite to use clean command strings:
- Changed test calls from `runCommand('echo', ['Hello'])` to `runCommand('echo "Hello"')`
- Updated mock sandbox implementation
- All shell command quoting tests now use single strings

**Commits**:
- `4601e80`: "fix: update test suite to use new runCommand signature without args array"

### Provider Implementation Pattern
All providers that don't natively support `RunCommandOptions` now follow this pattern:

```typescript
runCommand: async (sandbox, command, options?: RunCommandOptions) => {
  let fullCommand = command;
  
  // Handle environment variables
  if (options?.env) {
    const envPrefix = Object.entries(options.env)
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ');
    fullCommand = `${envPrefix} ${fullCommand}`;
  }
  
  // Handle working directory
  if (options?.cwd) {
    fullCommand = `cd "${options.cwd}" && ${fullCommand}`;
  }
  
  // Handle background execution
  if (options?.background) {
    fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
  }
  
  return providerAPI.execute(fullCommand);
}
```

## Next Steps

### For SDK (Done ✅)
- [x] Remove preprocessing
- [x] Add `cwd` and `env` parameters
- [x] Simplify signature
- [x] Update all usage sites
- [x] Create PR

### For Gateway Server (Pending)
- [ ] Accept `cwd` in `/run/command` endpoint
- [ ] Accept `env` in `/run/command` endpoint
- [ ] Use `cmd.Dir` for working directory
- [ ] Use `cmd.Env` for environment variables
- [ ] Ensure single `sh -c` wrapping
- [ ] Test command tracking with goroutines

## Example Usage

### Basic Command
```typescript
await sandbox.runCommand('ls -la')
```

### With Working Directory
```typescript
await sandbox.runCommand('npm install', { cwd: '/app' })
```

### With Background Execution
```typescript
await sandbox.runCommand('npm run dev', { background: true })
```

### With Environment Variables
```typescript
await sandbox.runCommand('node server.js', {
  background: true,
  cwd: '/app',
  env: { PORT: '3000', NODE_ENV: 'production' }
})
```

### Complex Command with All Options
```typescript
const result = await sandbox.runCommand('sleep 30 && echo done', {
  background: true,
  cwd: '/tmp',
  env: { DEBUG: '1' }
})

// Later check status (when server supports it)
const cmd = await sandbox.getCommand(terminalId, result.cmdId)
console.log(cmd.status)  // "running" or "completed"
console.log(cmd.stdout)   // "done" (not lost!)
```

## Why No Backward Compatibility?

Removing backward compatibility allowed us to:

1. **Simplify the API** - One clear signature instead of confusing overloads
2. **Remove complexity** - ~30 lines of argument parsing logic gone
3. **Better error messages** - TypeScript can provide clearer errors
4. **Future-proof** - Easier to extend with new options

The migration is simple (join arrays to strings), so breaking change is acceptable.

## Technical Details

### Removed Imports
```typescript
// Before
import { cmd, escapeArgs, mkdir, test } from '@computesdk/cmd';
import type { Command } from '@computesdk/cmd';

// After
import { escapeArgs, mkdir, test } from '@computesdk/cmd';
// No more cmd() or Command type!
```

### Filesystem Operations Still Work
Filesystem operations (`mkdir`, `test.exists`) still use `escapeArgs()` to convert Command arrays to strings:

```typescript
mkdir: async (path: string) => {
  await this.runCommand(escapeArgs(mkdir(path)));
}
```

This works because `mkdir(path)` returns `['mkdir', '-p', path]`, which `escapeArgs()` converts to `"mkdir -p /path"`.

## Commit Message

```
fix: send clean commands to server, remove client-side preprocessing

BREAKING CHANGE: Simplified runCommand signature from overloaded form to single clean signature.

Changes:
- Remove cmd() preprocessing that wrapped commands with sh -c, nohup, &, > /dev/null
- Add cwd and env parameters to runCommandRequest and CommandRunOptions
- Simplify runCommand signature to runCommand(command: string, options?: RunCommandOptions)
- Update universal Sandbox interface to match simplified signature
- Update workbench to use new signature

Benefits:
- Server can capture output properly (no > /dev/null)
- Server can track command status with goroutines (no shell &)
- Server can use cmd.Dir for working directory (safer than cd)
- Server can use cmd.Env for environment variables
- No double shell wrapping
- Cleaner API with single obvious way to run commands

Migration:
Old: sandbox.runCommand(['npm', 'install'], { cwd: '/app' })
New: sandbox.runCommand('npm install', { cwd: '/app' })

Fixes issues identified by sandbox service team where client preprocessing
conflicted with server-side execution, causing lost output and broken tracking.
```

---

**Ready for Review!** 🚀
