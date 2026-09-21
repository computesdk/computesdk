# @computesdk/novita

Novita Sandbox provider for ComputeSDK, using the official `novita-sandbox` SDK.
Requires Node.js 20 or newer.

## Setup

```bash
npm install computesdk @computesdk/novita
export NOVITA_API_KEY=your_api_key
```

`NOVITA_API_KEY` is the only environment variable configured by this provider.
The Novita SDK supplies the default connection settings.

```typescript
import { novita } from '@computesdk/novita';

const sdk = novita({}); // Reads NOVITA_API_KEY
const sandbox = await sdk.sandbox.create({ timeout: 300_000 });

try {
  await sandbox.filesystem.writeFile('/tmp/hello.py', 'print("Hello from Novita")');
  const result = await sandbox.runCommand('python /tmp/hello.py');
  console.log(result.stdout);
} finally {
  await sandbox.destroy();
}
```

The provider also works with the shared ComputeSDK API:

```typescript
import { compute } from 'computesdk';
import { novita } from '@computesdk/novita';

compute.setConfig({ provider: novita({}) });
const sandbox = await compute.sandbox.create();
await sandbox.destroy();
```

## Configuration

| Option | Meaning |
| --- | --- |
| `apiKey` | Optional explicit key; otherwise reads `NOVITA_API_KEY`. |
| `timeout` | Default sandbox lifetime in milliseconds; defaults to `300000`. |

`sandbox.create({ timeout })` overrides the provider timeout. Use `templateId`
to select a template or `snapshotId` to restore a snapshot; omit both to use
`base`. These two IDs are mutually exclusive. Creation also accepts `envs`,
`metadata`, and the native `secure`, `allowInternetAccess`, `network`, and
`lifecycle` options. Framework options such as `signal` are not forwarded to
the Novita SDK.

## Commands and files

`runCommand` supports `cwd`, `env`, `timeout`, and native streaming callbacks:

```typescript
const result = await sandbox.runCommand('python -u /tmp/hello.py', {
  cwd: '/tmp',
  env: { MODE: 'test' },
  timeout: 60_000,
  onStdout: chunk => process.stdout.write(chunk),
  onStderr: chunk => process.stderr.write(chunk),
});
```

Command timeouts are separate from sandbox lifetime. A nonzero command exit
returns its output and exit code. Authentication, network, and timeout errors
reject the call.

`background: true` starts a native background process and returns an acknowledgement
with exit code `0` and empty output. This does not report the process's eventual
exit status. For process handles, PID tracking, or waiting on background output,
use `sandbox.getInstance().commands.run(command, { background: true })`.
Background mode cannot be combined with streaming callbacks through ComputeSDK.

The filesystem supports `readFile`, `writeFile`, `mkdir`, `readdir`, `exists`,
and `remove`. The common read/write interface handles text; binary operations
are available through `sandbox.getInstance().files`.

## Lifecycle and URLs

- `sdk.sandbox.getById(id)` connects to a sandbox; only a not-found response
  becomes `null`. Connecting to a paused sandbox can resume it.
- `sdk.sandbox.list()` fetches all pages of running sandboxes and connects to
  each so returned objects can execute commands. Connections may extend sandbox
  lifetime according to Novita's connect behavior. Paused sandboxes are excluded.
- `sandbox.getInfo()` reads current SDK information. Paused maps to `stopped`;
  the native state is retained in metadata. `timeout` is the interval between
  the API's `startedAt` and `endAt` timestamps.
- `sandbox.destroy()` kills by ID and succeeds if the sandbox is already gone.
- `sandbox.getUrl({ port: 3000 })` returns an HTTPS service URL. Bind your server
  to `0.0.0.0`. Novita service access may require a traffic token; the URL itself
  does not make a service public. Native token information is available through
  `sandbox.getInstance()`.

Native pause/resume, timeout extension, PTY, and other SDK features remain
available through `sandbox.getInstance()` or a separate `Novita` client.

## Snapshots

```typescript
const snapshot = await sdk.snapshot!.create(sandbox.sandboxId);
const restored = await sdk.sandbox.create({ snapshotId: snapshot.id });
try {
  console.log(await restored.runCommand('ls /tmp'));
} finally {
  await restored.destroy();
}
await sdk.snapshot!.delete(snapshot.id);
```

