# `defineSetup` — Implementation Notes

## Background

This document describes the `defineSetup` primitive added to ComputeSDK in
response to the Linear issue:"Add `defineSetup` primitive to
ComputeSDK". It captures what was built in phase 1, the reasoning behind the
key design decisions, and the work still needed for phase 2.

The Linear issue proposed a declarative, portable value object that defines
the execution environment for a sandbox — the runtime equivalent of a
Dockerfile, but resolved at runtime against installed dependencies (Nix,
where available). The motivation: today, a user who wants a sandbox with
Python + ffmpeg + their repo cloned + dependencies installed has to write a
sequence of imperative `runCommand()` calls. That's verbose, error-prone, and
not portable across providers. `defineSetup` lets them describe the *what*
once and have the SDK handle the *how* on whichever provider runs the
workload.

## Phase 1 — what shipped

### New primitive

```ts
import { compute, defineSetup, deps } from 'computesdk';

const setup = defineSetup({
  source: { type: 'github', repo: 'acme/my-app', ref: 'main' },
  deps: [deps.python, deps.ffmpeg, deps.nix('imagemagick')],
  install: ['pip install -r requirements.txt', 'pytest'],
  env: { API_KEY: process.env.API_KEY! },
  resources: { cpu: 2, memory: '4gb' },
});

const sandbox = await compute.sandbox.create({ setup });
await sandbox.runCommand('python main.py');
```

### Files added

- [`src/setup.ts`](src/setup.ts) — the public surface. `defineSetup` returns
  a deeply-frozen `SetupConfig`. The `deps` registry exposes curated
  Nix-backed entries (`python`, `node`, `go`, `rust`, `ruby`, `ffmpeg`,
  `imagemagick`, `git`, `curl`, `wget`, `jq`) plus `deps.nix(pkg)` as the
  escape hatch for arbitrary `nixpkgs` atoms. Each `Dep` is a plain
  `{ name, nixPkg }` object — no methods, fully serializable.
- [`src/apply-setup.ts`](src/apply-setup.ts) — internal orchestrator.
  Materializes source via the universal `runCommand` / `filesystem`
  interface; runs `nix profile install nixpkgs#<pkg>` per dep; runs the
  `install` script(s) sequentially. All shell arguments single-quote-escaped
  to prevent injection.
- [`src/__tests__/setup.test.ts`](src/__tests__/setup.test.ts) — 19 tests
  covering value freezing, every source type, dep install command shape,
  step ordering, env merging, shell escaping, and failure cleanup.

### Files modified

- [`src/types/universal-sandbox.ts`](src/types/universal-sandbox.ts) — added
  `setup?: SetupConfig` to `CreateSandboxOptions`.
- [`src/compute.ts`](src/compute.ts) — `createWithFallback` now merges
  `setup.env` into `options.envs` before calling the provider, then runs
  `applySetup` against the returned sandbox. Setup failures destroy the
  partial sandbox before the error propagates so we don't leak resources.
- [`src/index.ts`](src/index.ts) — exports `defineSetup`, `deps`, and the
  associated types (`Dep`, `SetupConfig`, `SetupSource`, `SetupResources`).

### Design decisions

**Setup is a pure value, not a class.** Per the issue's "key design
decisions", there is no `setup.run()` method. The sandbox owns lifecycle and
execution; the setup is just data. Because of this, setups can be exported
from libraries (the proto-registry idea — `@computesdk/setups/python` —
falls out for free), JSON-serialized, sent over the wire, or compared by
value. `defineSetup` deeply freezes the result so a shared setup can't be
mutated by one consumer and break another.

**Orchestration lives in core, not per-provider.** The Linear issue is
silent on where setup materialization happens. We chose to put it in core
(`apply-setup.ts`), driven entirely by the universal `Sandbox` interface
that every provider already implements. The benefit: `defineSetup` works on
all 40+ provider packages on day one with zero changes to any of them.
The cost: we run extra `runCommand` calls after create. Phase 2 introduces
a hook so providers that can do better natively (e.g. baking a setup into a
template image) can opt in.

**Nix is the dep mechanism, with no fallback.** The issue says "deps uses
Nix under the hood for hermetic, reproducible environments." We implement
that literally — `nix profile install nixpkgs#<pkg>`. If the sandbox image
doesn't have Nix installed, the command fails fast with a readable error.
We deliberately did not add an apt/yum fallback in phase 1: a fallback would
silently degrade reproducibility, which is the whole point of the Nix
choice. Better to be honest about which providers are setup-ready and use
phase 2 to broaden support.

