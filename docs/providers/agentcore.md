# AWS Bedrock AgentCore

[AWS Bedrock AgentCore Code Interpreter](https://docs.aws.amazon.com/bedrock-agentcore/) provider for ComputeSDK - secure, fully-managed, session-based sandboxes for running code and shell commands, with no infrastructure to provision.

A ComputeSDK sandbox maps onto an AgentCore Code Interpreter session.


## Installation & Setup

```bash
npm install @computesdk/agentcore
```

There is no API key. The provider uses the standard [AWS credential provider chain](https://docs.aws.amazon.com/sdkref/latest/guide/standardized-credentials.html) — the same resolution as the AWS CLI — so environment variables, SSO sessions, named profiles, and instance roles all work, including temporary credentials.

A region is required, via `region` in config or `AWS_REGION` / `AWS_DEFAULT_REGION`.

### IAM permissions

```
bedrock-agentcore:StartCodeInterpreterSession
bedrock-agentcore:InvokeCodeInterpreter
bedrock-agentcore:StopCodeInterpreterSession
bedrock-agentcore:GetCodeInterpreterSession
bedrock-agentcore:ListCodeInterpreterSessions
```


## Usage

```typescript
import { agentcore } from '@computesdk/agentcore';

const compute = agentcore({ region: 'us-west-2' });

// Create sandbox (an AgentCore Code Interpreter session)
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from AgentCore!"');
console.log(result.stdout); // "Hello from AgentCore!"

// Run code via the available runtimes (e.g. Python)
const code = await sandbox.runCommand('python3 -c "print(2 + 2)"');
console.log(code.stdout); // "4"

// Work with files (files persist for the life of the session)
await sandbox.filesystem.writeFile('/tmp/hello.py', 'print("Hello World")');
const content = await sandbox.filesystem.readFile('/tmp/hello.py');

// Clean up
await sandbox.destroy();
```

### Named profile

```typescript
agentcore({ region: 'us-west-2', profile: 'my-profile' });
```

### Explicit / temporary credentials

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

### Configuration Options

```typescript
interface AgentCoreConfig {
  /** AWS region. Falls back to AWS_REGION / AWS_DEFAULT_REGION */
  region?: string;
  /** Code interpreter to use. Defaults to the managed `aws.codeinterpreter.v1` */
  codeInterpreterIdentifier?: string;
  /** Named AWS profile to use for credentials */
  profile?: string;
  /** Explicit credentials. Omit to use the default AWS credential chain */
  credentials?: AwsCredentialIdentity | AwsCredentialIdentityProvider;
  /** Session timeout in seconds (max 28800 / 8h). Default 900. Overridden by per-create `timeout` (ms) */
  sessionTimeoutSeconds?: number;
}
```


## Limitations

- **No preview URLs / ports.** AgentCore Code Interpreter has no inbound network endpoint, so `getUrl()` throws.
- **No interactive PTY.** Commands are request/response.
- **Sessions expire.** A session auto-terminates after its idle timeout; create a new sandbox afterward.
- **Filesystem persists, shell environment does not.** Files survive across `runCommand` calls, but each command runs in a fresh shell — `cd`, `export`, and shell variables do not carry over. Chain them in one command or use the `cwd`/`env` options.
- **Background commands don't outlive the call.** `{ background: true }` returns immediately, but AgentCore terminates the process tree when the invocation ends, so the job is killed rather than left running.
