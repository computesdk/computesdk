# @computesdk/docker

A Docker-based provider for [ComputeSDK](https://github.com/computesdk/computesdk) that launches lightweight, configurable containers (Python or Node.js), runs code and shell commands, and offers simple filesystem helpers — all behind a clean, provider-agnostic interface.

---

## Installation

```bash
# like the other computesdk providers — single package
pnpm add @computesdk/docker
# or
npm i @computesdk/docker
# or
yarn add @computesdk/docker
```

> You **do** need a working Docker Engine/Daemon on the host where this runs.

---

## Setup

Nothing special beyond Docker. The provider talks to Docker through `dockerode`, which autodetects your connection from env or the default socket.

Common environment variables (used by Docker/dockerode):

* `DOCKER_HOST` — e.g. `unix:///var/run/docker.sock` (Linux/macOS) or `tcp://127.0.0.1:2375`
* `DOCKER_TLS_VERIFY`, `DOCKER_CERT_PATH` — for TLS-secured TCP
* `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` — for pulls behind a proxy

> On Linux, ensure your user can access Docker: `sudo usermod -aG docker $USER` then re-login, or run with `sudo`.

---

## Usage

You can use the provider directly or via the ComputeSDK singleton.

### With ComputeSDK

```ts
import { createCompute } from 'computesdk';
import { docker } from '@computesdk/docker';

const provider = docker({
  runtime: 'python', // or 'node'
  image: { name: 'python:3.11-slim', pullPolicy: 'ifNotPresent' },
});

const compute = createCompute({ defaultProvider: provider });

// Create a sandbox and run Python
const py = await compute.sandbox.create();
const out = await py.runCode(`print("Hello from Python")`, 'python');
console.log(out.stdout.trim()); // Hello from Python

await py.destroy();
```

### Direct Usage

```ts
import { docker } from '@computesdk/docker';

const provider = docker({
  runtime: 'node',
  image: { name: 'node:20-alpine' },
  container: {
    workdir: '/workspace',
    env: { FOO: 'bar' },
  },
});

const sb = await provider.sandbox.create({ runtime: 'node' });

const res = await sb.runCode(`console.log("Hello, World!")`, 'node');
console.log(res.stdout.trim()); // Hello, World!

const ls = await sb.runCommand('sh', ['-lc', 'echo Hello from command']);
console.log(ls.stdout.trim()); // Hello from command

await sb.destroy();
```

---

## Configuration

Type: `DockerConfig`

```ts
{
  // dockerode connection; if omitted, dockerode uses DOCKER_HOST or /var/run/docker.sock
  connection?: import('dockerode').DockerOptions;

  // default runtime; must be 'python' or 'node'
  runtime?: 'python' | 'node';

  // provider-side execution timeout (ms)
  timeout?: number;

  // image to use for containers
  image: {
    name: string;                   // e.g. 'python:3.11-slim' or 'node:20-alpine'
    pullPolicy?: 'always' | 'ifNotPresent' | 'never';
    auth?: { username?: string; password?: string; serveraddress?: string; identitytoken?: string; registrytoken?: string; };
  };

  // container defaults
  container?: {
    user?: string;
    workdir?: string;
    env?: Record<string, string>;
    binds?: string[];               // ['/host:/container:ro']
    ports?: Record<`${number}/${'tcp'|'udp'}`, Array<{ hostPort?: number; hostIP?: string }>>;
    networkMode?: string;           // 'bridge', 'host', custom
    privileged?: boolean;
    capabilities?: { add?: string[]; drop?: string[] };
    gpus?: 'all' | number | string; // requires NVIDIA runtime/drivers
    resources?: { memory?: number; nanoCPUs?: number; cpuShares?: number; /* … */ };
    logDriver?: string;
    logOpts?: Record<string, string>;
    autoRemove?: boolean;           // default true
    tty?: boolean;
    openStdin?: boolean;
  };

  // raw passthrough if you need full control
  createOptions?: import('dockerode').ContainerCreateOptions;
  startOptions?: import('dockerode').ContainerStartOptions;

  cleanup?: 'always' | 'onSuccess' | 'never';
  streamLogs?: boolean;
}
```

**Defaults (excerpt):**

```ts
{
  runtime: 'python',
  image: { name: 'python:3.11-slim', pullPolicy: 'ifNotPresent' },
  container: {
    workdir: '/workspace',
    env: {},
    autoRemove: true,
    tty: true,
    openStdin: false,
    resources: { memory: 512 * 1024 * 1024 },
  },
}
```

### Environment Variables

* Docker connection variables from **Setup**
* Your workload envs via `container.env` (injected into the container)

---

## Features

* **Python** and **Node.js** runtimes
* **Code execution** with syntax-error surfacing
* **Shell commands** (foreground & background with PID)
* **Filesystem helpers**: `readFile`, `writeFile`, `mkdir`, `readdir`, `exists`, `remove`
* **Port URL resolution**: `getUrl({ port })` → host URL if published
* **Typed access**: `getInstance()` returns the dockerode `Container` and client
* **Image pull policy**: `always | ifNotPresent | never` (+ registry auth)

---

## API Reference

### Code Execution

```ts
sandbox.runCode(code: string, runtime?: 'python' | 'node'): Promise<ExecutionResult>
```

* If `runtime` omitted, the sandbox’s runtime (set at creation) is used.
* Returns `{ stdout, stderr, exitCode, executionTime, sandboxId, provider }`
* Syntax errors are **thrown** as `Error("Syntax error: …")`.

### Command Execution

```ts
sandbox.runCommand(command: string, args?: string[], options?: { background?: boolean }): Promise<ExecutionResult>
```

* Runs via `/bin/sh -c "…"` with stdout/stderr capture.
* Background returns `{ isBackground: true, pid?: number }`.

### Filesystem Operations

```ts
sandbox.filesystem.readFile(path)
sandbox.filesystem.writeFile(path, content)
sandbox.filesystem.mkdir(path)
sandbox.filesystem.readdir(path)
sandbox.filesystem.exists(path)
sandbox.filesystem.remove(path)
```

> Implemented via shell + base64 for portability.

### Terminal Operations

Interactive terminals aren’t exposed. Use `runCommand('sh', ['-lc', '…'])` for non-interactive sessions.

### Sandbox Management

```ts
const sb = await provider.sandbox.create({ runtime?: 'python' | 'node' });
await provider.sandbox.destroy(sb.sandboxId);

await sb.getInfo(); // { id, provider, runtime, status, createdAt, timeout, metadata }
await sb.getUrl({ port, protocol?: 'http' | 'https' });
sb.getInstance(); // { docker: Docker, container: Container, ... }
```

---

## Runtime Detection

There’s **no auto-detection**. Resolution is:

1. `runCode(_, runtime)` argument, else
2. runtime label set at `sandbox.create()` (from `options.runtime` or provider `config.runtime`)

If neither yields `'python' | 'node'`, `runCode` throws.

---

## Error Handling

* **Syntax errors** → **thrown** (`Error("Syntax error: …")`)
* **Runtime/command errors** → returned as non-zero `exitCode` with `stderr`
* **Docker errors** (pull/start/exec) → **thrown**

```ts
const res = await sb.runCommand('sh', ['-lc', 'bad-command']);
if (res.exitCode !== 0) {
  console.error('stderr:', res.stderr);
}
```

---

## Web Framework Integration

```ts
import { handleComputeRequest } from 'computesdk';
import { docker } from '@computesdk/docker';

const provider = docker({
  runtime: 'node',
  image: { name: 'node:20-alpine' },
});

export async function POST(req: Request) {
  const body = await req.json(); // ComputeRequest
  return handleComputeRequest(body, provider);
}
```

---

## Examples

### Data Science Workflow (Python)

```ts
const py = await provider.sandbox.create({ runtime: 'python' });
await py.runCommand('sh', ['-lc', 'python3 -m pip install --no-cache-dir pandas']);
await py.filesystem.writeFile('/workspace/app.py', `
import pandas as pd
print("rows:", len(pd.DataFrame({"x":[1,2,3]})))
`);
const run = await py.runCommand('sh', ['-lc', 'python3 /workspace/app.py']);
console.log(run.stdout.trim()); // rows: 3
await py.destroy();
```

### Interactive-like Loop

```ts
const sb = await provider.sandbox.create({ runtime: 'node' });
await sb.runCommand('sh', ['-lc', 'echo boot > /tmp/state']);
await sb.runCommand('sh', ['-lc', 'cat /tmp/state']); // 'boot'
await sb.destroy();
```

### Machine Learning Pipeline (Python + Ports)

```ts
const sb = await provider.sandbox.create({ runtime: 'python' });
const bg = await sb.runCommand('sh', ['-lc', 'python3 -m http.server 8080'], { background: true });
const url = await sb.getUrl({ port: 8080 });
console.log('Serving at', url);
await sb.destroy();
```

> To make ports reachable from the host, publish them up front:
>
> ```ts
> const provider = docker({
>   runtime: 'python',
>   image: { name: 'python:3.11-slim' },
>   container: {
>     ports: { '8080/tcp': [{ hostPort: 8080, hostIP: '127.0.0.1' }] },
>   },
> });
> ```

---

## Best Practices

* Pre-pull images in CI: `docker pull python:3.11-slim node:20-alpine`
* Pin image versions; avoid `latest`
* Set `container.resources` to bound CPU/RAM
* Use `/workspace` and keep temp files in `/tmp`
* Publish ports you intend to access via `getUrl()`
* Prefer non-root `user` and drop unnecessary capabilities
* For GPU work: `gpus: 'all'` and ensure NVIDIA runtime/drivers

---

## Limitations

* Requires a local or reachable Docker daemon
* No WebSocket terminal (non-interactive only)
* Snapshots/templates not implemented in this provider
* `getUrl()` returns a host URL only for published ports or reachable container IPs

---

## Support

* Issues/PRs: [https://github.com/computesdk/computesdk](https://github.com/computesdk/computesdk)
* Open issues with title prefix **\[docker provider]**

---

## License

MIT