**`setup.env` flows two places.** It's merged into `options.envs` before
the provider creates the sandbox (so the runtime environment has the vars
set persistently), *and* passed via `RunCommandOptions.env` to every command
that `applySetup` runs (so install steps see them even if a provider doesn't
honor `envs` for ad-hoc `runCommand` calls). User-supplied `envs` win on
collision — explicit beats declarative.

**`resources` is best-effort.** Most providers don't accept CPU/memory
hints at create time. Phase 1 passes `setup.resources` through on the
options object so providers can read it if they care, but core never
errors when sizing isn't honored.

### Phase 1 limitations (deliberate)

- Sandbox base image must have Nix installed for `deps` to work.
- `local` source uploads text files only — the universal
  `SandboxFileSystem.writeFile(path, content: string)` signature can't carry
  binaries.
- `resources` is plumbed but unused by core; provider authors must opt in.
- No caching — every `create({ setup })` re-clones, re-installs from
  scratch on a fresh sandbox.

---

## Phase 2 — what's still needed

Phase 1 ships a working primitive that is honest about its limitations.
Phase 2 is about closing the gap between "works on Nix-ready images" and
"works everywhere", plus the polish that makes setups useful in production.

### 1. Broaden dep resolution beyond pure Nix

**Problem.** Most provider base images don't ship with Nix. Today, anyone
using `deps` on E2B, Modal, Daytona, etc. gets a hard failure on the very
first `nix profile install`.

**Proposal.** Extend the `Dep` shape to carry per-package-manager hints, and
make `applySetup` choose at runtime based on what the sandbox has.

```ts
interface Dep {
  name: string;
  nixPkg: string;
  apt?: string;       // debian/ubuntu fallback
  brew?: string;      // macOS fallback (for local sandbox providers)
  pip?: string;       // python-package fallback for python deps
}
```

The orchestrator probes once per sandbox (`command -v nix`,
`command -v apt-get`) and dispatches accordingly. Curated `deps.python`
fills in all three fields; `deps.nix(...)` only fills `nixPkg` (escape hatch
keeps current semantics — Nix or fail).

**Acceptance.** A setup with `deps: [deps.python, deps.ffmpeg]` works on a
stock E2B sandbox without the user installing Nix first.

### 2. Provider-native setup hook

**Problem.** Running setup as post-create `runCommand`s is correct but slow.
A user who creates 100 sandboxes from the same setup runs the same git
clone + nix install + pip install 100 times. Some providers (E2B, Modal)
support snapshots/templates that could materialize a setup *once* and then
reuse it.

**Proposal.** Add an optional method to `DirectProvider`:

```ts
interface DirectProvider {
  // ... existing fields
  applySetup?: (sandbox: Sandbox, setup: SetupConfig) => Promise<void>;
}
```

If a provider implements `applySetup`, core delegates to it instead of
running the default orchestrator. Providers can do whatever's optimal —
look up a cached snapshot, materialize natively, etc. — and fall back to
calling the exported `applySetup` from `apply-setup.ts` when they don't
have anything better.

**Acceptance.** E2B provider can materialize a setup into a snapshot once
and reuse it on subsequent `compute.sandbox.create({ setup })` calls with
the same setup hash.

### 3. Setup hashing for caching and identity

**Problem.** No way to tell "is this the same setup I materialized last
time?". Required for any caching / snapshot reuse, and useful for telemetry
and debugging.

**Proposal.** Add `hashSetup(setup: SetupConfig): string` that returns a
stable SHA-256 of the canonicalized JSON representation of the setup.
`defineSetup` can attach the hash as a non-enumerable property
(`__setupHash`) so users don't have to recompute.

Edge cases to handle: `env` vars that come from `process.env` should *not*
participate in the hash (different machines, same setup logically), but
explicit literals should. One option: split `env` into `secrets` (excluded
from hash) and `env` (included).

**Acceptance.** Two `defineSetup({...})` calls with equivalent specs produce
the same hash; changing any field changes the hash; secrets don't.

### 4. Binary file uploads for `source: 'local'`

**Problem.** `SandboxFileSystem.writeFile(path, content: string)` can't
upload images, compiled binaries, etc. Anyone using `local` source for a
real project hits this immediately.

**Proposal.** Extend the universal filesystem signature to accept
`string | Uint8Array`, update all 40+ provider implementations to handle
the binary case (most use SDKs that already support it), and switch the
local-uploader to read with `fs.readFile(path)` (no encoding) and pass the
buffer through.