Snapshot creation pauses the source sandbox. `snapshot.list({ sandboxId, limit })`
supports filtering by source and a total result limit, fetching additional pages
as needed. Snapshots return `id`, `snapshotId`, and `provider`; the SDK does not
provide creation timestamps. Snapshot names and metadata are not supported.

## Templates

`template.create`, `template.list`, and `template.delete` wrap Novita's template
build API. Creation waits for the build to finish and returns `id`, `templateId`,
`buildId`, `provider`, and the native build name/tags. Use the returned `id` as
the `templateId` when creating sandboxes.

```typescript
const template = await sdk.template.create({
  name: 'my-python-template',
  image: 'python:3.12',
  build: {
    cpuCount: 2,
    memoryMB: 1024,
    tags: ['dev'],
    onBuildLogs: entry => console.log(entry),
  },
});

const sandbox = await sdk.sandbox.create({ templateId: template.id });
try {
  console.log(await sandbox.runCommand('python --version'));
} finally {
  await sandbox.destroy();
}

const templates = await sdk.template.list({ limit: 50 });
console.log(templates.map(item => item.id));
await sdk.template.delete(template.id);
```

With only `{ name }`, creation uses Novita's base image. For packages, file
copies, private registry credentials, startup commands, or readiness checks,
pass a native builder as `template` instead of `image`:

```typescript
import { Novita } from 'novita-sandbox';

const definition = new Novita().template.new()
  .fromPythonImage('3.12')
  .pipInstall('numpy');

const template = await sdk.template.create({
  name: 'python-with-numpy',
  template: definition,
  build: { skipCache: true },
});
```

`image` and `template` are mutually exclusive. `build` supports `cpuCount`,
`memoryMB`, `tags`, `skipCache`, and `onBuildLogs`. The native build API does not
accept the common `description` or `metadata` fields, so the adapter rejects
them. Set startup/readiness on a native builder when needed.

Listing returns build templates (not snapshots), fetches all pages by default,
and treats `limit` as a total result limit. It preserves the native template
fields, including timestamps and resource sizes. A limit of `0` returns an empty
array. Deletion succeeds if the template is already absent; other API errors
propagate. Template deletion is permanent.

## Workbench and testing

With `NOVITA_API_KEY` set, select `novita` in Workbench.

```bash
pnpm --filter @computesdk/novita test
pnpm --filter @computesdk/novita typecheck
```

The tests include the same shared provider contract suite used by E2B, the shared
CRUD suite, and 22 adapter-specific unit tests:

| Suite | Default (even with an API key) | With `NOVITA_RUN_INTEGRATION=1` and `NOVITA_API_KEY` |
| --- | --- | --- |
| Shared provider contract (16 tests) | Runs the common mock sandbox | Runs against real Novita sandboxes |
| Shared CRUD (5 tests) | Skipped | Creates, connects, lists, destroys, and checks the sandbox after deletion |
| Adapter unit tests (22 tests) | Mocks the Novita SDK | Still mocks the Novita SDK |

The shared contract covers shell and background commands, invalid commands,
sandbox info, URLs on ports 3000/8080 (including a custom protocol), all six
filesystem operations plus missing-file errors, and shell argument quoting.
The adapter-specific suite additionally covers native streaming, parameter and
error mapping, pagination, snapshots, and template builds/listing/deletion.

The shared tests load the repository root `.env`. Real cloud calls require both
`NOVITA_RUN_INTEGRATION=1` and `NOVITA_API_KEY`. A key alone keeps `test` (including
the root `pnpm test`) in mock mode and skips live CRUD. The opt-in flag is only a
test switch, not a provider configuration option. Set it on the command below
when running live tests. The shared suites clean up their sandboxes after testing.
The mock fallback does not verify
Novita connectivity. Live tests cover sandboxes; template and snapshot operations
currently have mock coverage only.

To run only the 22 adapter unit tests without using cloud resources:

```bash
pnpm --filter @computesdk/novita test:unit
```

To run the shared provider and CRUD suites against Novita, set `NOVITA_API_KEY`
in your environment or root `.env`, then run:

```bash
pnpm --filter @computesdk/test-utils build
NOVITA_RUN_INTEGRATION=1 pnpm --filter @computesdk/novita test:integration
```

Rebuild `@computesdk/test-utils` after updating this checkout so the Novita CRUD
registration is available. Without the key or the opt-in flag, the integration
suite runs the shared contract in mock mode and skips live CRUD.
