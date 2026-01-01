---
"@computesdk/provider": patch
"@computesdk/e2b": patch
"@computesdk/modal": patch
"@computesdk/cloudflare": patch
"@computesdk/blaxel": patch
"@computesdk/codesandbox": patch
"@computesdk/daytona": patch
"@computesdk/vercel": patch
"@computesdk/runloop": patch
"@computesdk/railway": patch
"@computesdk/avm": patch
"@computesdk/aws-ecs": patch
"@computesdk/aws-lambda": patch
"@computesdk/fly": patch
"@computesdk/lambda": patch
"@computesdk/namespace": patch
"@computesdk/render": patch
"@computesdk/test-utils": patch
---

fix: align provider factory with clean command execution

Updates all providers to use the new clean command signature introduced in #192.

**Changes:**
- Provider factory `runCommand` signature simplified from `(command, args?, options?)` to `(command, options?)`
- All 13 providers updated to handle `cwd`, `env`, and `background` options by wrapping commands with shell constructs
- Test suite updated to use clean command strings instead of args arrays

**Related:**
- Follows #192 which updated the gateway client to send clean commands
- Part of the larger refactor to remove client-side command preprocessing

**Migration:**
Providers now receive clean command strings and handle options uniformly:
```typescript
// Before
runCommand(sandbox, 'npm', ['install'], { cwd: '/app' })

// After  
runCommand(sandbox, 'npm install', { cwd: '/app' })
```
