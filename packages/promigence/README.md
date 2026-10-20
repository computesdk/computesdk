# @computesdk/promigence

Promigence provider for ComputeSDK - production-grade sandboxes for AI agents, with filesystem and streaming output.

[Promigence](https://www.promigence.ai) runs AI agents and their code in sandboxes, each forked from a snapshot and run under a spend cap. A snapshot you build with a test command is stored only once that test passes. With this package, code written against `computesdk` runs on Promigence sandboxes.

## Installation

```bash
npm install @computesdk/promigence
```

It needs Node.js 20 or later.

## Setup

Sign up with the Promigence CLI. It stores an API key on this machine, and the provider uses that key whenever none is passed or set:

```bash
npm install -g promigence
promigence signup    # or `promigence login` for an account you already have
```

On a server or in CI, set the key in the environment instead:

```bash
export PROMIGENCE_API_KEY=prom_api_...
```

| Environment variable | Meaning |
|---|---|
| `PROMIGENCE_API_KEY` | Your API key, when `apiKey` is not passed |
| `PROMIGENCE_SPEND_CAP` | Optional: the most one sandbox may spend, in US dollars, when `spendCap` is not passed. Unset, your organization's default cap applies |
| `PROMIGENCE_API_URL` | Optional: the API to use, when `apiUrl` is not passed |

## Quick Start

```typescript
import { compute } from 'computesdk';
import { promigence } from '@computesdk/promigence';

compute.setConfig({
  provider: promigence({ apiKey: process.env.PROMIGENCE_API_KEY }),
});

const sandbox = await compute.instances.create();

const result = await sandbox.runCommand(`python3 - <<'PY'
print("Hello from Promigence")
PY`);
console.log(result.stdout);

await sandbox.filesystem.writeFile('/tmp/hello.txt', 'hello');
console.log(await sandbox.filesystem.readFile('/tmp/hello.txt'));

await sandbox.destroy();
```

You can also call the provider directly:

```typescript
import { promigence } from '@computesdk/promigence';

const provider = promigence({}); // PROMIGENCE_API_KEY, or the key the CLI stored
const sandbox = await provider.instances.create({ templateId: 'my-app' }); // a snapshot you built, by its alias
```

## Configuration

### Configuration Options

```typescript
interface PromigenceConfig {
  /** Promigence API key - if not provided, uses PROMIGENCE_API_KEY, then the key `promigence login` stored */
  apiKey?: string;
  /** Promigence API URL - if not provided, uses PROMIGENCE_API_URL, then the default Promigence API */
  apiUrl?: string;
  /** The most one sandbox may spend, in US dollars - if not provided, uses PROMIGENCE_SPEND_CAP, then your organization's default cap */
  spendCap?: number;
  /** The snapshot create() starts from when it names none (id, alias or alias@commit); default: the built-in base snapshot */
  snapshot?: string;
  /** Sandbox lifetime in milliseconds when create() sets none; also the bound on a command that sets none */
  timeout?: number;
  /** Size of a sandbox created from an image: 'xsmall', 'small', 'medium', 'large', 'xlarge' or '2xlarge' */
  tier?: string;
  /** 'start' (the default) or 'compute' (long, memory-heavy jobs on the larger tiers) */
  optimizeFor?: 'start' | 'compute';
  /** A client from @promigence/sdk to use instead of one built from apiKey and apiUrl */
  client?: PromigenceClient;
}
```

The provider checks this config before it sends anything. A missing key, or a malformed URL, spend cap or timeout, is an error that says what to fix.

### `create()` options

| Option | What it does |
|---|---|
| `templateId` / `snapshotId` | The snapshot to start from: its id, its alias, `alias@commit`, or the name of a Promigence template (`promigence templates` lists them) |
| `image` | A container image instead of a snapshot: a tag such as `python:3.12`, or `name@sha256:...`. The first `create()` from an image builds its snapshot, billed per second while it builds; later ones reuse it. Not together with `templateId` / `snapshotId` |
| `tier`, `registrySecret` | With `image`: the sandbox size, and the name of a stored secret that holds the registry credentials |
| `timeout` | Sandbox lifetime in milliseconds |
| `envs` | Environment variables for every command run through this sandbox |
| `metadata` | Labels on the sandbox (values that are not strings are stored as JSON) |
| `allowInternetAccess: false` | No network access |
| `allowHosts: [...]` | Only these destinations can be reached |
| `spendCap`, `optimizeFor` | Override the provider config for this sandbox |
| `runtime`, `name`, CPU and memory fields | Ignored: a sandbox has its snapshot's size |

## Features

Commands take `cwd`, `env`, `timeout` and `background`, and one that exits non-zero comes back as a normal result with its `exitCode`. Pass `onStdout` or `onStderr` and the output arrives while the command runs. A command that outruns its `timeout` is stopped and reported with exit code 124.

The filesystem API reads, writes, lists and removes files, creates directories and checks whether a path exists. Sandboxes are managed with `create`, `getById`, `list` (every sandbox that has not ended) and `destroy`; snapshots with `snapshot.list()` and `snapshot.delete(id)`. Every sandbox runs under a spend cap: yours, `PROMIGENCE_SPEND_CAP`, or your organization's default.

### Supported runtimes

The built-in base snapshot comes with Python, Node.js and Go, plus git and common build tools. Any container image works through `image`. So does any snapshot you build with the Promigence CLI, through `templateId`.

### The Promigence SDK underneath

`sandbox.getInstance()` returns `{ sandbox, client, config }`: the `Sandbox` from [`@promigence/sdk`](https://www.npmjs.com/package/@promigence/sdk), the client it uses and the provider config. Reach for it when you need something the SDK offers beyond the ComputeSDK interface; the [TypeScript SDK docs](https://www.promigence.ai/docs/sdk) describe it.

## Error Handling

A Promigence error is re-thrown with the operation named. It keeps the SDK's `code` and `fix` (what to do next) and the original error as `cause`; every code is listed at [promigence.ai/docs/errors](https://www.promigence.ai/docs/errors).

```typescript
try {
  await promigence({}).instances.create();
} catch (error) {
  const { code, fix } = error as { code?: string; fix?: string };
  console.error(code, fix); // for example: auth, and how to pass a key
}
```

While `fallbackOnError` is on (the default), `compute.instances.create()` combines the failures of every configured provider into one error. Pass `fallbackOnError: false` to `compute.setConfig()` to receive the Promigence error itself.

## Limitations

- There are no preview URLs yet, so `getUrl()` throws. To reach a server in the sandbox, call it from a command in the same sandbox, for example with `curl`.
- `snapshot.create()` throws: Promigence does not take a snapshot of a running sandbox. Build snapshots with the Promigence CLI (`promigence snapshot create --image <image>`), or pass `image` to `create()`.
- Templates are snapshots here. The `template` methods throw, and `templateId` on `create()` names a snapshot.
- `runCommand(cmd, { background: true })` answers at once with exit code 0 and does not collect the command's output.
- CPU and memory fields on `create()` are ignored. A sandbox has its snapshot's size, and `tier` picks one for a sandbox created from `image`.
- Environment variables passed to `create()` apply to commands run through the sandbox it returned. A handle from `getById()` or `list()` does not have them, so pass `env` with each command there.

## Support

Read the [Promigence documentation](https://www.promigence.ai/docs) and the [error codes](https://www.promigence.ai/docs/errors), or write to support@promigence.ai. Problems with ComputeSDK itself go to [ComputeSDK Issues](https://github.com/computesdk/computesdk/issues).

## License

MIT
