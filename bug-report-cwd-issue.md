# Bug Report: `runCommand` with `cwd` option fails on E2B

## Summary
When using `runCommand()` with the `cwd` option in the E2B provider, the command fails with "no such file or directory" even when the directory exists and is confirmed via `ls()`.

## Error Details

```
Error: API request failed (500): failed to start command: chdir app: no such file or directory
    at Sandbox.request (file:///Users/garrison/projects/github/computesdk/computesdk/packages/computesdk/dist/index.mjs:2067:15)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async Run.command [as commandHandler] (file:///Users/garrison/projects/github/computesdk/computesdk/packages/computesdk/dist/index.mjs:1924:24)
```

## Reproduction Steps

```javascript
// In E2B workbench REPL
ls()                                              // ✅ Works
mkdir('app')                                      // ✅ Works (shows: Running: mkdir -p app)
ls()                                              // ✅ Shows 'app' directory exists
await runCommand('npm install', {cwd: "app"})     // ❌ Fails with "chdir app: no such file or directory"
```

## Expected Behavior
The command should execute in the specified working directory, just like it would with a shell command `cd app && npm install`.

## Actual Behavior
The server returns a 500 error indicating it cannot change to the directory, even though:
1. The directory exists (confirmed by `ls()`)
2. The directory was just created successfully
3. No filesystem sync/timing issues (tried with delays)

## Request Details

### Client-side Request Construction

**Entry Point:** `packages/computesdk/src/client/index.ts:1994-2006`
```typescript
async runCommand(
  command: string,
  options?: { background?: boolean; cwd?: string; env?: Record<string, string> }
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}> {
  // Send raw command to server - no preprocessing!
  // Server will handle: sh -c "command", cmd.Dir, cmd.Env, goroutines
  return this.run.command(command, options);
}
```

**Run Resource Handler:** `packages/computesdk/src/client/index.ts:830-844`
```typescript
this.run = new Run({
  code: async (code, options) => { /* ... */ },
  command: async (command, options) => {
    const result = await this.runCommandRequest({ 
      command, 
      shell: options?.shell, 
      background: options?.background,
      cwd: options?.cwd,              // ← cwd is passed through
      env: options?.env
    });
    return {
      stdout: result.data.stdout,
      stderr: result.data.stderr,
      exitCode: result.data.exit_code ?? 0,
      durationMs: result.data.duration_ms ?? 0,
    };
  },
});
```

**HTTP Request:** `packages/computesdk/src/client/index.ts:1222-1233`
```typescript
async runCommandRequest(options: {
  command: string;
  shell?: string;
  background?: boolean;
  cwd?: string;
  env?: Record<string, string>;
}): Promise<RunCommandResponse> {
  return this.request<RunCommandResponse>('/run/command', {
    method: 'POST',
    body: JSON.stringify(options),
  });
}
```

### Expected Request Payload

```json
{
  "command": "npm install",
  "cwd": "app"
}
```

### E2B Provider Implementation (Client-side Workaround)

**Location:** `packages/e2b/src/index.ts:232-286`

The E2B provider implements a **client-side workaround** because E2B's API doesn't support native `cwd`/`env` options:

```typescript
runCommand: async (sandbox: E2BSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
  const startTime = Date.now();

  try {
    // Build command with options (E2B doesn't support these natively, so we wrap with shell)
    let fullCommand = command;
    
    // Handle environment variables
    if (options?.env && Object.keys(options.env).length > 0) {
      const envPrefix = Object.entries(options.env)
        .map(([k, v]) => `${k}="${escapeShellArg(v)}"`)
        .join(' ');
      fullCommand = `${envPrefix} ${fullCommand}`;
    }
    
    // Handle working directory
    if (options?.cwd) {
      fullCommand = `cd "${escapeShellArg(options.cwd)}" && ${fullCommand}`;
    }
    
    // Handle background execution
    if (options?.background) {
      fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
    }

    const execution = await sandbox.commands.run(fullCommand);

    return {
      stdout: execution.stdout,
      stderr: execution.stderr,
      exitCode: execution.exitCode,
      durationMs: Date.now() - startTime
    };
  } catch (error) {
    // ... error handling
  }
}
```

### Shell Escaping Utility

**Location:** `packages/provider/src/utils.ts:56-62`

```typescript
export function escapeShellArg(arg: string): string {
  return arg
    .replace(/\\/g, '\\\\')  // Escape backslashes
    .replace(/"/g, '\\"')    // Escape double quotes
    .replace(/\$/g, '\\$')   // Escape dollar signs (variable expansion)
    .replace(/`/g, '\\`');   // Escape backticks (command substitution)
}
```

For the path `"app"`, this returns `"app"` (no changes needed).

### Final Command Sent to E2B

```javascript
cd "app" && npm install
```

## Server-Side Issue

The error originates from the **server** (not the E2B provider client code):

```
Error: API request failed (500): failed to start command: chdir app: no such file or directory
```

This error message format (`"failed to start command: chdir app: no such file or directory"`) suggests:

1. The server is receiving the request at `POST /run/command`
2. The server is attempting to use Go's `cmd.Dir` or similar to change directory
3. The server's `chdir` operation is failing despite the directory existing

## Questions for Server Team

1. **How does the server handle the `cwd` option from the request payload?**
   - Does it use `cmd.Dir` in Go?
   - Does it parse shell commands to extract `cd` statements?
   - Does it validate the path exists before attempting to chdir?

2. **Path resolution:**
   - Is the server resolving the path as relative or absolute?
   - What is the base directory for relative paths?
   - Is there any path transformation happening?

3. **Filesystem state:**
   - Could there be a container/namespace issue where the client sees the directory but the server doesn't?
   - Is there a filesystem sync delay between operations?
   - Are mkdir operations fully committed before subsequent commands execute?

4. **Expected request format:**
   - Should the client send `"cwd": "app"` or `"cwd": "/app"`?
   - Should relative paths be resolved client-side before sending?
   - Is the current request format correct?

## Environment

- **Provider:** E2B
- **Client:** ComputeSDK Workbench REPL
- **Mode:** Direct mode (not gateway)
- **Error Code:** 500 (Internal Server Error)

## Additional Context

This issue is **specific to the server implementation**. The E2B provider's client-side workaround (wrapping with `cd "..." && command`) works correctly when using the E2B SDK directly, which suggests the server may be handling the `cwd` option differently than expected.
