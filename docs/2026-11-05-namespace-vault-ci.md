# Namespace vault credentials in provider CI

## Scope

Both integration matrices now cover all 33 active providers in
`computesdk/benchmarks`' `.github/workflows/sandbox-dax-benchmarks.yml`:
Archil, Arker, Beam, Blaxel, Buddy, Cloud Run, Cloudflare, CodeSandbox,
CreateOS, Daytona, E2B, Freestyle, GiveMeANode, Gravixlayer, HopX, Isorun,
Modal, Microsandbox, Miosa, Mosaic, Namespace, Northflank, Novita,
OpenComputer, Promigence, Run Cloud, Sail, Sandbox0, Superserve, Tenki,
Tensorlake, Upstash and Vercel. The core matrix additionally retains platform.
Providers commented out of the Dax workflow are not automatically enabled.
Kubernetes retains its local kind cluster and needs no vault credentials.

`scripts/integration-providers.json` is the shared source for matrix generation,
per-provider vault allowlists, package names and core test configuration. This
also handles benchmark IDs that differ from package names: `cloud-run` uses
`@computesdk/gcp` and `createos` uses `@computesdk/createos-sandbox`.
Adding an entry wires that provider into both matrices without copying key
lists into workflow YAML. No Dax performance workload or expensive 8-vCPU
benchmark profiles are introduced; existing test assertions remain unchanged.

Both jobs source `scripts/load-provider-vault-secrets.sh` inside the test step,
then execute the existing commands:

```bash
pnpm --filter "$TEST_PROVIDER_PACKAGE" test
pnpm --filter computesdk test compute-provider-integration
```

## Credential selection

Each leg loads only its own allowlisted names, not every provider's secrets:

The registry's `requiredEnv` and `optionalEnv` fields list all credential
names. To inspect the complete credential mapping without revealing values:

```bash
jq 'with_entries(.value |= {requiredEnv, optionalEnv, aliases})' scripts/integration-providers.json
```

Examples include Vercel's token/team/project triple, Modal's token
pair, `MSB_API_KEY` for Microsandbox, `GMN_TOKEN` plus optional `GMN_API_HOST`
for GiveMeANode, and `NSC_TOKEN` for the Namespace provider itself.

The mappings follow `computesdk/benchmarks`' sandbox-tti workflow:
`ARCHIL_DISK_ID_SANDBOX` takes precedence over `ARCHIL_DISK_ID`, and
`BENCHMARKS_PLATFORM_API_KEY` is accepted when `COMPUTE_PLATFORM_TEST_API_KEY`
is absent. The latter must still meet the core test's dedicated-org/own-keys
configuration requirements; loading a key does not configure its org.
Direct-provider legs other than Archil also permit an optional
`COMPUTESDK_API_KEY` vault entry, matching their previous optional input.
Core legs do not load that optional key.

Inherited values for requested names are cleared first. Missing required names,
empty exports and authentication/list/export errors fail the step instead of
producing a green missing-key skip. GitHub provider-secret bindings are no
longer used in either matrix job.

## Authentication and safety

The generic loader was ported from `computesdk/benchmarks` (`master`),
`benchmarks/scripts/load-vault-secrets.sh`, source blob
`f27717b7b53ec8c3f02327bf7a59343ed296aebd`.

All matrix legs use the vault-enabled Namespace runner and pinned
`namespacelabs/nscloud-setup` action. Both jobs request `contents: read` and
`id-token: write`. They reuse `/var/run/nsc/token.json` or privately seed it
from the configured `NSC_TOKEN` secret (raw bearer or JSON). Missing
authentication fails explicitly; the token is never printed.

On Compute Actions, `NSC_TOKEN` must be available as an org/repo secret unless
the runner already supplies a suitable Namespace token. Workload-identity
repo/org opt-in and global settings are unchanged.

- Credentialed jobs only run on same-repository PRs, excluding changeset
  releases, after the mock job succeeds. Fork PRs cannot run these jobs.
- The runner grants remain vault-wide list/describe/reveal. The helper's
  allowlist limits routine exports, **not** what trusted PR code can access.
  These jobs must only execute trusted same-repository contributions.
- The loader ignores deleted objects, retains upstream duplicate-selection
  behavior, uses a private invocation-local envdef, and masks resolved values.
  Never enable shell tracing (`set -x`) around secret loading.
- Credentials stay in the test shell; they are not written to `GITHUB_ENV`.

## Repeatable offline verification

Prerequisites: Node.js, Bash and `jq`. Run from the repo root:

```bash
node --test scripts/test-namespace-vault.mjs
```

The checks execute the real loader and CI shell blocks with synthetic `nsc`
and `pnpm` executables. They cover both jobs and every provider, missing/empty
credentials despite stale environment values, benchmarks aliases, malformed
responses, auth/export failures, secret isolation/masking, token-file
permissions and fork guards. They use no live secrets or provider resources
and do **not** constitute a provider integration PASS.

Live acceptance still requires the existing integration jobs to run with
credentials, pass their assertions and reconcile their owned resources.

## Existing suite limitations

Loading keys does not turn mocked tests into live tests. The direct package
jobs run each package's existing suite: Daytona currently disables its shared
suite, and some packages (including Cloudflare, Miosa, Mosaic and OpenComputer)
only have mocked/unit suites. Novita's additional opt-in flag and Microsandbox's
local-backend integration gate are not overridden. The core integration job
is the common live create/execute/reconnect/destroy path for every configured
provider, independent of those package-specific test gates. No live integration
results are claimed by the offline credential checks.
