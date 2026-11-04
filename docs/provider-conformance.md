# Provider inventory and conformance visibility

This is a **machine-checked inventory coverage guard**, not a provider compatibility
certification. It reads package manifests and source text; it never imports or
executes adapters, vendor SDKs, or adapter tests. It needs only Node.js 18+,
without dependencies, builds, credentials, containers, or network access.

```sh
pnpm check:provider-conformance
```

That blocking command checks the current roster and runs the pure Node fixture
tests. For deterministic JSON without the fixture-test output:

```sh
node scripts/check-provider-conformance.mjs
node --test scripts/__tests__/provider-conformance.test.mjs
```

## Current accounting

The main source baseline is `2cec1227e6226802d5ae429a57faa6ac05d0fe91`; `conformance/providers.json` is the
machine-readable roster. Current checked counts:

| Measure | Count |
| --- | ---: |
| Package manifests under `packages/*` | 78 |
| Public adapter entries | 70 |
| Compute entries (including two deprecated reexports) | 58 |
| Browser entries | 9 |
| Infrastructure adapter entries | 0 |
| Storage entries | 3 |
| Explicit non-adapter utility/framework package exclusions | 9 |
| Omitted discovered adapter entries | 0 |
| Cloud Run entries explicitly excluded from compatibility review | 2 |
| Entries included in compatibility review | 68 |
| Included entries without a scoped adapter-mocked/native run (**uncovered**) | **51** |
| Included entries without whole-provider native certification | 68 |
| Roster entries currently `unknown` | 53 |
| `declared` / `adapter-mocked` / `native-verified` entries | 0 / 17 / 0 |

These are public entry counts, not independent backend counts: deprecated
`@computesdk/agentcore` forwards to `@computesdk/aws/agentcore`.
Both `@computesdk/gcp/cloud-run` and deprecated `@computesdk/cloud-run` are
accounted for, but **explicitly excluded from this compatibility review**.
Their presence makes no claim of Cloud Run support.

Seventeen current entries have explicitly recorded **limited, mocked reliability regressions**;
all other entries remain `unknown`. No native provider has been certified.
Inventory checks do not execute these adapter regressions. An adapter test
file's presence, a generic factory mock, a build, or a source fix alone does
not promote a status.

Main replaces Declaw with Agent37, leaving entry counts unchanged. Agent37
is `unknown`, with source-reviewed configuration wiring but no adapter-mocked
or native qualification. Declaw's unchanged historical record is archived at
`conformance/runs/historical/removed-declaw/declaw.json` and is not current
inventory or an executable suite. All retained records qualify only their
recorded revisions and artifact hashes, not this integrated source.

## Reliability regressions shipped with these patches

This series hardens existing SDK behavior. It does not introduce build, image,
artifact-registry, or new provider primitives.

For the compute-only live Actions loop and its separate configuration/cleanup
gates, see [Compute conformance](./compute-conformance.md). The local counts
below are not live Actions results.

After the normal full workspace build, run:

```sh
pnpm test:provider-contracts
```

CI runs this command separately from the inventory guard. It selects explicit
adapter/native-mocked and shared helper/core unit files, not package-wide
integration scripts. It disables the core integration gate and blanks relevant
provider credentials including E2B and the Sprites/Sandbox0 token fallbacks.
Sprites uses bounded local stdin-fed bash fixtures; Daytona uses bounded local
bash/sh command-string fixtures. Neither calls a live provider.

The following table is historical pre-main-integration evidence, not a claim
that this checkout executed that selection. Declaw is no longer selected.
The current explicit whitelist also retains main's sizing, legacy-type,
Archil sizing and Namespace snapshot regressions.

