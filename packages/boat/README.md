# @computesdk/boat

Boat provider for ComputeSDK: Ubuntu cloud sandboxes with streaming commands, signed file transfers, named snapshots and templates, and HTTPS preview URLs.

## Installation

```bash
npm install computesdk @computesdk/provider @computesdk/boat
```

## Setup

Create an API key in the [Boat dashboard](https://boat.dev/dashboard?tab=api-keys) and export it:

```bash
export BOAT_API_KEY=boat_...
# Optional: custom API endpoint (defaults to https://boat.dev/api/v1)
export BOAT_API_BASE=https://boat.dev/api/v1
```

## Usage

```typescript
import { createCompute } from '@computesdk/provider';
import { boat } from '@computesdk/boat';

const compute = createCompute({ provider: boat({}) });
const sandbox = await compute.instances.create({ type: 'small' });

try {
  const result = await sandbox.runCommand('echo "Hello from Boat"');
  console.log(result.stdout);
  await sandbox.filesystem.writeFile('/tmp/hello.txt', 'Hello from Boat');
  console.log(await sandbox.filesystem.readFile('/tmp/hello.txt'));
} finally {
  await sandbox.destroy();
}
```

## Configuration

| Option | Meaning |
| --- | --- |
| `apiKey` | API key; falls back to `BOAT_API_KEY` |
| `baseURL` | API URL; falls back to `BOAT_API_BASE`, then `https://boat.dev/api/v1` |
| `timeout` | Default sandbox lifetime in milliseconds; omitted uses Boat's one-hour default |
| `readyTimeout` | Provisioning wait deadline in milliseconds; defaults to 300000 |
| `snapshotTimeout` | Named snapshot save deadline in milliseconds; defaults to 600000 |
| `preview` | Default preview settings: `public`, `localhost`, and `title` |
| `createOptions` | Native Boat creation defaults, such as `type`, `environment`, `noEnv`, `from`, `org`, and `ttlSeconds` |

## Features

- Sandbox create, get, list, and permanent destroy
- Foreground commands with reconnecting output streams, optional timeouts, and remote cleanup; background commands
- Interactive processes through the shared daemon API
- Filesystem access, with signed binary transfers under `/home/user` and `/tmp` (`readBoatFile`, `writeBoatFile`)
- Named snapshots and templates through `provider.snapshot` and `provider.template`
- Token-protected HTTPS preview URLs, with typed controls through `getBoatUrl`

## Limitations

- Fixed machine types: CPU, memory, disk, GPU, image, region, and arbitrary metadata options are rejected
- Preview URLs are HTTPS only
- Snapshots keep disk changes, not process memory; `/tmp` is excluded
- Setup scripts run in the background, so readiness does not mean setup has finished

See the [Boat provider guide](https://github.com/computesdk/computesdk/blob/main/docs/providers/boat.md) for details and examples.

## Development

For local live tests, put `BOAT_API_KEY=boat_...` in the repository root `.env` file, which Git ignores. Tests use the live Boat API whenever `BOAT_API_KEY` is present.

```bash
# Unit tests and real-SDK/local-HTTP transport tests; no cloud resources.
pnpm --filter @computesdk/boat test:unit

# Shared conformance, shared CRUD, and Boat-specific integration tests.
# BOAT_API_KEY in the environment or root .env enables live calls.
pnpm --filter @computesdk/boat test:integration

# All tests (also live when credentials are available).
pnpm --filter @computesdk/boat test
pnpm --filter @computesdk/boat typecheck
pnpm --filter @computesdk/boat lint
```

`index.test.ts` uses `runProviderTestSuite` and `crud.test.ts` uses `runProviderCrudTest`. The shared contract checks commands, filesystem, streaming, and interactive processes; its baseline tests use shared mocks without credentials. CRUD and Boat-specific integration tests skip without credentials. No separate live opt-in flag is required.

`unit.test.ts` uses SDK mocks; `transport.test.ts` uses the real Boat SDK against a local HTTP server. The separate `integration.test.ts` covers signed large-text/binary transfers, protected/public localhost preview routing, and named snapshot restore. Test files run sequentially to avoid concurrent account-quota pressure. The shared conformance entry point also spaces sandbox starts to stay below Boat's standard 12-starts-per-minute limit; accounts with lower limits may need slower pacing.

Credentialed runs create multiple small billable sandboxes. Shared suite hooks clean up their instances; the Boat-specific test attempts cleanup of both sandboxes and its named snapshot in a finally block. To run every suite without cloud access even when root .env contains a key, use `BOAT_API_KEY= pnpm --filter @computesdk/boat test`.

## License

MIT
