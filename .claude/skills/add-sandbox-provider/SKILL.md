---
name: add-sandbox-provider
description: >-
  Guide a provider author through adding their **sandbox** compute provider to
  ComputeSDK and opening a PR. Use when someone wants to contribute a new
  `@computesdk/<name>` sandbox provider package — a service that creates sandboxes
  and runs shell commands (`defineProvider` / `methods.sandbox`) — or asks "how do I
  add my sandbox provider" / "open a PR to add <X>". This skill is sandbox-only; it
  does NOT cover browser providers (`defineBrowserProvider` / `methods.session`, e.g.
  browserbase, steel) or storage providers (`StorageProvider`, e.g. s3, r2). Scaffolds
  the package, implements the provider against the framework, verifies
  build/typecheck/lint/tests, adds a changeset, and opens the pull request.
---

# Add a Sandbox Provider to ComputeSDK

Help a provider author ship a new `@computesdk/<name>` **sandbox** provider package and
open a PR against `computesdk/computesdk`. The canonical implementation spec lives in
[ADD-PROVIDER.md](../../../ADD-PROVIDER.md) ("Adding a New Sandbox Provider") — read it
before scaffolding and treat it as the source of truth for file contents, method
signatures, and naming. This skill is the orchestration layer around that doc: it
gathers what's needed, drives the edits, verifies, and handles the git/PR mechanics.

**Scope check first.** This skill is only for **sandbox** providers — services that
create sandboxes and execute shell commands via `defineProvider` with
`methods.sandbox`. ComputeSDK has two other provider categories this skill does **not**
handle:
- **Browser** providers use `defineBrowserProvider` with `methods.session` (see
  [packages/browserbase](../../../packages/browserbase),
  [packages/steel](../../../packages/steel)).
- **Storage** providers implement the `StorageProvider` interface with
  `upload`/`download`/`delete`/`list` (see [packages/s3](../../../packages/s3),
  [packages/r2](../../../packages/r2)).

If the author's service is a browser or storage provider, stop and tell them this skill
doesn't apply — point them at the reference packages above rather than scaffolding a
sandbox provider for them.

## Operating principles

- **Do the work, don't just narrate it.** Scaffold real files, write real code, run
  the real checks. Only stop to ask the author for things you genuinely cannot
  infer (SDK package name, auth/env vars, which capabilities the service supports).
- **Match the codebase.** Copy structure and conventions from an existing reference
  sandbox provider rather than inventing them. Good references:
  [packages/blaxel](../../../packages/blaxel) (full-featured, filesystem + snapshots),
  [packages/e2b](../../../packages/e2b), [packages/modal](../../../packages/modal),
  [packages/just-bash](../../../packages/just-bash) (no auth, simplest).
- **Never invent provider API calls.** If you don't know the provider SDK's surface,
  ask the author or have them point you at its docs. Wrong API guesses are worse than
  a `throw new Error('not supported yet')` placeholder.

## Step 1 — Gather the essentials