| Historical scope | Recorded passing checks |
| --- | ---: |
| Shared suite ownership, deadlines, cleanup and concurrency regressions | 60 |
| Shared byte-count/child-status helper | 49 |
| Shared snapshot metadata/affinity core units | 42 |
| E2B snapshot/template and instance lookup/delete regressions | 118 |
| Modal native-mocked unit/regression files | 109 |
| Isorun command-capture regressions | 80 |
| CreateOS command-capture regressions | 85 |
| Sandbox0 native-mocked unit/regression file | 66 |
| Microsandbox command/lifecycle unit regressions | 113 |
| Sprites shell/protocol and HTTP lifecycle regressions | 49 |
| Daytona shell/protocol and lifecycle propagation regressions | 110 |
| Vercel command completion and permanent-deletion regressions | 66 |
| HopX command completion and lifecycle regressions | 103 |
| Beam command completion and lifecycle regressions | 54 |
| Blaxel command completion/stream and lifecycle regressions | 118 |
| Agentuity HTTP lifecycle/protocol regressions | 89 |
| Declaw native-boundary lifecycle regressions | 90 |
| Tensorlake lifecycle and existing streaming checks | 315 |
| Leap0 HTTP lifecycle regressions | 109 |
| Lelantos lifecycle and existing forwarding/env checks | 136 |
| Upstash full Box HTTP lifecycle regressions | 120 |
| **Total selected checks** | **2,081** |

These totals include existing unit checks; they are not 2,081 new tests or
2,081 native executions. Recorded adapter evidence is under
`conformance/runs/local-mocked/`: eight lifecycle-expanded records target
production/test revision `ea98a93a`; E2B retains `3f05eda6`, and Isorun,
CreateOS and Sandbox0 retain `1a472184`. The six additional lifecycle records
target component/test revision `61c9176a`; they include exact mock-boundary
limits and known vendor information erasure.
The helper, harness and core units do not count as adapters. Separately, the
compute Actions gate runs 38 pure Node checks and 66 local cleanup-probe
self-tests. Those are not native-provider executions either.

The lifecycle batch adds 285 named regressions across eight existing adapters.
It propagates previously masked lookup/delete failures, validates native
identities and preserves documented acknowledgement semantics instead of
inventing successful deletion. Vercel uses permanent delete, not resumable stop,
while retaining snapshots and separately owned drives. Independent callgraph
review caught Daytona's positive sandbox lookup followed by a secondary toolbox
404; all public-get errors now propagate because that generic 404 cannot prove
sandbox absence. Only Blaxel, Sprites and Vercel gained source-reviewed
SDK-absence eligibility; that is not a live result. Modal, Beam, HopX, Daytona
and cloud Microsandbox remain cleanup-blocked for the explicit reasons in the
compute profile catalog. None of this proves physical deletion or billing
cessation.

The compute-loop batch removes canned native-success substitution and caller-
scope hooks, fences per-attempt ownership/deadlines and fails cleanup errors.
Native Actions supplies positive SDK lookup and reviewed post-destroy
observations: SDK absence, or explicitly scoped fresh CreateOS `destroyed`
metadata. Those outcomes are separately journaled and never equated with
physical/billing cleanup. Ordinary consumers without those callbacks establish only
destroy acknowledgement. E2B instance lookup/delete now propagate service
failures rather than invent absence/success. Its existing positive connect
side effects and separate list gaps remain explicit.

The second reliability batch closes these specific gaps:

* Modal, Isorun, CreateOS, Sandbox0 and Microsandbox now require successful native
  capture-read completion, not just plausible text or matching byte counts.
  Failed reads cannot certify empty output, lengths, or child exit status.
* Daytona rejects missing child completion when native status is absent,
  malformed or zero. An explicit native failure remains useful failure
  information; it is not proof of child completion.
* E2B snapshot inventory uses the actual native snapshot paginator and validates
  pages/IDs. Deletion uses the actual native snapshot method, propagates
  failures, and accepts its documented boolean not-found result.
* Core `snapshot.list()` omits unknown `createdAt` and rejects invalid dates.
  **The public timestamp is now optional; consumers must guard its absence.**
  Snapshot creation behavior is unchanged.
* Existing E2B template list/delete no longer invent empty inventory or cleanup
  success when legacy hooks are absent. They fail explicitly as unimplemented
  by this adapter, without adding a builder or aliasing templates to snapshots.

Primary installed SDK contracts were inspected for the five capture readers,
Daytona and E2B. E2B evidence targets installed **2.30.1**, not the separately
observed consumer 2.57 version or every version allowed by its dependency range.
Controlled legacy-template shims test forwarding/error behavior only; those
methods are absent from the inspected E2B SDK.

