# Compute Actions: provider contract loop

This runs the **existing compute test suites against this SDK checkout**.
It does not install a published ComputeSDK candidate, ingest benchmarks, publish
packages, or certify an entire provider from a smoke test. Browser, storage and
Cloud Run are out of scope. Aliases are not executed twice.

## Current coverage and gates

`conformance/compute-profiles.json` accounts for all **55 canonical, in-scope
compute entrypoints in this checkout**. These are not 55 independent companies.

* **35 configuration-wired** profiles have reviewed factory/credential mappings.
* **20 configuration-blocked** profiles require reviewed setup first.
* Of the 35, **8 shared-suite execution candidates** have source-reviewed
  cleanup observations: SDK absence for Blaxel, E2B, Isorun, NeevCloud, Sandbox0,
  Sprites and Vercel; explicit fresh `destroyed` metadata for CreateOS.
  The other 27 remain
  cleanup-blocked. These are current development-tree reviews; a frozen older
  candidate retains its own smaller catalog and fingerprint.
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
Installed e2b 2.30.1 can derive that typed error from body `code: 404` before
checking actual HTTP status, and its connect handle stamps the requested ID.
Neither adapter mocks nor handle equality establish raw HTTP auth provenance or
returned wire identity. The same native limitation applies to Lelantos.

CreateOS retains metadata after destruction. Its reviewed cleanup oracle accepts
only exact SDK null or the owned ID's fresh
`getInfo().metadata.createosStatus === 'destroyed'`. SDK `stopped`, native
`destroying`/`paused`, an acknowledgement, or a lookup error do not qualify.
The journal distinguishes **native-reported terminal** from **SDK absence**;
neither proves physical reclamation or the end of billing. Other profiles cannot
opt into this oracle.

### Recorded first live wave: November 3, 2026

These results belong to frozen candidate `368e5ff2`, source fingerprint
`8b913ad3a420cbc2150b6a587cc93f92836142b52d86be7ed8fc1e7a0a725d6d`.
They do not certify this newer development tree or unselected capabilities.

| Provider / suite | Result | Actions run |
| --- | --- | --- |
| Isorun / CRUD | 5/5 required cases | `0fc73e4f-250b-4db8-b7fa-f7d9326bdcdd` |
| Isorun / shared | 15/15 required cases | `f9b36664-6be2-4604-9e15-2d175cd4c57b` |
| E2B / shared | 15/15 required cases | `2cb82d06-97b7-46a1-ab39-41891db2f6d7` |
| Sandbox0 / shared | 13/13 required cases | `3f8ee3d1-fc60-4631-bc7c-04fe9c569fc5` |
| CreateOS / shared | Failed afterEach: old SDK-null cleanup oracle | `27c62172-5b6c-45d4-8238-c7144f4f2ef3` |
| NeevCloud / shared | Blocked before native entry: required vault metadata absent | `6d117c9f-f8aa-48db-afe3-a8126484e7c5` |

The three passing shared suites have zero missing/skipped required cases and
43 unique owned IDs subsequently journaled as SDK-absent. The separate CRUD
pilot used one SDK create and explicitly verified SDK absence. NeevCloud used
zero SDK creates by verified stage ordering; no provider behavior was tested.

Fixed-ID, zero-create recovery run `899173ca-65b7-4ef4-9a37-89364df36732`
observed CreateOS metadata **already destroyed before** its supplemental DELETE,
with the destruction timestamp during the original test. This supports the
retained-terminal oracle correction; the original shared run remains failed,
not retroactively passed. Its new oracle still requires a new candidate run.
The expected `NEEV_API_KEY`, `NEEV_ORG_ID` and `NEEV_PROJECT_ID` metadata names
were all absent; provision them remotely before retrying that provider.

The first wave observed **45 forwarded SDK creates**, not a count of physical
VMs, native retries, Actions workers or dollars. Recovery journals and raw logs
remain private; use each run's curated artifacts for evidence.

Additional explicit limits:

* Modal polls for existence but exposes raw RPC failures without a public
  nullable-absence discriminator; Beam's connection failures likewise lack one.
* HopX native error heuristics can obscure true missing responses, and its
  connect-based destroy cannot handle a stopped sandbox. Do not guess absence.
* Daytona public get can first find a sandbox and then receive a generic 404
  fetching toolbox metadata. Every such error now propagates; nullable lookup
  remains unresolved. Delete defaults to acceptance rather than waiting.
* Microsandbox lookup establishes persisted native database-handle state, not a
  fresh remote cloud VM query. That distinction prevents cloud-absence approval.
* Vercel destroy permanently deletes the sandbox instead of stopping a resumable
  session. It explicitly retains orphan snapshots and separately owned drives.
* Blaxel 404 bodies without their optional numeric code remain errors rather
  than invented absence. A returned delete model is acknowledgement only.

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
local preparation does not perform them. The live campaign records separately
identify explicitly dispatched runs.

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