This is a wider change than just `setup` — it improves
`sandbox.filesystem.writeFile` for all callers — but the local-source path
is the forcing function.

**Acceptance.** A `setup` with `source: { type: 'local', path: './app' }`
correctly uploads a directory containing PNG assets and pre-built
executables.

### 5. Proto-registry packages

**Problem.** The Linear issue calls out `@computesdk/setups/python` as a
goal: shareable, reusable specs anyone can `import` and pass to
`sandbox.create`. The mechanism works in phase 1 (because `defineSetup`
returns a plain value), but no curated registry exists.

**Proposal.** Stand up `packages/setups/` containing one subpackage per
common environment:

- `@computesdk/setups/python` — Python 3.12 + pip + venv + common scientific
  stack (numpy, pandas, requests).
- `@computesdk/setups/node` — Node 20 + npm + pnpm.
- `@computesdk/setups/data-science` — Python + Jupyter + pandas + matplotlib
  + ffmpeg.
- `@computesdk/setups/playwright` — Node + Playwright + Chromium deps.

Each export is a `defineSetup({...})` value. They compose naturally: a
user can spread one and override fields:

```ts
import { pythonSetup } from '@computesdk/setups/python';
const mySetup = defineSetup({ ...pythonSetup, install: '...' });
```

(Spread works because `defineSetup` re-freezes anyway.)

**Acceptance.** At least three setups published to npm and used in an
example in the docs.

### 6. Honor `resources` where the provider supports it

**Problem.** `setup.resources` is currently inert. Providers that *can*
honor CPU/memory hints (Modal, Kernel, Fly) should do so when a setup
specifies them.

**Proposal.** Document a contract in `@computesdk/provider`: "if your
provider's create call accepts CPU/memory, read them from
`options.setup?.resources`". Update Modal, Kernel, and Fly first as
reference implementations. Providers that can't honor sizing remain
ignorant of the field.

**Acceptance.** A setup with `resources: { cpu: 2, memory: '4gb' }` creates
a Modal sandbox sized accordingly; the same setup on E2B silently uses E2B
defaults; neither errors.

### 7. Setup validation and clearer errors

**Problem.** `defineSetup` accepts any object that matches the type. A
typo like `source: { type: 'githhub', ... }` won't be caught until runtime,
when `applySetup` falls through the source switch.

**Proposal.** Validate at `defineSetup` time:

- `source.type` is one of the known values.
- `source.repo` matches `<org>/<repo>` for github source.
- `deps` entries have `name` and `nixPkg` fields.
- `resources.memory` matches `\d+(?:gb|mb|kb)?` (case-insensitive).
- `env` keys are valid env-var identifiers.

Throw `Error` with a path-prefixed message (`SetupConfig.source.type:
expected "github" | "local" | "tar", got "githhub"`) so the user sees the
problem at definition site, not deep inside an orchestrator.

**Acceptance.** Every invalid `defineSetup({...})` call throws synchronously
with a message that names the offending field and what was expected.

### 8. Streaming progress for slow setups

**Problem.** A setup with 5 deps and a `pip install` can take minutes.
Today the user just waits silently for `compute.sandbox.create({ setup })`
to resolve.

**Proposal.** Optional `onProgress` callback on `CreateSandboxOptions`:

```ts
await compute.sandbox.create({
  setup,
  onProgress: (event) => console.log(event),
});

// event: { phase: 'source' | 'deps' | 'install', step: string, status: 'start' | 'done' | 'error', durationMs?: number }
```

`applySetup` emits one event per step. The CLI / UI layer can render this;
programmatic users can ignore it.

**Acceptance.** `examples/setup-progress` shows live progress output as a
multi-step setup runs.

---

## Suggested phase 2 sequencing

1. **Hashing (3)** + **validation (7)** — small, self-contained, unblock
   everything else. ~1 day.
2. **Multi-package-manager dep resolution (1)** — the highest-leverage
   change for actual users. ~2 days.
3. **Provider-native setup hook (2)** + reference impl on E2B — ~3 days.
4. **Binary uploads (4)** — touches every provider package, so plan for
   review fan-out. ~3 days.
5. **Proto-registries (5)** — once 1–4 land. ~1 day.
6. **`resources` honoring (6)** + **streaming progress (8)** — polish, can
   slip if needed.

Total: roughly 2 weeks of focused work, with (4) being the biggest unknown
because of the cross-provider blast radius.