The next batch adds bounded, existing-contract safeguards:

* Known snapshot restore/delete and known-instance snapshot creation stay with
  the recorded provider and preserve original owner errors. Snapshot-ID
  collisions reject automatic routing rather than overwriting ownership.
  Ownership is **in-memory only** and resets on reconfiguration. Unknown IDs
  keep legacy discovery/fallback; provider-name deduplication, general instance
  routing and instance-ID collision policy are unchanged. This is not global
  resource isolation or a persistent provider-qualified reference. In-flight
  operations racing reconfiguration are not addressed by these checks.
* Vercel validates foreground status but preserves explicit detached-null launch
  acknowledgements. HopX validates output/status and does not turn a caught
  exception with synthetic zero metadata into success. Legacy nonzero
  `error.result` cases are compatibility tests, not an inspected native contract.
* Beam requires the numeric native `wait()` result rather than startup state;
  Blaxel requires terminal state plus an explicit valid final numeric exit code.
  Missing or contradictory metadata rejects instead of guessing success/failure.
  Valid native negative/signal codes remain where the native contract permits
  them; Beam's negative running sentinel is not a completed result.
* Modal provider-backed command preflight reports unsupported timeout precision
  before native exec rather than synthesizing guest exit127. Positive whole
  multiples of 1000 milliseconds and omission pass unchanged; no rounding,
  shared zero policy or new remote cancellation support is introduced.

Vercel 3.8.0 and Beam 1.0.22 already normalize some missing wire values to zero
inside their native libraries. Adapter-boundary mocks cannot recover that
information and do not establish raw-wire integrity. HopX evidence targets
0.5.1 and Blaxel targets 0.3.21; dependency-range compatibility remains unverified.

The full workspace build, root-configured typecheck and affected-adapter
typechecks pass. Two **pre-existing, unchanged** CreateOS `index.test.ts`
ingress-default assertions still fail (tests expect `true`, implementation
defaults to `false`); they are not included in this narrow regression command.
The core unit suite also passes (61 passed, 5 integration tests skipped), as do
124 explicitly selected shared-provider unit checks from the prior batch.
Nine Beam readiness units pass with the integration suite explicitly filtered
out and credentials blank; their numeric-wait fixture now matches the inspected
native contract. These auxiliary runs do not increase the selected 1,222 total:
some repeat table checks, while Beam readiness is a separate filtered suite.
Do not sum their counts. The entire root test command was not run as part of
this local-only check.

Important remaining gaps include live native behavior, upstream SDK wire
normalization, same-length corruption, early failure cleanup, remote
timeout/cancellation, and Sandbox0 context-versus-stream precedence. Microsandbox
timeout-124 output deliberately remains best-effort, not verified completed
output. A fallback native Daytona failure does not establish complete child
streams. The twelve roster entries preserve provider-specific limitations.

## Discovery and provenance

`scripts/check-provider-conformance.mjs` independently scans production source
under every current package rather than using the roster to choose what to scan.
Tests, declarations, fixtures, mocks, generated output, and dependencies are
excluded from production-source discovery.

| Surface | Source declaration inspected | Framework definition |
| --- | --- | --- |
| Compute | Assignments to `defineProvider`, including imported aliases and wrapped factories | `packages/provider/src/factory.ts` |
| Browser | Assignments to `defineBrowserProvider` | `packages/provider/src/browser-factory.ts` |
| Infrastructure | Assignments to `defineInfraProvider` (none currently) | `packages/provider/src/infra-factory.ts` |
| Storage | Exported factory functions returning interfaces extending `StorageProvider` | `packages/provider/src/types/provider.ts` |

Factory exports are inspected in `packages/provider/src/index.ts`.
The storage implementations are handwritten factories in `s3`, `r2`, and
`tigris`; there is no `defineStorageProvider` call to count.
AWS's `agentcore` and `ec2` subpaths are separate entries. GCP's `cloud-run`
subpath and the platform adapter's local export barrel are checked explicitly.
Deprecated package-level `export *` adapter reexports are separate entries
with an `aliasOf` relationship, not independent native implementations.

