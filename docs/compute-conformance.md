# Compute Actions: provider contract loop

This runs the **existing compute test suites against this SDK checkout**.
It does not install a published ComputeSDK candidate, ingest benchmarks, publish
packages, or certify an entire provider from a smoke test. Browser, storage and
Cloud Run are out of scope. Aliases are not executed twice.

## Current coverage and gates

`conformance/compute-profiles.json` accounts for all **55 canonical, in-scope
compute entrypoints in this checkout**. These are not 55 independent companies.

* **20 configuration-wired** profiles have reviewed factory/credential mappings.
* **35 configuration-blocked** profiles require reviewed setup first.
* Of the 20, only **5 shared-suite execution candidates** have source-reviewed
  lookup/delete error handling suitable for SDK-absence checks: CreateOS,
  E2B, Isorun, NeevCloud and Sandbox0. The other 15 remain cleanup-blocked.
* **No live result is established by this catalog.** Source review is not
  account approval, native verification or physical-deletion proof.

All 55 remain visible in an `all` plan; blocked entries do not silently disappear.
Selection flags mean tests are selected, not that a capability is certified.
Background, streaming and interactive-process tests are currently unselected;
that does not declare them unsupported.

The shared suite checks creation/identity, command execution/quoting, info and
selected filesystem/URL cases. URL cases currently check syntax, not HTTP
reachability or authentication. CodeSandbox and Agentuity URLs are unselected
because their synthesized fallbacks are not sufficient native preview evidence.
Snapshots, pause/resume, volumes, resource entitlement, runtime prerequisites,
transport-failure behavior and cancellation need additional reviewed cases.

The optional existing CRUD suite is initially enabled only for **Isorun**.
E2B CRUD remains blocked: its list implementation still has independent gaps.
E2B positive lookup retains its existing native `connect` behavior, which can
resume a paused sandbox or renew its timeout; it is not a pure inspection API.
Its absence path uses typed metadata-not-found before any connection attempt.

## Local, source-only preparation

From the SDK repository root:

```sh
node scripts/compute-conformance.mjs plan --provider all
node scripts/compute-conformance.mjs plan --provider isorun
node scripts/compute-conformance.mjs fingerprint
```

These commands do not import providers, load credentials or make provider calls.
`pnpm check:compute-conformance` checks the catalog, acceptance gates, native
entrypoint types and fake-tool credential/bootstrap regressions after a build.
`pnpm test:provider-contracts` runs an explicit local-only mocked whitelist;
framework fixtures and adapter mocks are not native-provider evidence.

The source fingerprint covers workspace production sources, dependency lock,
build configuration, inventory, profiles, native harness and workflow. It
includes new text files sent by `--with-changes`, but excludes generated bundled
configs and result artifacts. It is not a hash of the operating system or the
remote provider service. Built artifact hashes and installed dependency versions
are recorded separately in the live result.

## Remote preparation and approval

Workflow: `.computesdk/workflows/provider-conformance.yml`.
It is manual, serial and defaults to `execute=false`.

First enable `computesdk/computesdk` in Compute Actions if it is still disabled.
Review the repository's other discovered workflows before enabling automatic
triggers. Enabling, dispatching, publishing and pushing are separate operations;
this work does not perform them.

The workflow reuses the benchmarks' credential route: the declared org
`NSC_TOKEN` bootstraps Namespace Vault **inside the remote Actions job**.
Provider keys are not expected to exist directly in Compute's secret list.
Only missing names for the selected profile are exported; deleted and unrelated
entries are ignored, ambiguous active names block execution, and missing optional
entries do not invalidate required configuration that is already present.
Secret values stay in shell memory and are masked; no raw credential/error
JSON is uploaded. The temporary vault envdef contains names/object IDs only.
The bootstrap token is an ephemeral, permission-restricted remote auth file;
only a file created by this job is removed by its cleanup step.

SDK build/typecheck precedes vault authentication. Profile, cleanup-review,
candidate-fingerprint and positive SDK-create-budget gates precede bootstrap.
The native entrypoint repeats its gates before importing a provider.

The following are **operator examples, not executed runs**:

```sh
# Preparation only: Actions runner compute still costs money.
compute actions dispatch computesdk/computesdk \
  --org computesdk --workflow .computesdk/workflows/provider-conformance.yml \
  --ref main --with-changes --inputs provider=isorun execute=false --json
```

The no-execute matrix is a fully excluded nonempty vector. The inspected
Actions parser/scheduler gives it zero conformance legs; the plan job still
runs. Do not replace it with an empty include or rely on job `if` alone:
job conditions can be evaluated only after a runner has been provisioned.
Control-plane source compatibility has been checked, not deployed behavior.

After explicit account, spend and retention approval, start with **one provider,
one suite**. This CRUD example requests at most one forwarded SDK create:

```sh
SOURCE=$(node scripts/compute-conformance.mjs fingerprint)
compute actions dispatch computesdk/computesdk \
  --org computesdk --workflow .computesdk/workflows/provider-conformance.yml \
  --ref main --with-changes \
  --inputs provider=isorun suite=crud execute=true \
    expected_source="$SOURCE" max_create_attempts=1 --json
```

`--with-changes` sends the same repository's working tree beyond `origin/main`,
including local commits and new text files, then applies it after checkout.
Use the exact workflow path while it is new; the CLI/platform support a workflow
carried in that patch even when it has no existing catalog entry. `main` must
exist remotely; the local review branch need not be pushed. Inspect the diff
first: the candidate may intentionally differ from newer remote-main changes.
The remote fingerprint must match the local candidate before workloads run.
An explicit repository/workflow disable still blocks dispatch.

`max_create_attempts` is **per selected provider** and counts forwarded SDK
create requests, not native retries, builds, actual VM counts, API calls, storage
retention, Actions allocations or dollars. Native service behavior and account
configuration can add costs. A client deadline is not remote cancellation.
Do not execute `provider=all` as a first canary.

## Result and cleanup interpretation

The workflow uploads sanitized JSON artifacts containing case names/states,
source/artifact hashes and installed versions. Success requires every selected
required case exactly once, zero skips/errors/hook failures and a successful
Vitest process. One passing native smoke case cannot substitute for the suite.
Retry is zero; missing credentials and blocked configuration are not passes.

Shared-suite verification requires a positive SDK lookup matching the newly
owned ID before testing, then bounded exact `getById(id) === null` after
destruction. Authentication/network errors must propagate in eligible lookup
implementations. Generic consumers without these verification callbacks still
establish only destroy acknowledgement. Neither path proves physical deletion,
cessation of billing, or correctness of the vendor's server response.

A private resource journal records SDK create requests and IDs returned to the
suite, without SDK objects, credentials or raw errors. Post-allocation journal
failure never hides a returned instance from cleanup; it instead fails the
result through a separate hook. Shared absence observations are marked
`sdk-reported-absent`. CRUD absence is established by its case/cleanup checks;
the journal currently retains `returned` rather than duplicating that signal.
Keep IDs private and use them to investigate failed cleanup.

If native allocation succeeds but the SDK rejects without returning an ID, the
journal cannot recover it. Hard termination can prevent late cleanup or artifact
upload. Bootstrap/build failures currently finalize as generic workflow failure;
inspect the failed stage rather than attributing them to provider correctness.
No local test, source audit or mock can eliminate these operational limits.

The first milestone is one baseline and candidate run with defensible evidence,
then fix → rerun the failing provider/case → rerun its selected suite. Expand
configuration and contract coverage in reviewed batches. These manual workflows
do **not yet enforce an automatic publishing/release gate**, and their artifacts
do not automatically promote historical inventory verification statuses.
Do not relax cleanup gates just to run an unsafe baseline: use a reviewed
baseline or provide a separate, reviewed native cleanup oracle first.

## Test-suite migration

`skipIntegration: true` now really skips native work instead of substituting a
canned sandbox. For deliberate framework assertion self-tests, use:

```ts
runUnitTests({ provider, name: 'example' }); // framework-mocked, not adapter proof
```

Use `runIntegrationTests` only for an explicitly configured/approved native
invocation. Per-invocation suites are sequential even under caller concurrency,
and cleanup errors now fail instead of disappearing. Full test names include
the execution mode, so update name filters/snapshots accordingly.
