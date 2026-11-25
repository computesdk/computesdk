# @computesdk/offstage

[Offstage](https://offstage.cloud) provider for ComputeSDK - real macOS sandboxes on Apple silicon for AI agents and CI, with commands, files, Xcode, iOS simulators and GUI sessions. Each sandbox is its own macOS user account on a Mac, driven over HTTP: headless sandboxes run commands with Swift, Xcode, iOS simulators, Node and Python present, and GUI sandboxes run apps on their own desktop.

## Installation

```bash
npm install @computesdk/offstage
```

## Setup

Create an API key in the [Offstage console](https://console.offstage.cloud) (keys start with `sk_offstage_`), then set it:

```bash
OFFSTAGE_API_KEY=sk_offstage_your_api_key
```

Other environment variables, all optional:

| Variable | Effect |
| --- | --- |
| `OFFSTAGE_API_URL` | Points the provider at another Offstage API origin. |
| `OFFSTAGE_LAZY_CREATE` | `1` or `true` turns on [lazy create](#lazy-create) for providers that do not set `lazyCreate`. |
| `OFFSTAGE_PRECONNECT` | `0` or `false` stops the provider from opening its [connections](#connections) when it is imported. |

## Usage

```typescript
import { offstage } from '@computesdk/offstage';

const compute = offstage({
  apiKey: process.env.OFFSTAGE_API_KEY,
});

// Create a sandbox: a macOS user account on an Apple silicon Mac
const sandbox = await compute.instances.create({ timeout: 30 * 60_000 });

// Write a file under the sandbox root and run it
await sandbox.filesystem.writeFile('hello.swift', 'print("Hello from a Mac!")');
const result = await sandbox.runCommand('swift hello.swift');
console.log(result.stdout); // "Hello from a Mac!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface OffstageConfig {
  /** Offstage API key (sk_offstage_...) - if not provided, falls back to the OFFSTAGE_API_KEY env var */
  apiKey?: string;
  /** Base URL of the Offstage API - falls back to OFFSTAGE_API_URL, then https://api.offstage.cloud */
  baseUrl?: string;
  /** 'headless' (default) runs commands with no desktop; 'gui' gives the sandbox a logged-in desktop */
  session?: 'headless' | 'gui';
  /** Defer each create to the sandbox's first use (see Lazy create) - falls back to OFFSTAGE_LAZY_CREATE, then off */
  lazyCreate?: boolean;
}
```

### Create options

| Option | Maps to | Notes |
| --- | --- | --- |
| `timeout` | `timeoutMs` | How long the sandbox may live, in milliseconds. 15 minutes by default, 24 hours at most. |
| `name` | `name` | 1 to 48 lowercase letters, digits and inner hyphens, like `ios-build`. |
| `session` | `session` | `'headless'` or `'gui'`; overrides the provider's `session` for this sandbox. |

`create` is one request and returns at once. The sandbox starts out waiting for a free Mac slot, and its first command or file call waits for that slot on Offstage's side, so there is nothing to poll.

### Lazy create

With `lazyCreate: true` (or `OFFSTAGE_LAZY_CREATE=1`), `create()` makes no request at all. The first command sends one request that creates the sandbox and runs the command, using the `run` field of `POST /v1/sandboxes`, which saves a round trip:

```typescript
const compute = offstage({ apiKey: process.env.OFFSTAGE_API_KEY, lazyCreate: true });

const sandbox = await compute.instances.create();      // no request
const result = await sandbox.runCommand('node -v');     // creates the sandbox and runs node -v
```

- The first `runCommand`, and the first `mkdir`, `readdir`, `exists` or `remove` (which run as commands), ride the create. Any other first call (`getInfo`, `getUrl`, `readFile`, `writeFile`, `getById` with the placeholder id) creates the sandbox before doing its own work. Concurrent first calls share one create.
- Errors from the create surface on that first call. A create Offstage refused (no credit, a bad `name`, a command it would not accept) made nothing: the call gets the error and the next call tries again. A create whose answer was lost on the way is never sent again, as it may have made a sandbox, and every later call gets the same error.
- A first command that could not run after the sandbox was made, for example because the sandbox closed while waiting for a slot, throws an `OffstageError` with its `code` and no `status`. A first command that is still waiting for a slot is sent again the ordinary way.
- Destroying a handle that was never used sends nothing. Destroying it while its create is in flight waits for the create and then destroys the sandbox it made. A handle destroyed before it was created rejects every later call.
- Calls that are wrong in themselves (an absolute path to `readFile` or `writeFile`, a background command) are refused without creating the sandbox.

**The id is a placeholder.** `sandbox.sandboxId` (and `instanceId`) is a client-side id such as `lazy_6b4c…` for the whole life of the handle, before and after the sandbox exists, because ComputeSDK fixes it when `create()` returns. `destroy(id)` and `getById(id)` accept it, but only in the process that created the handle and only with the same API key. To store the sandbox or pass it to another process, read the real id from `(await sandbox.getInfo()).id` (or `sandbox.getInstance().id` once the sandbox exists). Until the first call, `getInstance()` holds placeholder values and `list()` does not show the sandbox.

## Sessions

- **`headless`** (default): the sandbox's macOS user with no desktop. For `swift build`, `swift test`, `xcodebuild`, iOS simulators (`xcrun simctl`), Node, Python and scripts.
- **`gui`**: a logged-in desktop session, for apps with windows, screenshots and macOS UI tests. In a `gui` sandbox a command's `stdout` carries both output streams and `stderr` is empty.

Every sandbox starts with macOS on Apple silicon, Xcode with iOS simulator runtimes, Swift, Apple clang, git, Node with npm, Python 3 and Rust. There is no `sudo` and no Homebrew; tools install into the home folder. See the [Offstage docs](https://offstage.cloud/docs) for the current versions.

## Commands

`runCommand` runs a shell command line as `zsh -lc` and takes `cwd`, `env` and `timeout`:

```typescript
const result = await sandbox.runCommand('swift build 2>&1', {
  cwd: 'app',               // relative to the sandbox root, created if missing
  env: { CI: '1' },
  timeout: 20 * 60_000,     // 10 minutes by default, 30 minutes at most
});
```

- A command that ends within about 50 seconds is one request. A longer one is followed with long-polls until it ends.
- A relative `cwd` is relative to the sandbox root. An absolute `cwd` such as `/tmp` works too.
- A command killed at its timeout returns exit code `124`.
- Each stream keeps its last 1 MiB. Redirect larger output to a file and read the file.
- Each command is a new process, so `cd` and `export` do not carry over. Use `cwd` and `env`.

## Files

File paths are relative to the sandbox root (`/Users/<slot user>/offstage-sandbox/<sandbox id>`), which is also where commands start.

```typescript
await sandbox.filesystem.writeFile('src/main.swift', source);   // creates src/
const log = await sandbox.filesystem.readFile('build.log');
await sandbox.filesystem.mkdir('out');
const entries = await sandbox.filesystem.readdir('src');
const there = await sandbox.filesystem.exists('out/app.zip');
await sandbox.filesystem.remove('out');
```

- `readFile` and `writeFile` use Offstage's file routes. They take paths made of letters, digits, `.`, `_`, `-` and `/`, with no `..` segment, and **reject absolute paths** such as `/tmp/a.txt`. To place a file elsewhere on the Mac, write it under the root and move it: `await sandbox.runCommand('mv a.txt /tmp/a.txt')`.
- `mkdir`, `readdir`, `exists` and `remove` run as shell commands from the sandbox root, so they take relative paths (the same files as above) and absolute paths.

## Standard sizes

Offstage does not support `sizeClass`. Every sandbox has the same fixed shape, a macOS user account on an Apple silicon Mac, and `POST /v1/sandboxes` takes no CPU, memory or disk fields.

| `sizeClass` | Status | Reason |
| --- | --- | --- |
| `xs`, `sm`, `md`, `lg`, `xl`, `2xl`, `3xl` | `unsupported` | One fixed shape; nothing to select. |

`provider.sizes.resolve(...)` returns `unsupported` for every class, and `create({ sizeClass })` rejects with `InstanceSizeError` (`code: 'unsupported'`) before calling the API. Omit `sizeClass` to create a sandbox.

## Errors

A failed API call throws an `OffstageError` carrying Offstage's error envelope: `status`, `code`, `detail`, and, when present, `fix` (what to do) and `requestId`. The message reads like `Offstage 409 sandbox-closed: sandbox sbx_... is closed (idle) Fix: create a new sandbox. (request req_...)`.

```typescript
import { OffstageError } from '@computesdk/offstage';

try {
  await sandbox.runCommand('swift build');
} catch (error) {
  if (error instanceof OffstageError && error.code === 'sandbox-closed') {
    // create a new sandbox
  }
}
```

Two answers are retried for you, because the call was not performed: `429 rate-limit` is sent again after the seconds its `Retry-After` header gives, and `409 sandbox-not-ready` (the sandbox is still waiting for a Mac slot) is sent again for up to two minutes.

A call that gets no answer at all (its connection failed) throws an `Error` whose message starts `Offstage: <METHOD> <path> got no answer:`, with the network error as its `cause`. See [Connections](#connections) for when such a call is sent again first.

## Connections

The provider talks to Offstage over HTTP/2, through a pool of 16 connections per API origin shared by every sandbox in the process. A burst of creates rides a few connection handshakes instead of one each and is spread over the pool instead of queueing behind one connection.

- **Opened on import.** When the module is imported with an Offstage key in `OFFSTAGE_API_KEY`, the pool to `OFFSTAGE_API_URL` (or the default API) starts connecting, so code that creates the provider inside its own timer does not pay the TLS handshake on its first request. Nothing connects without a key. The import never fails because of it. `OFFSTAGE_PRECONNECT=0` turns it off.
- **No hold on the process.** Idle connections do not keep Node running, so a script exits once its work is done; a connection holds the process open only while one of its requests waits for an answer.
- **Replaced when they fail.** A connection that errors, closes or is told to go away leaves the pool, and the next request opens its replacement. A connection that has not connected after 10 seconds is dropped, so a request never waits on an unreachable API for longer than that per try.
- **Sent again only when safe.** A request whose connection dies before the answer begins is sent once more, on another connection, when that cannot do anything twice: when it never left the process, when Offstage refused the stream unprocessed, or when it is a `GET`, `PUT`, `DELETE` or a create (creates carry an `Idempotency-Key`). A command, and a lazy create that carries one, is not sent again once it may have reached Offstage: it could run twice. An answer cut off midway is never sent again.

## Supported Operations

| Method | Supported | Notes |
| --- | --- | --- |
| `create` | ✅ | One request, or none with `lazyCreate`. `timeout`, `name`, `session`. |
| `getById` | ✅ | |
| `list` | ✅ | Sandboxes that are waiting for a slot or running. |
| `destroy` | ✅ | Kills everything the sandbox runs and wipes its macOS account. |
| `runCommand` | ✅ | `cwd`, `env`, `timeout`. |
| `getInfo` | ✅ | |
| `filesystem` | ✅ | `readFile` and `writeFile` over the file routes; the rest through the shell. |
| `getUrl` | ❌ | Sandboxes expose no ports to the internet. |
| Background commands, `startProcess`, live output (`onStdout`/`onStderr`) | ❌ | See Limitations. |
| `sizeClass` | ❌ | One fixed shape. |

## Limitations

- **No port URLs.** `getUrl` throws: a sandbox exposes no ports to the internet.
- **No background commands or live output.** `runCommand(..., { background: true })` throws. Offstage's API answers a command when it ends, and ComputeSDK's shell process tier, which would serve `startProcess`, `onStdout` and `onStderr`, needs `setsid`, which macOS does not have.
- **`readFile` returns text.** File bytes are decoded as UTF-8.
- **Rate limit.** A team may send 120 requests a minute; past that calls wait out the `Retry-After` and continue.
- **No templates or snapshots** through ComputeSDK.
- **Node.js only.** The provider uses `node:http2`, so it does not run in edge runtimes that only offer `fetch`.

## Support

- [Offstage documentation](https://offstage.cloud/docs)
- [ComputeSDK issues](https://github.com/computesdk/computesdk/issues)

## License

MIT
