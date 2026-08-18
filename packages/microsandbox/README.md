# @computesdk/microsandbox

Microsandbox provider for ComputeSDK. It runs the same sandbox API against hardware-isolated local microVMs or microsandbox cloud.

## Requirements

- Node.js 22 or newer
- Cloud backend: microsandbox cloud access and an API key
- Local backend: macOS on Apple Silicon, Linux with KVM, or Windows with Windows Hypervisor Platform

## Installation

```bash
npm install computesdk @computesdk/microsandbox
```

## Cloud quick start

Cloud is the default backend. Pass an API key directly or omit it to use the microsandbox SDK's `MSB_API_KEY`, `MSB_PROFILE`, or active-profile resolution:

```typescript
import { compute } from 'computesdk';
import { microsandbox } from '@computesdk/microsandbox';

compute.setConfig({
  provider: microsandbox({
    apiKey: process.env.MSB_API_KEY,
    image: 'node:22',
  }),
});

const sandbox = await compute.sandbox.create();
const result = await sandbox.runCommand('node --version');
console.log(result.stdout);
await sandbox.destroy();
```

## Local quick start

Select the local backend explicitly when the sandbox should run on the calling machine. Local mode does not require an account or API key:

```typescript
import { compute } from 'computesdk';
import { microsandbox } from '@computesdk/microsandbox';

compute.setConfig({
  provider: microsandbox({
    backend: 'local',
    image: 'node:22',
    ports: [{ host: 3000, guest: 3000 }],
  }),
});

const sandbox = await compute.sandbox.create();
await sandbox.filesystem.writeFile('/tmp/hello.js', 'console.log("hello")');
console.log((await sandbox.runCommand('node /tmp/hello.js')).stdout);
await sandbox.destroy();
```

Calling `microsandbox()` with no configuration uses cloud through the microsandbox SDK's standard environment and active-profile resolution. If no cloud credentials resolve, the provider reports how to configure cloud or opt into `backend: 'local'`; it never silently falls back to local.

Use a named cloud profile instead of an API key when appropriate:

```typescript
const provider = microsandbox({ profile: 'production' });
```

## Configuration

```typescript
interface MicrosandboxConfig {
  backend?: 'cloud' | 'local'; // Defaults to cloud
  apiKey?: string;             // Falls back to MSB_API_KEY
  apiUrl?: string;             // Optional endpoint override; requires apiKey
  profile?: string;            // Named cloud profile; mutually exclusive with apiKey/apiUrl
  image?: string;
  cpus?: number;
  memoryMib?: number;
  rootDiskMib?: number;
  workdir?: string;
  namePrefix?: string;
  ports?: Array<number | { host: number; guest: number; bind?: string }>;
  timeout?: number;
  pullPolicy?: 'always' | 'if-missing' | 'never';
  networkEnabled?: boolean;
}
```

Per-sandbox `image`, `templateId`, `snapshotId`, `cpus`, `vcpus`, `memory`, `memoryMb`, `memoryMiB`, `memMiB`, `timeout`, `name`, `envs`, `metadata`, and `ports` options override or extend provider defaults where applicable.

## Backend support

| Method | Local | Cloud |
|---|---|---|
| `create`, `getById`, `list`, `destroy` | Yes | Yes |
| `runCommand` and live output callbacks | Yes | Yes |
| `filesystem` | Yes | Yes |
| `getInfo` | Yes | Yes |
| `getUrl` | Yes, for ports declared before create | Not currently available |
| `snapshot` | Yes, disk state | Not currently available |

Local snapshots stop the sandbox, capture its writable root disk, and restart it. Files on that disk survive the restore, but tmpfs paths such as `/tmp` and running processes are not captured. Microsandbox cloud does not currently support published ports or disk snapshots, so those methods return explicit unsupported errors on cloud.

## License

MIT
