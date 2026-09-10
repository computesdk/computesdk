# @computesdk/buddy

Buddy provider for ComputeSDK.

Each sandbox is a Buddy sandbox — an Ubuntu microVM in your Buddy project, served from a pre-warmed pool. Commands stream their output as they run, ports are published through Buddy tunnels, and snapshots double as reusable base images.

Built on [`@buddy-works/sandbox-sdk`](https://www.npmjs.com/package/@buddy-works/sandbox-sdk), Buddy's official TypeScript SDK.

## Installation

```bash
npm install @computesdk/buddy
```

Node 20.19 or 22.12 and newer is required, matching the Buddy SDK (ESM and CommonJS builds are both shipped).

## Setup

1. Create an API token in **Buddy → My ID → Access tokens** with the `SANDBOX_MANAGE` scope
2. Create (or pick) a Buddy project for your sandboxes
3. Set environment variables:

```bash
export BUDDY_TOKEN=your_api_token_here
export BUDDY_WORKSPACE=your_workspace_domain
export BUDDY_PROJECT=your_project_name
```

## Quick Start

```ts
import { buddy } from '@computesdk/buddy';

const compute = buddy();

const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand('echo "hello from buddy"');
console.log(result.stdout);

await sandbox.destroy();
```

Credentials are read from the environment, so `buddy()` needs no arguments. Pass them explicitly to override:

```ts
const compute = buddy({
  token: process.env.BUDDY_TOKEN!,
  workspace: 'acme',
  project: 'sandboxes',
});
```

## Configuration

```ts
interface BuddyConfig {
  /** API token with the `SANDBOX_MANAGE` scope. Falls back to `BUDDY_TOKEN`. */
  token?: string;
  /** Workspace domain. Falls back to `BUDDY_WORKSPACE`. */
  workspace?: string;
  /** Project the sandboxes belong to. Falls back to `BUDDY_PROJECT`. */
  project?: string;
  /** Base OS image — `'ubuntu:24.04'` (default) or `'ubuntu:22.04'`. */
  os?: string;
  /** Resource preset, `"{vCPU}x{RAM GB}"` from `1x2` to `12x24`. Buddy's own default applies when omitted. */
  resources?: BuddyResources;
  /** Buddy installation — `'US'` (default) or `'EU'`. */
  region?: BuddyRegion;
  /** Sandbox lifetime in milliseconds, after which Buddy stops it. Defaults to 1 hour. */
  timeout?: number;
  /** Ports to expose on every sandbox this provider creates. */
  ports?: BuddyPortInput[];
  /** API base URL. Overrides `region`, for on-premise installations. */
  apiUrl?: string;
}
```

### Choosing an installation

Buddy runs independent installations rather than regions within one API, each with
its own host, accounts and tokens. `region` selects both the API host and where
tunnels terminate:

```ts
const compute = buddy({ region: 'EU' });
```

| `region`     | API host                       |
| ------------ | ------------------------------ |
| `US` (default) | `https://api.buddy.works`     |
| `EU`         | `https://api.eu.buddy.works`   |

A token issued by one installation is not valid on the others. For an on-premise
installation, set `apiUrl` instead.

## Create options

Beyond the cross-provider options, `create` accepts:

```ts
await compute.sandbox.create({
  // Expose ports up front, so getUrl needs no extra round trip
  ports: [3000, { port: 443, type: 'TLS', region: 'EU' }],
  // Resources — either a preset, or cpu/memory that map onto one
  resources: '4x8',
  // Commands run once when the sandbox first boots
  firstBootCommands: 'npm ci',
  // Working directory for the sandbox's apps
  appDir: '/buddy/app',
  tags: ['ci'],
});
```

`snapshotId` (or `templateId`) starts the sandbox from a snapshot instead of a base image.

## Exposing ports

```ts
const sandbox = await compute.sandbox.create({ ports: [3000] });
await sandbox.runCommand('npx serve -l 3000', { background: true });

const url = await sandbox.getUrl({ port: 3000 });
```

`getUrl` opens a tunnel on demand if the port was not declared at create time,
keeping any tunnels already open. Only `HTTP` and `TLS` tunnels get a public URL;
`TCP` and `SSH` tunnels are reached by host and port, reported in `getInfo`.

## Filesystem

```ts
await sandbox.filesystem.mkdir('/buddy/app');
await sandbox.filesystem.writeFile('/buddy/app/index.js', 'console.log(1)');
await sandbox.filesystem.readFile('/buddy/app/index.js');
await sandbox.filesystem.readdir('/buddy/app');
await sandbox.filesystem.exists('/buddy/app/index.js');
await sandbox.filesystem.remove('/buddy/app');
```

Relative paths resolve against `/buddy`, the home directory of the default `buddy` user.

The first filesystem call on a sandbox waits for its first-boot setup to finish. Buddy
queues *commands* against a starting sandbox, but the content endpoints do not: during
setup they either refuse the request or accept a write and discard it once setup
completes. The wait costs a few hundred milliseconds on a freshly created sandbox and
nothing afterwards.

## Snapshots

A snapshot is a disk image taken from a live sandbox, and doubles as the reusable base
image other providers call a template.

```ts
const snapshot = await compute.snapshot.create(sandbox.sandboxId, { name: 'with-deps' });

await compute.snapshot.list();                                 // the whole project
await compute.snapshot.list({ sandboxId: sandbox.sandboxId });  // one sandbox
await compute.snapshot.delete(snapshot.id);

// Booting from it is a normal create
const prepared = await compute.sandbox.create({ snapshotId: snapshot.id });
```

Buddy creates snapshots asynchronously and they cannot be restored until they turn
`CREATED`, so `create` waits for that before returning. `metadata` is accepted for
cross-provider compatibility but not stored: Buddy keeps only a name.

Buddy has no separate template entity, so `template.list` and `template.delete` alias
the snapshot methods and `template.create` throws, pointing at `snapshot.create`.

## Dropping down to the Buddy SDK

`getInstance()` returns the handle the provider works with, including the live SDK
client and filesystem, so Buddy features outside the ComputeSDK surface stay reachable
without building a second client:

```ts
const { client, fs, sandboxId } = sandbox.getInstance();
await client.getSandboxAppLogs({ path: { sandbox_id: sandboxId, app_id: 'web' } });
```

The handle's `fs` and `client` call the API directly, without the provider's first-boot wait: on a sandbox that has just been created, make one `sandbox.filesystem` call (even `exists`) before uploading through them.

## Supported Operations

| Method       | Supported | Notes                                                                                        |
| ------------ | --------- | -------------------------------------------------------------------------------------------- |
| `create`     | ✅        | One request; returns while the sandbox is still starting, since commands queue against it.     |
| `getById`    | ✅        | Returns `null` when the sandbox no longer exists.                                             |
| `list`       | ✅        | Lists the sandboxes in the configured project.                                                |
| `destroy`    | ✅        | Retries on server errors; a no-op if the sandbox is already gone.                             |
| `runCommand` | ✅        | Streams stdout/stderr separately as the command runs, with real exit codes.                   |
| `getInfo`    | ✅        | Reports Buddy's own status and setup status, plus every tunnel, in `metadata`.                 |
| `getUrl`     | ✅        | Opens a tunnel if the port has none yet, keeping the existing ones.                           |
| `filesystem` | ✅        | Uses Buddy's native content endpoints, not the shell — no quoting or size limits of a command line, one round trip each. |
| `snapshot`   | ✅        | `create` / `list` / `delete`; `create` waits until the snapshot is restorable.                 |
| `template`   | ⚠️        | No template entity in Buddy — `list`/`delete` alias snapshots, `create` throws with a hint.    |

## Notes

- `create` does not wait for the sandbox to reach `RUNNING`. Buddy queues commands submitted against a starting sandbox, so waiting would only add latency to the first command. For the same reason the provider calls the SDK's `BuddyApiClient` directly instead of `Sandbox.create()`, which polls for readiness once a second.
- `runCommand(cmd, { background: true })` returns as soon as Buddy has queued the command, without reading its output.
- `runCommand(cmd, { timeout })` terminates the command when the timeout passes.
- Sandbox placement inside an installation is not selectable; `region` picks the installation and the tunnel location.

## License

MIT
