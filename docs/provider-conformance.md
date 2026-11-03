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

The source baseline is `41a638cc`; `conformance/providers.json` is the
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
| Included entries without a scoped adapter-mocked/native run (**uncovered**) | **61** |
| Included entries without native verification | 68 |
| Roster entries currently `unknown` | 63 |
| `declared` / `adapter-mocked` / `native-verified` entries | 0 / 7 / 0 |

These are public entry counts, not independent backend counts: deprecated
`@computesdk/agentcore` forwards to `@computesdk/aws/agentcore`.
Both `@computesdk/gcp/cloud-run` and deprecated `@computesdk/cloud-run` are
accounted for, but **explicitly excluded from this compatibility review**.
Their presence makes no claim of Cloud Run support.

Seven entries have explicitly recorded **limited, mocked command regressions**;
all other entries remain `unknown`. No native provider has been certified.
Inventory checks do not execute these adapter regressions. An adapter test
file's presence, a generic factory mock, a build, or a source fix alone does
not promote a status.

## Command regressions shipped with this patch

After the normal full workspace build, run:

```sh
pnpm test:provider-contracts
```

CI runs this command separately from the inventory guard. It selects explicit
native-mocked test files, not package-wide integration scripts, and blanks
provider credential variables including the Sprites/Sandbox0 token fallbacks.
Sprites uses bounded local stdin-fed bash fixtures; Daytona uses bounded local
bash/sh command-string fixtures. Neither calls a live provider.

| Scope | Passing checks |
| --- | ---: |
| Shared byte-count/child-status helper | 49 |
| Modal native-mocked unit/regression files | 27 |
| Isorun command-capture regressions | 21 |
| CreateOS command-capture regressions | 21 |
| Sandbox0 native-mocked unit/regression file | 41 |
| Microsandbox native-mocked unit/regression file | 62 |
| Sprites shell/protocol regressions | 17 |
| Daytona shell/protocol regressions | 42 |
| **Total selected checks** | **280** |

These totals include existing unit checks; they are not 280 new tests or
280 native executions. Recorded adapter evidence is under
`conformance/runs/local-mocked/`, against production/test revision `1fc03020`.
The helper is a framework utility, not an eighth verified adapter.

The full workspace build, root-configured typecheck and affected-adapter
typechecks pass. Two **pre-existing, unchanged** CreateOS `index.test.ts`
ingress-default assertions still fail (tests expect `true`, implementation
defaults to `false`); they are not included in this narrow regression command.
The entire root test command was not run as part of this local-only check.

Important remaining gaps include successful native `cat`/empty-read semantics,
same-length corruption, early failure cleanup, remote timeout/cancellation,
Sandbox0 context-versus-stream precedence, and Daytona's missing-footer native
fallback. The seven roster entries preserve provider-specific limitations.

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
(Cloudflare listing/port forwarding, Modal listing, and Upstash ephemeral
previews/direct template creation). **An empty `knownUnsupported` list means
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
The seven promotions here record only the separately executed local mocked
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
