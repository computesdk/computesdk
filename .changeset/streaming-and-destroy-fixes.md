---
"computesdk": minor
"@computesdk/workbench": patch
"@computesdk/cmd": patch
---

## Streaming Output Support for `runCommand()`

Added `onStdout` and `onStderr` callback options to `sandbox.runCommand()` for real-time output streaming:

```typescript
await sandbox.runCommand('npm install', {
  onStdout: (data) => process.stdout.write(data),
  onStderr: (data) => process.stderr.write(data),
});
```

### Streaming Modes

| `background` | callbacks | Behavior |
|--------------|-----------|----------|
| `false` | none | Wait for completion, return result |
| `true` | none | Return immediately |
| `false` | `onStdout`/`onStderr` | Stream output, wait for completion |
| `true` | `onStdout`/`onStderr` | Stream output, return immediately |

### Two-Phase Streaming Flow

Implemented a two-phase streaming protocol to prevent race conditions with fast commands:

1. `POST /run/command` with `stream: true` returns a pending command with `cmd_id` and `channel`
2. SDK subscribes to the channel via WebSocket
3. SDK sends `command:start` to trigger execution
4. Server broadcasts `command:stdout`, `command:stderr`, `command:exit` events

This ensures the SDK is subscribed before the command runs.

## `sandbox.destroy()` Fix

Fixed `sandbox.destroy()` to actually destroy the sandbox via the gateway API, not just disconnect the WebSocket.

## Provider Compatibility Tests

Added comprehensive provider compatibility test suite that validates SDK functionality across providers (e2b, vercel, daytona, modal). Tests cover:

- Sandbox lifecycle (create, connect, destroy)
- File operations (read, write, exists, remove, mkdir, readdir)
- Command execution (with cwd, env, background, streaming)
- PTY terminals (create, write, output streaming, destroy)
- Exec terminals (execute commands with result tracking)
- URL generation for different ports

## CI Integration

Added SDK integration test job to CI workflow that runs provider compatibility tests against e2b and vercel providers on PRs and main branch pushes.

## Workbench Improvements

- Added SDK debugging documentation to README with examples for reproducing test failures
- Added verbose mode for WebSocket debugging
- Improved terminal and filesystem commands
- Added `cd` command support