Every entry names its actual source file, factory binding and mechanism,
public import specifier, source entrypoint, and exported symbol. The guard
checks these against discovered declarations, package `exports.import` targets,
and local public reexport chains. Source evidence is checked for an existing
file and an exact anchor; a renamed or deleted anchor fails.

The nine explicit package exclusions are `cli`, `cmd`, `computesdk`,
`create-compute`, `daemond`, `events`, `provider`, `test-utils`, and `workbench`.
Their reasons are stored in the roster. Exclusions cannot hide a discovered
adapter, and newly added packages must be classified.

Each entry also has a nonempty `gaps` list and `knownUnsupported` evidence.
Only a few explicit source-level limitations have been recorded so far
(Cloudflare listing/port forwarding, Modal listing, E2B legacy-template hooks,
and Upstash ephemeral previews/direct template creation).
**An empty `knownUnsupported` list means
not inventoried, not that every operation is supported.** These source
declarations are not native behavior verification.

## Statuses and claims

Statuses are separate from inventory coverage and default to `unknown`:

* **`unknown`**: no adapter-scoped conformance run recorded.
* **`declared`**: source/documentation declaration only; still unverified and
  counted as uncovered.
* **`adapter-mocked`**: an explicitly recorded passing adapter-scoped mocked run;
  not a native-provider result and not blanket compatibility.
* **`native-verified`**: an explicitly recorded passing native-provider run,
  limited to the named tests/claims; requires separate approval to perform.

Source provenance in an `unknown` entry is intentional: discovery does not
silently upgrade it to `declared`. Likewise, aliases do not inherit another
entry's verification automatically.

Nonempty `claims` require one of the two verified statuses. Unknown status
values, arbitrary fields such as `supported: true`, stale provenance, and
verified statuses without a run record fail the guard.

A future verification record must be an existing JSON file referenced by
`verification.file` with its SHA-256 in `verification.sha256`. Its fields are
`provider` (the exact roster ID), `status`, `result: "passed"`, `command`,
`revision`, `recordedAt`, and a nonempty `tests` array of `{file, contains}`
evidence pointing to tests within that adapter's package. A generic
`packages/provider` test cannot stand in for another package's adapter tests.
Mocked runs leave native verification uncovered.

The checker validates this record's shape, hash, scope, and source anchors;
**it cannot prove that a recorded command actually ran or that its tests
cover the claimed semantics**. Records are **historical and revision-specific**:
they do not certify the current/future tree, every capability, or native
behavior. The recorded input hashes aid manual provenance review; the guard
does not compare those hashes to every current source/dependency input.
Reviewers must inspect test contents, execution results and the named revision.
The twelve scoped statuses here record only the separately executed local mocked
regressions above. No native calls or native-verification promotions were made.

## Guard behavior and limits

The fixture suite checks current positive coverage; omitted existing/new
adapters and unclassified new packages; duplicate IDs/targets; stale source,
public exports, and evidence; unsupported support claims; missing verification;
generic-mock substitution; explicit Cloud Run exclusion; storage/infra/browser
discovery; aliased imports; and nested template literals, escaped shell quotes,
regular expressions, comments, and string decoys. Fixture adapters deliberately
throw at module scope: inspecting them must not execute them.

The scanner is a small lexer, **not a full TypeScript parser or semantic
conformance runner**. It recognizes the repository's current factory
assignments, storage-interface factories, local export barrels, and package
`export *` adapter reexports. Template literals are walked with nested
interpolations but remain opaque for adapter discovery; regexp recognition
uses expression-start contexts. New factory kinds, unfamiliar factory call
shapes, ambiguous bindings, and unresolved adapter reexports fail closed.
Novel handwritten adapters or indirect factory aliases added inside an
already-accounted package may require an explicit scanner extension; arbitrary
dynamic exports and control-flow semantics are outside this guard.

When adding an adapter, add a distinct roster row with checked provenance,
`status: "unknown"`, explicit review scope, honest gaps, and no support claims.
Update the accounting snapshot/test assertions and this document. Extend the
scanner and its fixtures if the adapter uses a genuinely new source pattern.
Run the blocking command and separately report any approved adapter-specific
test results. The existing CI invokes the same blocking command.
