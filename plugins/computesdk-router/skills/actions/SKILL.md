---
name: actions
description: Work with the org's ComputeSDK Actions CI runs from ChatGPT — list connected repos and workflows, dispatch workflow runs, watch runs, read job logs, cancel and re-run. Use when the user asks about CI status, a failing run, or wants to kick off a workflow.
---

# ComputeSDK Actions (CI)

Actions runs GitHub-Actions-style workflows on ComputeSDK sandboxes. The org's
repos are connected through the ComputeSDK GitHub App — only repos already
synced there are visible; there is no GitHub auth in chat.

If the org has never connected anything, list/get tools return a `setup`
block (`reason: "no_git_connection"`) with a message and an
`actionsSettingsUrl`. Surface it to the user as-is — an org owner or admin
must install the GitHub App and enable repos there before any actions tool
returns data.

## Core workflow

1. `actions_list_repos` — the org's connected repos (enabled or not, with
   their discovered workflow paths). Then `actions_list_workflows`
   (optionally scoped by `repoFullName`) for the runnable workflows — each
   carries `dispatchable` and its `inputs`.
2. `actions_list_runs` — recent runs, newest first. Filters: `repo`,
   `refs`, `statuses` (`passed|failed|running|cancelled|none`), `query`.
   `actions_get_run` returns one run with jobs, steps, and the output tail.
3. `actions_get_job_logs` — a job's log. Defaults to the last 64 KB; logs
   can be huge — read the tail first, page forward with `fromOffset` when
   the user wants an earlier section. `stepOrdinal` narrows to one step
   (0-based). Output is already secret-redacted.
4. `actions_list_job_artifacts` — a job's artifacts with sizes and expiry.

## Dispatching and managing runs (org owners/admins only)

- `actions_dispatch_workflow` — pass a stored `workflowId`, or
  `repoFullName` + `workflowPath` for a file that exists only on the
  dispatch ref. `ref` is required; `inputs` are the workflow_dispatch
  values. `manual: true` runs a workflow that doesn't declare
  `workflow_dispatch`.
- `actions_rerun_run` and `actions_cancel_run` take a `runId`.

**Confirm before dispatching or re-running** — a run consumes real compute.
A 403 on a write means the user isn't an org owner/admin; tell them, don't
retry.

## Workflow details

- Runs are org resources: the user sees every run in the org, including ones
  other members started. "Not found" on an id from another org is expected.
- A dispatched run may take a moment to start reporting jobs — poll
  `actions_get_run`, don't re-dispatch. A duplicate dispatch with the same
  `requestId` returns the existing run instead of a second one.
- A run's `blockedReason` explains refusals (e.g. no usable provider,
  fork-PR policy); a job's `failureReason` explains a refused placement.
- Never print, echo, or write secrets — not in commands, inputs, files, or
  tool output.
