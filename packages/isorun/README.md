# @computesdk/isorun

[Isorun](https://isorun.ai) provider for [ComputeSDK](https://computesdk.com). Isolated Linux VM sandboxes for running untrusted and AI-generated code, billed by the second.

## Install

```bash
npm install @computesdk/isorun
```

## Usage

```typescript
import { isorun } from '@computesdk/isorun'

const compute = isorun({
  apiKey: process.env.ISORUN_API_KEY,
})

const sandbox = await compute.sandbox.create({ runtime: 'node' })

const result = await sandbox.runCommand('node -v')
console.log(result.stdout) // v22.x.x

await sandbox.filesystem.writeFile('/tmp/hello.txt', 'world')
const content = await sandbox.filesystem.readFile('/tmp/hello.txt')

await sandbox.destroy()
```

## Configuration

| Option | Env var | Default | Description |
|---|---|---|---|
| `apiKey` | `ISORUN_API_KEY` | required | API key from [app.isorun.ai](https://app.isorun.ai) |

## Sandbox API

```typescript
// Execute commands
const cmd = await sandbox.runCommand('echo hello', { env: { FOO: 'bar' }, cwd: '/tmp' })

// Filesystem (native API, not shell hacks)
await sandbox.filesystem.writeFile('/app/data.json', JSON.stringify({ key: 'value' }))
const data = await sandbox.filesystem.readFile('/app/data.json')
const entries = await sandbox.filesystem.readdir('/app')
const exists = await sandbox.filesystem.exists('/app/data.json')
await sandbox.filesystem.mkdir('/app/output')
await sandbox.filesystem.remove('/app/output')

// Lifecycle
const info = await sandbox.getInfo()
const all = await compute.sandbox.list()
await sandbox.destroy()
```

## Beyond the standard interface

The `isorun` SDK exposes a few capabilities that don't have slots in the standard ComputeSDK interface — fork (`sandbox.fork(n)`), hibernate/resume (`sandbox.hibernate()` / `sandbox.resume()`), and timeout reset (`sandbox.setTimeout(seconds)`). Reach the underlying instance via:

```typescript
const native = compute.sandbox.getInstance(sandbox) // returns the raw Sandbox
await native.fork(4)
await native.hibernate()
```
