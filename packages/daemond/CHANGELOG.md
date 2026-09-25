# daemond

## 0.1.6

### Patch Changes

- 1157237: Add `argvEncoding: "base64"` to `daemonSeedScriptCommand` so the seed launcher can be delivered through exec layers that re-split or collapse quotes, and add detached jobs (`exec` with `detach: true`) with `wait`/`status`/`kill` messages. Command results now carry `status: "running" | "exited"`, report `exitCode: null` instead of an invented code while running or when killed by a signal, and `kill` signals the whole process group.

## 0.1.5

### Patch Changes

- 7e65fe7: fix(daemond): bootstrap node into sandboxes that lack a JS runtime. `daemonSeedScriptCommand` now resolves node from PATH, a cached bootstrap under `~/.computesdk/daemond`, or a pinned static build fetched through whatever the image ships (curl, wget, busybox wget, python3), and exits 127 with a clear `daemond:` capability error when none of that works. `parseSeedInvocationOutput` and the factory's daemon path now include the raw output tail / stderr so failures are diagnosable from job logs.

## 0.1.4

### Patch Changes

- 1519626: Migrate `daemond` into the ComputeSDK pnpm monorepo under `packages/daemond` while keeping the same npm package name and API.

  Add monorepo test/typecheck wiring so `daemond` integration and type checks run in root CI pipelines.