Before writing anything, establish (ask only for what you can't determine):

- **Provider name** → kebab-case package suffix (`@computesdk/<name>`), camelCase
  export (`export const <name>`), `<PascalCase>Config` type.
- **Underlying SDK / API** — npm package name + version, or a REST API. This becomes
  the runtime `dependency` in package.json.
- **Auth model** — which env vars / config fields (e.g. `apiKey`, `tokenId`). These
  drive config validation and the test suite's `skipIntegration` guard.
- **Capabilities** — which of these the service supports: command execution (required),
  filesystem, `getUrl` (port exposure), `list`, templates, snapshots. Anything
  unsupported gets a method that throws a clear error (see ADD-PROVIDER.md §3–4).

Use the `AskUserQuestion` tool for the capability/auth choices if they're unclear;
infer the rest from the SDK docs the author provides.

## Step 2 — Scaffold the package

Create `packages/<name>/` with the files from ADD-PROVIDER.md §1. Fastest reliable
path: copy a reference provider's non-source config files and edit names.

```bash
# from repo root
cp packages/blaxel/{tsconfig.json,tsup.config.ts,vitest.config.ts} packages/<name>/
```

Then author by hand:
- `package.json` — set `name`, `description`, `author` (the contributor),
  `dependencies` (their SDK + `@computesdk/provider: workspace:*` +
  `computesdk: workspace:*`), and provider-specific `keywords`. Keep the standard
  `scripts`, `devDependencies`, `repository.directory`, `homepage`, `bugs` blocks.
  Start `version` at `1.0.0` for a brand-new package.
- `README.md` — features, install, config/env vars, a usage example, supported
  runtimes, limitations. Mirror [packages/e2b/README.md](../../../packages/e2b/README.md).
- `src/index.ts` and `src/__tests__/index.test.ts` — see steps 3–4.

The root `pnpm-workspace.yaml` already globs `packages/*`, so no registration there.

## Step 3 — Implement the provider

Define the provider with `defineProvider` from `@computesdk/provider` (full spec and a
worked example in ADD-PROVIDER.md §2–4). Requirements:

- Implement the **core methods** fully: `create`, `getById`, `destroy`, `runCommand`,
  `getInfo`. For unsupported optional methods (`list`, `getUrl`, `template`,
  `snapshot`), define them but `throw new Error('<Provider> does not support …')`.
- **Validate config early** with a helpful message pointing to where to get keys, and
  **fall back to env vars** (`config.apiKey ?? process.env.<PROVIDER>_API_KEY`).
- When interpolating any path/arg into a shell command, use `escapeShellArg` from
  `@computesdk/provider` **wrapped in double quotes** — e.g.
  `` `cat "${escapeShellArg(path)}"` ``. The helper does not escape spaces or `;`/`|`,
  so unquoted use is unsafe.
- If the service has a filesystem API, implement the `filesystem` block; otherwise omit
  it and the framework auto-generates "not supported" errors.

Read the most structurally similar reference provider in full before writing, and
follow its shape (status mapping, error wrapping, option passthrough).

## Step 4 — Tests

Use the shared suite from `@computesdk/test-utils` (ADD-PROVIDER.md §5):

```typescript
import { runProviderTestSuite } from '@computesdk/test-utils';
import { <name> } from '../index';

runProviderTestSuite({
  name: '<name>',
  provider: <name>({ /* or {} to rely on env-var fallback */ }),
  supportsFilesystem: true,            // false if no filesystem block
  skipIntegration: !process.env.<PROVIDER_API_KEY>,  // skip live calls when unset
});
```

Unit tests run in mock mode without keys; integration tests are skipped unless the
author exports their credentials. That's expected — don't block the PR on live runs.

## Step 5 — Verify locally

```bash
pnpm install
pnpm build                                  # ordered build; run after install
pnpm --filter @computesdk/<name> run typecheck
pnpm --filter @computesdk/<name> run lint
pnpm --filter @computesdk/<name> run test
```

`pnpm build` order matters (`@computesdk/cmd` → `computesdk` → `@computesdk/provider`
→ `@computesdk/test-utils` → rest). If a check fails, fix it before moving on. A benign
`WARN Failed to create bin … computesdk-cloudflare` after install is fine.

## Step 6 — Wire into docs and changeset

- **Root [README.md](../../../README.md)** — make two edits:
  1. Add a row to the **"Supported Providers"** table (provider name, env vars,
     use cases).
  2. Add the package to the **"Provider Packages"** section: an
     `npm install @computesdk/<name>` line in the install block and a
     `- **[@computesdk/<name>](./packages/<name>)** - <one-line summary>` entry in
     the README link list. Keep the existing alignment/format of those lists.
- **Changeset** — create `.changeset/<short-slug>.md`. Per repo policy, default to
  **`patch`**:

  ```markdown
  ---
  "@computesdk/<name>": patch
  ---

  Add <Provider> provider
  ```

- The CLI gateway registry in
  [packages/cli/src/providers.ts](../../../packages/cli/src/providers.ts) is only for
  providers wired into the hosted ComputeSDK gateway — **do not** add a standalone
  community provider there unless the author confirms gateway integration.

## Step 7 — Open the PR

Confirm with the author before pushing (this publishes to a public repo). Then:

```bash
git checkout -b add-<name>-provider
git add packages/<name> README.md .changeset
git commit   # plain message: "Add <Provider> provider"
git push -u origin add-<name>-provider
gh pr create --repo computesdk/computesdk --base main \
  --title "Add <Provider> provider" \
  --body-file /tmp/add-<name>-pr-body.md
```

If the author is working from a fork, push to their fork and open the PR with `gh pr
create --head <fork-owner>:add-<name>-provider`.

**PR body** — fill in the provider template at
[.github/PULL_REQUEST_TEMPLATE/add-provider.md](../../../.github/PULL_REQUEST_TEMPLATE/add-provider.md):
read it, replace every `<placeholder>`, set the capability table to reflect what was
actually implemented (✅/❌), tick the checklist boxes you verified, and write it to a
temp file to pass via `--body-file`. (Authors opening a PR by hand in the GitHub UI can
select it with the `?template=add-provider.md` query param.)

## Done

Report back: the package path, which capabilities were implemented vs. stubbed, the
results of each verification command, and the PR URL.
