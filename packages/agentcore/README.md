# @computesdk/agentcore

[AWS Bedrock AgentCore Code Interpreter](https://docs.aws.amazon.com/bedrock-agentcore/) provider for [ComputeSDK](https://www.computesdk.com).

AgentCore Code Interpreter gives you secure, fully-managed, session-based sandboxes for running code and shell commands — no infrastructure to provision. This provider maps a ComputeSDK sandbox onto an AgentCore Code Interpreter session.

## Features

- **Command execution** — run shell commands in an isolated, managed sandbox
- **Persistent filesystem** — a sandbox is a long-lived session; files written in one call are visible in later calls
- **Filesystem operations** — read, write, list, and remove files
- **Standard AWS auth** — uses the default AWS credential provider chain (env vars, SSO, profiles, instance roles), so temporary credentials and named profiles just work

## Installation

```bash
npm install @computesdk/agentcore
```

## Authentication

The provider uses the [standard AWS credential provider chain](https://docs.aws.amazon.com/sdkref/latest/guide/standardized-credentials.html) — the same resolution order as the AWS CLI. You don't pass an API key; you authenticate to AWS however you normally would:

- Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`)
- An SSO session (`aws sso login`)
- A named profile (`AWS_PROFILE`, or `profile` in config)
- EC2/ECS/EKS instance roles

A **region** is required, via `region` in config or `AWS_REGION` / `AWS_DEFAULT_REGION`.

### IAM permissions

The principal needs these `bedrock-agentcore` actions on the code interpreter:

- `bedrock-agentcore:StartCodeInterpreterSession`
- `bedrock-agentcore:InvokeCodeInterpreter`
- `bedrock-agentcore:StopCodeInterpreterSession`
- `bedrock-agentcore:GetCodeInterpreterSession` (for `getById`)
- `bedrock-agentcore:ListCodeInterpreterSessions` (for `list`)

## Usage

```typescript
import { compute } from 'computesdk';
import { agentcore } from '@computesdk/agentcore';

// Uses the default AWS credential chain; region from env or config.
compute.setConfig({ defaultProvider: agentcore({ region: 'us-west-2' }) });

const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand('echo "Hello from AgentCore" && python3 -c "print(2 + 2)"');
console.log(result.stdout); // Hello from AgentCore\n4

await sandbox.filesystem.writeFile('/tmp/data.txt', 'persisted across calls');
console.log(await sandbox.filesystem.readFile('/tmp/data.txt'));

await sandbox.destroy();
```

### Using a named profile

```typescript
agentcore({ region: 'us-west-2', profile: 'my-profile' });
```

### Using explicit / temporary credentials

```typescript
agentcore({
  region: 'us-west-2',
  credentials: {
    accessKeyId: '...',
    secretAccessKey: '...',
    sessionToken: '...', // temporary credentials supported
  },
});
```

## Configuration

| Option | Type | Description |
|---|---|---|
| `region` | `string` | AWS region. Falls back to `AWS_REGION` / `AWS_DEFAULT_REGION`. |
| `codeInterpreterIdentifier` | `string` | Code interpreter to use. Defaults to the managed `aws.codeinterpreter.v1`. |
| `profile` | `string` | Named AWS profile to use for credentials. |
| `credentials` | `AwsCredentialIdentity \| AwsCredentialIdentityProvider` | Explicit credentials. Omit to use the default chain. |
| `sessionTimeoutSeconds` | `number` | Session idle timeout in seconds (max 28800 / 8h). Default 900. Overridden by the per-`create` `timeout` (ms). |

## API Reference

### Command Execution

```typescript
// Run a shell command
const result = await sandbox.runCommand('echo "Hello" && ls -la');
console.log(result.stdout, result.stderr, result.exitCode);

// Run Python
const py = await sandbox.runCommand('python3 -c "print(2 + 2)"');

// Run a multi-line script via heredoc
const script = await sandbox.runCommand(`python3 - <<'PY'
import json
print(json.dumps({"ok": True}))
PY`);

// Pass environment variables and a working directory
await sandbox.runCommand('printenv TOKEN', { env: { TOKEN: 'abc' }, cwd: '/tmp' });

// Install packages
await sandbox.runCommand('pip install requests');
```

`runCommand` never throws for command failures — a non-zero exit is returned in `exitCode`, with `stdout`/`stderr` captured separately.

### Filesystem Operations

```typescript
await sandbox.filesystem.writeFile('/tmp/hello.py', 'print("Hello World")');
const content = await sandbox.filesystem.readFile('/tmp/hello.py');
await sandbox.filesystem.mkdir('/tmp/data');
const files = await sandbox.filesystem.readdir('/tmp');      // FileEntry[]
const exists = await sandbox.filesystem.exists('/tmp/hello.py');
await sandbox.filesystem.remove('/tmp/hello.py');
```

Filesystem calls operate on text (UTF-8). To move binary data, fetch it inside the
sandbox (`runCommand('curl -sL URL -o /tmp/file')`) or base64 it over `runCommand`.

### Sandbox Management

```typescript
const info = await sandbox.getInfo();          // { id, provider, status, createdAt, timeout, metadata }
const existing = await provider.sandbox.getById(sandbox.sandboxId);  // or null if terminated
const all = await provider.sandbox.list();     // READY sessions
await sandbox.destroy();
```

## Error Handling

`create` translates common AWS failures into actionable messages:

```typescript
try {
  const sandbox = await compute.sandbox.create();
} catch (err) {
  // e.g. "Missing AWS region for AgentCore. Pass it: agentcore({ region: 'us-west-2' }) ..."
  // or   "AWS authentication failed for AgentCore. Check your credentials ..."
  // or   "Access denied ... Ensure your IAM principal allows bedrock-agentcore:*CodeInterpreter* ..."
  console.error(err.message);
}
```

- `runCommand` returns `exitCode: 127` with the error on `stderr` if the invocation itself fails (e.g. the session expired) — it does not throw.
- Filesystem operations throw on failure (e.g. reading a missing file).

## Examples

### Data processing

```typescript
const sandbox = await compute.sandbox.create();

await sandbox.filesystem.writeFile('/tmp/data.csv', 'value\n10\n20\n30\n');
const result = await sandbox.runCommand(`python3 - <<'PY'
import csv, json
with open('/tmp/data.csv') as f:
    values = [int(r['value']) for r in csv.DictReader(f)]
print(json.dumps({'count': len(values), 'sum': sum(values), 'mean': sum(values)/len(values)}))
PY`);
console.log(JSON.parse(result.stdout)); // { count: 3, sum: 60, mean: 20 }

await sandbox.destroy();
```

### As an AI agent tool

The universal `Sandbox` interface maps cleanly onto agent-framework tools — wrap each
method in a tool and hand them to your agent (works with any agent SDK):

```typescript
import { tool } from '@strands-agents/sdk';
import { z } from 'zod';

const runCommand = tool({
  name: 'run_command',
  description: 'Run a shell command in the sandbox.',
  inputSchema: z.object({ command: z.string() }),
  callback: async ({ command }) => {
    const r = await sandbox.runCommand(command);
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode };
  },
});
// ...similarly wrap writeFile / readFile / readdir, then: new Agent({ tools: [...] })
```

## Supported runtimes

The managed `aws.codeinterpreter.v1` interpreter ships with Python and a standard Linux shell, so any language runtime available in that environment can be driven via `runCommand`.

## Limitations

- **No preview URLs / ports.** AgentCore Code Interpreter has no inbound network endpoint, so `getUrl()` throws. Use it for code execution, not for hosting dev servers.
- **No interactive PTY.** Commands are request/response; there is no bidirectional terminal.
- **Sessions expire.** A session auto-terminates after its idle timeout; create a new sandbox afterward.
- **Filesystem persists, shell environment does not.** Files survive across `runCommand` calls, but each command runs in a fresh shell — `cd`, `export`, and shell variables do not carry over. Chain them in a single command (e.g. `cd /app && npm test`) or use the `cwd`/`env` options.
- **Background commands don't outlive the call.** `runCommand(..., { background: true })` returns immediately, but AgentCore terminates the process tree when the invocation ends, so the job is killed rather than left running. Use a single command that runs to completion instead.
- **Large writes are chunked.** To stay under AgentCore's command-size limit, `writeFile` uploads base64 in ~60KB chunks — roughly one round-trip per 60KB, so a 5MB file takes ~40s. Reads are single round-trips and fast.
- **~10 concurrent operations per session.** AgentCore caps concurrent invocations on a single session; beyond ~10 simultaneous `runCommand`/filesystem calls, extra ones fail with a quota error. Spread heavy parallelism across multiple sandboxes.

## License

MIT
