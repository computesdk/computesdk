# @computesdk/runtools

[RunTools](https://runtools.ai) provider for [ComputeSDK](https://computesdk.com).
Run isolated Firecracker sandboxes through the same public RunTools API used by
the dashboard, CLI, and RunTools SDK.

## Install

```bash
npm install @computesdk/runtools
```

## Usage

```typescript
import { runtools } from '@computesdk/runtools'

const compute = runtools({
  apiKey: process.env.RUNTOOLS_API_KEY,
})

const sandbox = await compute.sandbox.create()
const result = await sandbox.runCommand('node -v')
console.log(result.stdout)

await sandbox.filesystem.writeFile('/tmp/hello.txt', 'hello from RunTools')
console.log(await sandbox.filesystem.readFile('/tmp/hello.txt'))

await sandbox.destroy()
```

## Configuration

| Option | Environment variable | Default | Description |
| --- | --- | --- | --- |
| `apiKey` | `RUNTOOLS_API_KEY` | required | RunTools organization API key |
| `apiUrl` | `RUNTOOLS_API_URL` | `https://api.runtools.ai` | API origin |
| `template` | — | `base-ubuntu` | Default sandbox template |
| `timeout` | — | `300000` ms | ComputeSDK timeout and sandbox idle lease |

Get an API key from the RunTools dashboard. The provider only uses public SDK
surfaces and does not require host or Firecracker credentials.

## Create options

The provider accepts standard ComputeSDK fields including `name`, `envs`,
`timeout`, `templateId`, `vcpus`, `memoryMb`, and `diskMiB`. RunTools-native
fields `template`, `tags`, `sshKeys`, `rootPassword`, `idleTimeout`, and
`resources` are also available.

`runtime: 'node'` and `runtime: 'python'` both select `base-ubuntu`, which ships
the standard development runtimes. Set `template: 'desktop-ubuntu'` only when a
desktop sandbox is actually needed.

## Beyond the ComputeSDK interface

`getInstance()` returns the native `Sandbox` from `@runtools-ai/sdk`, exposing
RunTools-specific pause, resume, metrics, VNC, SSH, and activity APIs.
