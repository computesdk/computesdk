# Namespace vault credentials in provider CI

## Scope

The E2B legs of the existing `.github/workflows/ci.yml` provider and ComputeSDK
integration jobs now load `E2B_API_KEY` from Namespace's vault. They run the
same existing commands:

```bash
pnpm --filter @computesdk/e2b test
pnpm --filter computesdk test compute-provider-integration
```

Other providers retain their existing credential sources. No provider tests,
assertions, dependencies, lockfiles or Actor prompts are changed.

## Authentication and delivery

This ports the pattern from `computesdk/benchmarks` (`master`),
`benchmarks/scripts/load-vault-secrets.sh`, source blob
`f27717b7b53ec8c3f02327bf7a59343ed296aebd`.

For E2B, the workflow:

1. Selects the Namespace runner with explicit vault list/describe/reveal grants.
2. Requests `contents: read` for GitHub checkout and `id-token: write` for
   Namespace's runner identity setup.
3. Reuses an existing `/var/run/nsc/token.json`, or privately seeds it from the
   configured `NSC_TOKEN` secret (raw bearer or JSON). Missing authentication
   fails explicitly. The token is never printed.
4. Runs the same pinned `namespacelabs/nscloud-setup` action as benchmarks.
5. Sources `scripts/load-vault-secrets.sh` **inside the test step**, then checks
   that `E2B_API_KEY` is nonempty before invoking the existing tests.

The direct provider leg also permits the optional `COMPUTESDK_API_KEY` vault
entry, matching its pre-existing optional environment input. The core E2B leg
only requests `E2B_API_KEY`. An inherited E2B value is cleared first so a stale
Actions/environment value cannot hide a missing Namespace entry.

On Compute Actions, `NSC_TOKEN` must be available as an org/repo secret unless
the runner already supplies a suitable Namespace token. The platform's
workload-identity bridge additionally requires its explicit repo/org opt-in;
this change does not alter that variable or any global settings. Placement on
Namespace by itself does not import vault entries.

## Safety and failure behavior

- Vault-capable integration jobs only execute for same-repository PRs.
  Fork PRs can still run the existing mock job, but cannot run these credentialed
  jobs. Non-E2B matrix legs retain the plain Namespace runner label.
- Only filtered names are exported. The helper ignores deleted objects,
  preserves the upstream duplicate-selection behavior, and registers loaded
  values with Actions masking before the test command runs.
- The port uses a private per-invocation temporary envdef, removes it on normal
  success/export failure, and does not log vault object handles on missing-value
  errors. Never enable shell tracing (`set -x`) around secret loading.
- Namespace authentication/list/export errors and missing/empty E2B keys fail
  the step, rather than producing a green “missing key” skip.
- The existing PR-only trigger, changeset-release exclusion, `needs: test`,
  provider matrices and test assertions remain intact. A manual dispatch is
  **not** made into a PR by this change.

## Repeatable offline verification

Prerequisites: Node.js, Bash and `jq`. Run from the repo root:

```bash
node --test --test-reporter=tap scripts/test-namespace-vault.mjs \
  > /tmp/namespace-vault-port.tap
```

These checks execute the real loader and CI shell blocks against synthetic
`nsc` and `pnpm` executables. They exercise successful delivery to both existing
test commands, stale values, missing/deleted/duplicate entries, malformed
responses, auth/export failures, masking, token-file permissions and fork
guards. They use no live secrets, create no provider resources, and do **not**
constitute a provider integration PASS.

Live acceptance still requires the existing E2B integration jobs to execute
with credentials on Namespace, pass their assertions, and reconcile their
owned resources. Root-job failures and manual-dispatch job gating are separate
from this credential-delivery port.
