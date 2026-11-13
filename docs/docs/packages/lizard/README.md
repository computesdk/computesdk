# @computesdk/lizard

[Lizard (lizard.build)](https://lizard.build/sandboxes) provider for ComputeSDK.
Create Lizard Sandboxes, run commands, stream output, work with files and get
authenticated HTTPS URLs for ports.

## Install and configure

```bash
npm install @computesdk/lizard
```

Create a project at [lizard.build](https://lizard.build), then create a key scoped
to that project with the [Lizard CLI](https://github.com/lizard-build/lizard-cli):

```bash
lizard keys create computesdk --project <project-id>
export LIZARD_API_KEY="your-key"
export LIZARD_PROJECT_ID="your-project-id"
```

The project ID is required. The provider does not read the CLI's login or linked
project. Keep the API key out of source control.

## Usage

```typescript
import { lizard } from '@computesdk/lizard';

const compute = lizard({ size: 'small' });
const sandbox = await compute.instances.create({ timeout: 300_000 });

try {
  const result = await sandbox.runCommand('python -c "print(2 ** 10)"');
  console.log(result.stdout);
  if (result.exitCode !== 0) throw new Error(result.stderr);

  await sandbox.filesystem.writeFile('/tmp/hello.txt', 'hello');
  const content = await sandbox.filesystem.readFile('/tmp/hello.txt');
  console.log(content);

  await sandbox.runCommand('echo first; sleep 1; echo second', {
    onStdout: chunk => process.stdout.write(chunk),
    onStderr: chunk => process.stderr.write(chunk),
  });
} finally {
  await sandbox.destroy();
}
```

The default `interpreter` template includes Python and Node.js. Override it with
`template` in the provider config or `templateId` in `instances.create()`.
Custom templates must include the tools your commands use.

## Configuration

| Option | Default | Meaning |
| --- | --- | --- |
| `apiKey` | `LIZARD_API_KEY` | API key; prefer a key scoped to the project |
| `projectId` | `LIZARD_PROJECT_ID` | Exact project ID |
| `apiUrl` | `LIZARD_API_URL` or `https://lizard.build` | API endpoint |
| `template` | `interpreter` | Template name or ID |
| `timeout` | `300000` | Sandbox lifetime in milliseconds |
| `size` | Service default (`medium`) | `small`, `medium` or `large` |
| `region` | Service default | Region passed to the Lizard SDK |

Create options can override `templateId`, `timeout` and `size`; they also accept
`envs`, string-valued `metadata` and `snapshotId`.

Sandbox lifetime and command timeout are separate. The sandbox lifetime accepts
`0` (no deadline) or 1000–2147483647 ms. Command `timeout` accepts 1000–600000 ms,
with the SDK's 60-second default when omitted. Commands do not extend the sandbox
lifetime. Always destroy sandboxes when you finish.

## Commands and files

Commands preserve stdout, stderr and the exit code, including failed commands.
`cwd`, `env` and live stdout/stderr callbacks use the native SDK.
Detached commands use `background: true`; their output is discarded, and
streaming callbacks cannot be combined with that option.

Streaming uses the SDK's line protocol and trims trailing whitespace. On a
streaming timeout, the provider stops the known process tree and returns exit
code 124 with the output received so far. A timeout before the PID arrives,
or a failure to stop a running process, raises an exception.

The service caps each output stream at 512 KiB. ComputeSDK's `CommandResult` has
no truncation flag; use `sandbox.getInstance().process.exec()` when you need the
SDK's flag, or write large output to a file.

File operations support text read/write, mkdir, directory listing, existence
checks and removal. Paths refer to the remote sandbox. API failures reach the
caller; they do not become a false "file missing" result. Use the native SDK for
binary files.

## Port URLs

```typescript
const url = await sandbox.getUrl({ port: 3000 });
```

The returned browser URL includes an access token in its query string. The port
proxy sets a cookie on the first request. HTTP clients without a cookie jar must
use the header shown below. Treat the URL as
a credential. Do not put it in logs, public issues or shared screenshots.
The provider supports `https` URLs; it rejects other protocol options.

For a client that supports headers, use the native SDK:

```typescript
const port = await sandbox.getInstance().exposePort(3000);
const response = await fetch(`https://${port.hostname}`, {
  headers: { 'X-Lizard-Access-Token': port.accessToken },
});
```

## Snapshots

`compute.snapshot.create(instanceId, { name })` creates a project-scoped snapshot.
List with `compute.snapshot.list()`, restore with
`compute.instances.create({ snapshotId })`, and delete with
`compute.snapshot.delete(snapshotId)`. Snapshots do not accept custom metadata.

## Scope

The provider implements lifecycle, shell commands, native streaming, text files,
HTTPS port URLs and snapshots. Template build APIs, PTY sessions and the daemond
process bridge are outside this provider's tested scope. Use `getInstance()` for
other Lizard SDK features.

Provider acceptance and participation in
[public benchmarks](https://www.computesdk.com/for-providers) are separate steps.

## Tests

From the ComputeSDK workspace:

```bash
pnpm --filter @computesdk/lizard build
pnpm --filter @computesdk/lizard typecheck
pnpm --filter @computesdk/lizard lint
pnpm --filter @computesdk/lizard test
LIZARD_LIVE_TESTS=1 pnpm --filter @computesdk/lizard test
```

Unit tests exercise this provider with a mocked Lizard SDK. The shared suite uses
its own mock unless `LIZARD_LIVE_TESTS=1`. Live tests create and destroy temporary
sandboxes using the configured project and may incur usage charges.

