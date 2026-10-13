# @computesdk/aws

AWS providers for ComputeSDK, one product per subpath:

| Import | Product |
|---|---|
| `@computesdk/aws/agentcore` | Bedrock AgentCore Code Interpreter sessions |
| `@computesdk/aws/ec2` | EC2 instances (on-demand or Spot), commands over SSM |

## EC2

AWS EC2 provider for ComputeSDK. Each sandbox is one EC2 instance launched from your launch template, on-demand
by default or Spot when you opt in. Commands run over
[SSM Run Command](https://docs.aws.amazon.com/systems-manager/latest/userguide/run-command.html) (`AWS-RunShellScript`).
There is no agent or gateway on the box and no inbound ports: the preinstalled SSM agent dials out.

## Installation

```bash
npm install @computesdk/aws
```

## Usage

```typescript
import { ec2 } from '@computesdk/aws/ec2';

// On-demand, everything else comes from the launch template
const compute = ec2({ launchTemplate: 'my-template' }); // region from AWS_REGION

const sandbox = await compute.instances.create();
const result = await sandbox.runCommand('node -v', { env: { CI: '1' }, cwd: '/tmp', timeout: 60_000 });
console.log(result.exitCode, result.stdout);
await sandbox.destroy();
```

### Spot

```typescript
import { ec2, isEc2CapacityError } from '@computesdk/aws/ec2';

const compute = ec2({
  region: 'us-east-2',
  launchTemplate: 'computesdk-market-medium',
  instanceType: [
    'c5d.large', 'm7a.large', 'c6in.large', 'r5a.large', 'm5a.large', 'r5ad.large', 'r5b.large',
    'r5n.large', 'c5a.large', 'r6a.large', 'm5ad.large', 'r6in.large', 'm6in.large',
  ],
  spot: { maxPricePerHour: '0.05' },
});

try {
  const sandbox = await compute.instances.create({ name: 'bench-1', metadata: { listing: 'lst_42' } });
} catch (error) {
  if (isEc2CapacityError(error)) console.log('No Spot capacity right now:', error.codes);
  else throw error;
}
```

## Configuration

| Option | Required | Description |
|---|---|---|
| `launchTemplate` | yes | Launch template name or id (`lt-...`) |
| `region` | no | AWS region; falls back to `AWS_REGION` |
| `instanceType` | no | One type, or a list to fall back across. Default: the launch template's |
| `subnetIds` | no | Subnets to fall back across, one per AZ. Default: the launch template's |
| `spot` | no | `true` or `{ maxPricePerHour }` for Spot. Default: on-demand |
| `credentials` | no | `AwsCredentialIdentity` or `AwsCredentialIdentityProvider`. Default: AWS SDK credential chain |
| `launchTemplateVersion` | no | Default `$Default` |

Advanced: `readyTimeoutMs` (default `120000`), `pollIntervalMs` (default `2000`),
`outputS3Bucket` / `outputS3KeyPrefix` (full command output, see below).

The launch template owns the AMI, IMDS settings, root volume, security group, networking, and an instance profile
that allows SSM. The provider never sets those.

A plain on-demand launch (at most one `instanceType`, no `subnetIds`) is a single `RunInstances` call. Spot,
several instance types, or `subnetIds` use an instant EC2 Fleet over every type × subnet pair
(`price-capacity-optimized` for Spot).

If your launch template doesn't pin a subnet, pass `subnetIds`; otherwise AWS falls back to the default VPC.

### Credentials

There are no API keys in config. Pass a credential provider for short-lived credentials, e.g. on Vercel with OIDC:

```typescript
import { awsCredentialsProvider } from '@vercel/functions/oidc';

ec2({ launchTemplate: 'my-template', credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN! }) });
```

## Behavior

- **Sandbox ID** is the EC2 instance ID.
- **Tags**: instances and volumes are tagged `computesdk:managed=true` (IAM policies can be conditioned on it),
  `computesdk:sandbox-name` when `name` is set, and every string `metadata` value (sanitized to EC2 tag limits, max 50 tags).
- **Capacity**: when no instance launches because of capacity, price, or quota errors, `create` throws
  `Ec2CapacityError` (`code: 'AWS_EC2_CAPACITY_UNAVAILABLE'`, `codes`, `errors`). Other fleet failures throw `Ec2FleetError`.
- **Readiness**: `create` returns once the instance is `Online` in SSM. On timeout (`Ec2ReadyTimeoutError`) or any
  error the instance is terminated before throwing. `create({ timeout })` overrides `readyTimeoutMs`.
- **Commands run as root** via `AWS-RunShellScript`. `env` is exported and `cwd` is entered in the same script;
  `timeout` maps to SSM `executionTimeout` (seconds, rounded up). Timed-out commands return exit code `124`.
- **Output limit**: SSM returns at most 24,000 characters each of stdout and stderr inline. Set
  `outputS3Bucket` (the instance profile needs `s3:PutObject` and the caller `s3:GetObject`) to get full output.
- `getById` returns `null` for unknown, terminated/shutting-down, or untagged instances. `list` returns managed
  `pending`/`running` instances. `destroy` is idempotent and refuses to terminate untagged instances.
- `getInstance()` / `getInfo().metadata` expose instance type, AZ, subnet, lifecycle (`spot`/`on-demand`), and launch time.
- Not supported: `getUrl` (no inbound traffic) and the filesystem API.

## Testing

```bash
pnpm test   # unit tests (mocked AWS)

# real AWS: any Ec2Config as JSON
AWS_EC2_INTEGRATION_CONFIG='{"launchTemplate":"my-template","region":"us-east-2","instanceType":"m7a.large"}' pnpm test
```

## AgentCore

[AWS Bedrock AgentCore Code Interpreter](https://docs.aws.amazon.com/bedrock-agentcore/) provider for ComputeSDK: secure,
fully-managed, session-based sandboxes for running code and shell commands, with no infrastructure to provision. Each
sandbox maps onto an AgentCore Code Interpreter session.

```bash
npm install @computesdk/aws
```

```typescript
import { agentcore } from '@computesdk/aws/agentcore';
```

Previously published as `@computesdk/agentcore`, which is now a deprecated re-export of this subpath.

### Authentication

The provider uses the [standard AWS credential provider chain](https://docs.aws.amazon.com/sdkref/latest/guide/standardized-credentials.html) — the same resolution order as the AWS CLI. You don't pass an API key; you authenticate to AWS however you normally would:

- Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`)
- An SSO session (`aws sso login`)
- A named profile (`AWS_PROFILE`, or `profile` in config)
- EC2/ECS/EKS instance roles

A **region** is required, via `region` in config or `AWS_REGION` / `AWS_DEFAULT_REGION`.

#### IAM permissions

The principal needs these `bedrock-agentcore` actions on the code interpreter:

- `bedrock-agentcore:StartCodeInterpreterSession`
- `bedrock-agentcore:InvokeCodeInterpreter`
- `bedrock-agentcore:StopCodeInterpreterSession`
- `bedrock-agentcore:GetCodeInterpreterSession` (for `getById`)
- `bedrock-agentcore:ListCodeInterpreterSessions` (for `list`)

### Usage

```typescript
import { compute } from 'computesdk';
import { agentcore } from '@computesdk/aws/agentcore';

// Uses the default AWS credential chain; region from env or config.
compute.setConfig({ defaultProvider: agentcore({ region: 'us-west-2' }) });

const sandbox = await compute.instances.create();

const result = await sandbox.runCommand('echo "Hello from AgentCore" && python3 -c "print(2 + 2)"');
console.log(result.stdout); // Hello from AgentCore\n4

await sandbox.filesystem.writeFile('/tmp/data.txt', 'persisted across calls');
console.log(await sandbox.filesystem.readFile('/tmp/data.txt'));

await sandbox.destroy();
```

#### Using a named profile

```typescript
agentcore({ region: 'us-west-2', profile: 'my-profile' });
```

#### Using explicit / temporary credentials

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

### Configuration

| Option | Type | Description |
|---|---|---|
| `region` | `string` | AWS region. Falls back to `AWS_REGION` / `AWS_DEFAULT_REGION`. |
| `codeInterpreterIdentifier` | `string` | Code interpreter to use. Defaults to the managed `aws.codeinterpreter.v1`. |
| `profile` | `string` | Named AWS profile to use for credentials. |
| `credentials` | `AwsCredentialIdentity \| AwsCredentialIdentityProvider` | Explicit credentials. Omit to use the default chain. |
| `sessionTimeoutSeconds` | `number` | Session idle timeout in seconds (max 28800 / 8h). Default 900. Overridden by the per-`create` `timeout` (ms). |

### API Reference

#### Command Execution

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

#### Filesystem Operations

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

#### Sandbox Management

```typescript
const info = await sandbox.getInfo();          // { id, provider, status, createdAt, timeout, metadata }
const existing = await provider.sandbox.getById(sandbox.instanceId);  // or null if terminated
const all = await provider.sandbox.list();     // READY sessions
await sandbox.destroy();
```

### Error Handling

`create` translates common AWS failures into actionable messages:

```typescript
try {
  const sandbox = await compute.instances.create();
} catch (err) {
  // e.g. "Missing AWS region for AgentCore. Pass it: agentcore({ region: 'us-west-2' }) ..."
  // or   "AWS authentication failed for AgentCore. Check your credentials ..."
  // or   "Access denied ... Ensure your IAM principal allows bedrock-agentcore:*CodeInterpreter* ..."
  console.error(err.message);
}
```

- `runCommand` returns `exitCode: 127` with the error on `stderr` if the invocation itself fails (e.g. the session expired) — it does not throw.
- Filesystem operations throw on failure (e.g. reading a missing file).

### Examples

#### Data processing

```typescript
const sandbox = await compute.instances.create();

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

#### As an AI agent tool

The universal `InstanceInterface` interface maps cleanly onto agent-framework tools — wrap each
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

### Supported runtimes

The managed `aws.codeinterpreter.v1` interpreter ships with Python and a standard Linux shell, so any language runtime available in that environment can be driven via `runCommand`.

### Limitations

- **No preview URLs / ports.** AgentCore Code Interpreter has no inbound network endpoint, so `getUrl()` throws. Use it for code execution, not for hosting dev servers.
- **No interactive PTY.** Commands are request/response; there is no bidirectional terminal.
- **Sessions expire.** A session auto-terminates after its idle timeout; create a new sandbox afterward.
- **Filesystem persists, shell environment does not.** Files survive across `runCommand` calls, but each command runs in a fresh shell — `cd`, `export`, and shell variables do not carry over. Chain them in a single command (e.g. `cd /app && npm test`) or use the `cwd`/`env` options.
- **Background commands don't outlive the call.** `runCommand(..., { background: true })` returns immediately, but AgentCore terminates the process tree when the invocation ends, so the job is killed rather than left running. Use a single command that runs to completion instead.
- **Large writes are chunked.** To stay under AgentCore's command-size limit, `writeFile` uploads base64 in ~60KB chunks — roughly one round-trip per 60KB, so a 5MB file takes ~40s. Reads are single round-trips and fast.
- **~10 concurrent operations per session.** AgentCore caps concurrent invocations on a single session; beyond ~10 simultaneous `runCommand`/filesystem calls, extra ones fail with a quota error. Spread heavy parallelism across multiple sandboxes.

### License

MIT
