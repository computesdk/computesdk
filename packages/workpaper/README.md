# @computesdk/workpaper

[Workpaper](https://workpaper.co) provider for [ComputeSDK](https://computesdk.com). Persistent Linux computers in microVMs: they keep their files and running processes when paused, and resume or fork in about a second.

## Install

```bash
npm install @computesdk/workpaper
```

## Usage

```typescript
import { workpaper } from '@computesdk/workpaper'

const compute = workpaper({
  apiKey: process.env.WORKPAPER_API_KEY,
})

const computer = await compute.instances.create()

const result = await computer.runCommand('node -v')
console.log(result.stdout) // v24.x.x

await computer.filesystem.writeFile('/tmp/hello.txt', 'world')
const content = await computer.filesystem.readFile('/tmp/hello.txt')

await computer.destroy()
```

## Configuration

| Option | Env var | Default | Description |
|---|---|---|---|
| `apiKey` | `WORKPAPER_API_KEY` | required | API key: `workpaper keys create <name>` |
| `size` | | `small` | `small` (2 vCPU / 4 GB), `large` (4 vCPU / 8 GB), `xlarge` (8 vCPU / 16 GB) |

`compute.instances.create({ vcpus, memMiB })` picks the smallest size that fits.

## Instance API

```typescript
// Execute commands
const cmd = await computer.runCommand('echo $FOO', { env: { FOO: 'bar' }, cwd: '/tmp' })

// Filesystem
await computer.filesystem.writeFile('/app/data.json', JSON.stringify({ key: 'value' }))
const data = await computer.filesystem.readFile('/app/data.json')
const entries = await computer.filesystem.readdir('/app')
const exists = await computer.filesystem.exists('/app/data.json')
await computer.filesystem.mkdir('/app/output')
await computer.filesystem.remove('/app/output')

// Lifecycle
const info = await computer.getInfo()
const all = await compute.instances.list()
await computer.destroy()
```

## Beyond the standard interface

Pause, resume and fork have no slots in the standard interface. Reach them through the underlying computer:

```typescript
const native = computer.getInstance()
await native.stop()                     // pause: files and processes are kept
await native.start()                    // resume where it left off
const copy = await native.fork('copy')  // a second computer from this one's current state
```

Workpaper computers don't accept incoming connections, so `getUrl` is not supported.
