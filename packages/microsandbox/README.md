# @computesdk/microsandbox

Microsandbox provider for ComputeSDK. It runs the same sandbox API against hardware-isolated local microVMs or microsandbox cloud.

## Requirements

- Node.js 22 or newer
- Local backend: macOS on Apple Silicon, Linux with KVM, or Windows with Windows Hypervisor Platform
- Cloud backend: microsandbox cloud access and an API key

## Installation

```bash
npm install computesdk @computesdk/microsandbox
```

## Local quick start

The local backend is the default and does not require an account or API key:

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
const result = await sandbox.runCommand('node --version');
console.log(result.stdout);
await sandbox.destroy();
```

## Cloud quick start

Cloud uses the same sandbox, command, and filesystem methods. Select it explicitly and supply an API key:

```typescript
import { compute } from 'computesdk';
import { microsandbox } from '@computesdk/microsandbox';

compute.setConfig({
  provider: microsandbox({
    backend: {
      kind: 'cloud',
      apiKey: process.env.MSB_API_KEY!,
    },
    image: 'node:22',
  }),
});

const sandbox = await compute.sandbox.create();
await sandbox.filesystem.writeFile('/tmp/hello.js', 'console.log("hello")');
console.log((await sandbox.runCommand('node /tmp/hello.js')).stdout);
await sandbox.destroy();
```

Omit `backend` to use microsandbox's standard `MSB_BACKEND`, `MSB_PROFILE`, and active-profile resolution. The SDK defaults to local when none of those selects cloud.

## Configuration

```typescript
interface MicrosandboxConfig {
  backend?: 'local' | { kind: 'cloud'; apiKey: string; url?: string } | { kind: 'cloud'; profile: string };
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
