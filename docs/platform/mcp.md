---
description: >-
  Connect Claude, ChatGPT and other AI assistants to the ComputeSDK Platform
  through its remote MCP server: run code in cloud sandboxes, work with
  Actions CI, check provider keys and read benchmark results.
---

# MCP server (Claude, ChatGPT and other assistants)

The ComputeSDK Platform has a remote [Model Context Protocol](https://modelcontextprotocol.io) server. Connect it to an AI assistant and the assistant can create cloud sandboxes, run commands and long-running processes, read and write files, share a preview URL for a server it starts, work with your org's Actions CI runs, show which provider keys are connected, and read benchmark results.

**Server URL:** `https://platform.computesdk.com/mcp` (streamable HTTP)

Nothing runs on your computer: every tool call goes to this server, and commands run inside cloud sandboxes.

## Connect

### Claude

- **Claude (web and desktop):** add ComputeSDK Router from the connectors directory, or go to **Settings → Connectors → Add custom connector** and enter the server URL.
- **Claude Code:** install the plugin, which adds the server and skills that help Claude use the tools well:

  ```
  /plugin marketplace add computesdk/computesdk
  /plugin install computesdk-router@computesdk
  ```

  Or add only the server: `claude mcp add --transport http computesdk https://platform.computesdk.com/mcp`

### ChatGPT

Install the **ComputeSDK Router** app from the ChatGPT apps directory. In developer mode you can also add the server URL as a custom MCP app.

### Other MCP clients

Any client that supports remote MCP servers with OAuth works: point it at the server URL. Clients that can send headers can use an org API key instead of OAuth (`Authorization: Bearer <key>`); create one under **Settings → API keys** on the platform.

## Sign-in and permissions

The first time the assistant uses a tool, a ComputeSDK sign-in opens in your browser:

1. Sign in to your ComputeSDK account.
2. Choose the organization the connection uses. Usage is billed to that org.
3. Approve the permissions:

| Permission | Scope | Allows |
|---|---|---|
| Read sandboxes | `sandboxes:read` | List and inspect your sandboxes, files, processes and URLs |
| Use sandboxes | `sandboxes:write` | Create and destroy sandboxes, run commands, write files, manage processes |
| Read Actions | `actions:read` | Read CI runs, jobs, logs and settings |
| Manage Actions | `actions:write` | Dispatch, cancel and re-run CI runs; change Actions settings |
| Read providers | `providers:read` | Provider key status and rates |
| Manage providers | `providers:write` | Verify or remove provider keys, set reporting rates |
| Read benchmarks | `benchmarks:read` | Benchmark runs and results |
| Stay signed in | `offline_access` | Keep the connection after you close the browser |

**Read-only access:** turn on **Read-only access** on the approval screen to grant only the read permissions (plus staying signed in). The assistant can then look but can't create, run, change or delete anything. Connect again without it to allow changes.

Settings changes, provider keys and repo controls also need you to be an org owner or admin. To disconnect, remove the app in **Settings → Connected apps** on the platform, or remove the connector in your assistant.

## What the assistant can do

**Sandboxes**

- See what you can run on and what each size costs (`sandboxes_get_options`), and price one create (`get_quote`).
- Create a sandbox (`create_sandbox`), on the router's choice or a provider you name, on your own keys or ComputeSDK's managed accounts.
- Run commands (`run_command`), start long-running processes (`start_process`, `process_status`, `wait_process`, `kill_process`, `write_process_stdin`), and work with files (`write_file`, `read_file`, `make_directory`, `remove_path`).
- Get a public preview URL for a port a server listens on (`sandbox_url`).
- List, inspect and destroy sandboxes (`list_sandboxes`, `get_sandbox`, `destroy_sandbox`), and see spend (`sandboxes_get_costs`).

**Actions (CI)**, for repos connected through the ComputeSDK GitHub App:

- List repos, branches, workflows, runs and the schedule; read a run, its jobs and step logs (logs are secret-redacted).
- Dispatch, cancel and re-run runs (any org member).
- Poll a repo, and change repo, workflow and Actions settings (owners and admins).

**Providers**

- List the providers your org can bring its own key for, with key status and a masked hint. Key values are never returned.

**Benchmarks**

- Read benchmarks, runs, per-provider results, reliability and worker logs.

Billing, top-ups and org membership are managed on the platform, not through assistants.

## Tools

Assistants connected with OAuth see 75 tools. Each one is a **read** (looks things up and changes nothing), a **write** (changes something you can undo), or a **sensitive write**. A sensitive write spends money or compute, can't be undone, runs code, makes something public, or changes org-wide settings. Every tool also publishes `readOnlyHint` and `destructiveHint` annotations, and its full input schema, in `tools/list`.

| Tool | Type | Permission | What it does |
|---|---|---|---|
| `get_profile` | Read | `sandboxes:read` | Returns the profile for this connection: a stable, opaque id plus the organization it bills. |
| `list_sandboxes` | Read | `sandboxes:read` | List sandboxes, newest first unless `sort` says otherwise. |
| `get_sandbox` | Read | `sandboxes:read` | Get a single sandbox by id, including its attach descriptor. |
| `get_quote` | Read | `sandboxes:read` | Quote a sandbox create before making it: which provider and region it would place on, the size tier, the rate in USD per second/minute/hour, the estimated cost for the timeout and the prepaid credit balance. |
| `create_sandbox` | Sensitive write | `sandboxes:write` | Create a new sandbox for the organization. Bills prepaid credit or the org's provider account until destroyed. |
| `destroy_sandbox` | Sensitive write | `sandboxes:write` | Destroy a sandbox and settle its cost. Irreversible; deletes the sandbox and its files. |
| `run_command` | Sensitive write | `sandboxes:write` | Run one command in the sandbox and return its buffered output. Runs arbitrary code; can change or delete anything in the sandbox and reach the network. |
| `read_file` | Read | `sandboxes:read` | Read a file or list a directory at an absolute path. |
| `write_file` | Sensitive write | `sandboxes:write` | Write a file at an absolute path. Overwrites files. |
| `make_directory` | Write | `sandboxes:write` | Create a directory (parents included) at an absolute path. |
| `remove_path` | Sensitive write | `sandboxes:write` | Remove a file or directory tree at an absolute path. Irreversible delete. |
| `sandbox_url` | Sensitive write | `sandboxes:read` | Resolve the provider's public URL for a port on the sandbox. Makes a sandbox port reachable from the public internet. |
| `list_processes` | Read | `sandboxes:read` | List the sandbox's tracked processes. |
| `process_status` | Read | `sandboxes:read` | Get a daemon process's current status by jobId. |
| `start_process` | Sensitive write | `sandboxes:write` | Start a detached daemon process inside the sandbox. Starts arbitrary long-running code. |
| `write_process_stdin` | Sensitive write | `sandboxes:write` | Write data to a process's stdin, optionally closing it. Sends arbitrary input to a running program. |
| `wait_process` | Read | `sandboxes:read` | Wait for a process to finish and return its exit state. |
| `kill_process` | Sensitive write | `sandboxes:write` | Kill a daemon process inside the sandbox. Stops a running program. |
| `sandboxes_get_settings` | Read | `sandboxes:read` | The org's sandbox placement settings, as GET /api/v1/sandboxes/settings answers them: `providerOrder` (empty inherits `actionsProviderOrder`), `providerResources` (each provider's size, with the preset it is in `providerResourcePresets`) and `warmPool` (pre-warmed boxes per provider[:region] entry). |
| `sandboxes_update_settings` | Sensitive write | `sandboxes:write` | Change the org's sandbox placement settings; send at least one field. Changes where and how big every future sandbox in the org is (cost). |
| `sandboxes_get_options` | Read | `sandboxes:read` | What the org can create sandboxes on, in the order its router tries them, as GET /api/v1/sandboxes/options answers it: `byokMode` (how the org's own keys are ordered against managed accounts: off, first, fallback or only) and `options`, each either a managed account (`account: 'managed'`: ComputeSDK runs it and bills the org's prepaid credit; `sizes` with the `rate` per size, null when that size isn't sold) or a BYOK provider (`account: 'byok'`: the org's own key, billed by the provider; `ready` says whether the key can place now). |
| `sandboxes_get_costs` | Read | `sandboxes:read` | The org's sandbox spend, as GET /api/v1/sandboxes/costs answers it: `running` and `settled` counts and USD, `totalUsd`, and `byProvider` (each with its own `running` and `settled`). |
| `providers_list` | Read | `providers:read` | Every provider the org may bring its own key for, as GET /api/v1/providers answers it: per provider its `regions`, the stored `key` (verification `status` connected/unconfigured/error, masked `keyHint`, `lastCheckedAt`, `statusDetail` — never the key), and its rates: `rate` (what sandbox costs are reported at), `customRate` (the org's own, or null) and `platformRate`. |
| `providers_get` | Read | `providers:read` | One BYOK provider, as GET /api/v1/providers/{provider} answers it: its key's state and its `rate`, `customRate` and `platformRate`. |
| `providers_verify_key` | Sensitive write | `providers:write` | Test the org's stored key for a provider by placing a real sandbox with it (in every stored region for a region-keyed key), as POST /api/v1/providers/{provider}/verify does: a pass marks the key connected and routable for Actions and sandboxes (and act-capable when act comes up), a failure marks it error, which takes it out of routing. Creates a real, billed sandbox on the provider. |
| `providers_remove_key` | Sensitive write | `providers:write` | Remove the org's stored key for a provider, as DELETE /api/v1/providers/{provider}/key does; Actions jobs and sandbox creates stop placing on it. Removes the org's provider credential; jobs stop placing there. |
| `providers_set_custom_rate` | Write | `providers:write` | Set the org's custom rate for a BYOK provider, as PUT /api/v1/providers/{provider}/rate does. |
| `providers_clear_custom_rate` | Write | `providers:write` | Remove the org's custom rate for a provider, as DELETE /api/v1/providers/{provider}/rate does: its sandbox costs are reported at the platform rate again. |
| `actions_list_schedule` | Read | `actions:read` | Daily Actions workflow totals and previews in timeZone (IANA, default UTC), paginated past runs newest first (limit default 100, max 500; carry nextCursor as cursor), and upcoming UTC fires with occurrenceCount and up to 100 occurrences per schedule. |
| `actions_list_repos` | Read | `actions:read` | List the org's CI repos: every repo a connected GitHub installation grants (plus generic git remotes), whether or not it is enabled for runs, with its workflow file paths, poll state (pollIntervalSeconds, nextPollDueAt, lastPollSucceededAt, lastPollError), sync state, fork pull request setting and unarchived run counts (runs.total, runs.lastRunState). |
| `actions_list_branches` | Read | `actions:read` | List one repo's refs: watched branches and open pull requests (watched: true), then refs with run history only, each with its run count and latest run. |
| `actions_list_workflows` | Read | `actions:read` | List the org's runnable workflows — the workflow files discovered on connected repos, with their dispatch inputs, declared schedules, per-workflow controls (providerOrder, snapshotCap) and latest run. |
| `actions_list_runs` | Read | `actions:read` | List the org's CI runs, newest first — the same 100-run window the dashboard feed shows. |
| `actions_list_run_days` | Read | `actions:read` | How many runs each local day holds, newest first — the index for reading older history one day at a time with the run list's `day`. |
| `actions_get_run` | Read | `actions:read` | Get a single CI run by id, including its jobs with steps, cache touches, and the tail of its streamed output. |
| `actions_get_job_logs` | Read | `actions:read` | Read a job's log. |
| `actions_list_job_artifacts` | Read | `actions:read` | List a job's artifacts: names, sizes, and expiry. |
| `actions_dispatch_workflow` | Sensitive write | `actions:write` | Dispatch a workflow run — the manual trigger. Starts a CI run that consumes compute (cost). |
| `actions_cancel_run` | Sensitive write | `actions:write` | Cancel a live CI run. Stops an in-flight CI run. |
| `actions_rerun_run` | Sensitive write | `actions:write` | Re-run a finished CI run (same workflow, ref, and inputs). Starts a CI run that consumes compute (cost). |
| `actions_archive_runs` | Sensitive write | `actions:write` | Archive up to 100 runs by id, or restore them with `archived: false`. Hides runs from lists (restorable). |
| `actions_update_workflow` | Sensitive write | `actions:write` | Change one workflow's controls: turn it off or on (`enabled`), set the providers its runs are placed on (`providerOrder`, `provider` or `provider:region` ids, first preferred; null or [] inherits the org's order) and its snapshot cap (`snapshotCap` 0..64; 0 turns snapshots off, null is the dynamic pool). Changes a workflow's placement controls. |
| `actions_poll_repo` | Write | `actions:write` | Poll one repo now: fetch its refs, re-discover its workflow files and start the runs new commits call for — the Poll now button. |
| `actions_update_repo` | Sensitive write | `actions:write` | Change one repo's settings: `enabled` turns it on for runs (discovering its workflows, so runs start from the next push) or off (no new runs start from it); `forkPullRequests` lets pull requests from forks run, isolated and without the repo's secrets (public repos only). Enables/disables a repo for CI or changes polling. |
| `actions_sync_repos` | Write | `actions:write` | Re-read the org's GitHub App installations from GitHub, so repos granted to the App after install show up (disabled until enabled), and answer each account's outcome and the org's repos. |
| `actions_list_providers` | Read | `actions:read` | Every provider Actions can place on, as GET /api/v1/actions/providers answers it: the effective `providerOrder`, and per provider its `regions`, `credential` (ambient, configured or not-configured), `actCapable`, `usable`, `position` in the order, and the stored key's verification `status` (connected, unconfigured, error), `statusDetail`, `lastCheckedAt` and masked `keyHint` — never the key. |
| `actions_get_settings` | Read | `actions:read` | The org's Actions placement settings, as GET /api/v1/actions/settings answers them: `providerOrder` (empty: `defaultProviderOrder` applies), `providerResources` (each provider's size, the preset it is in `providerResourcePresets`, the choices in `sizePresets`), `warmPool` and `snapshotPool` (per provider[:region] entry), and `snapshotSummary` (which workflows cap snapshots and which hold live ones). |
| `actions_update_settings` | Sensitive write | `actions:write` | Change the org's Actions placement settings; send at least one field. Changes org-wide CI placement and spend caps. |
| `actions_list_installations` | Read | `actions:read` | The org's GitHub App installations, as GET /api/v1/actions/installations answers them: each connected account (`account`, `accountType`), its `repoSelection` (all or selected), `repos` (granted and enabled counts), `suspended`/`suspendedAt`, `installedAt` and `configureUrl` (where its repository selection changes on GitHub). |
| `actions_get_install_link` | Read | `actions:read` | Where an owner/admin installs the GitHub App into another account, as GET /api/v1/actions/installations/install-url answers it: `url` is Settings → Actions, whose Install button a signed-in owner/admin presses (the signed install link is only ever minted for a signed-in user). |
| `actions_get_slack` | Read | `actions:read` | The org's Slack connection, as GET /api/v1/actions/slack answers it: `installed`, `teamName`, `channelId`/`channelName` (where run cards post), `notifyOn` (all or failure) and the daily `brief` (enabled, times, timeZone, categories). |
| `actions_get_slack_install_link` | Read | `actions:read` | Where an owner/admin connects a Slack workspace, as GET /api/v1/actions/slack/install-url answers it: `url` is the install route, which a signed-in owner/admin opens in their browser and which redirects to Slack. |
| `actions_get_run_state` | Read | `actions:read` | Everything about one run's configuration and placement, as GET /api/v1/actions/runs/{runId}/state answers it: conclusion, each job's placement and steps, and the context that decided how it ran — resolved runner image, container pin, cache keys touched, the names (never values) of secrets bound, concurrency group and placement attempts. |
| `benchmarks_list` | Read | `benchmarks:read` | List the benchmarks this organization can read: its own, catalog benchmarks it's entitled to, and locked catalog entries marked locked:true with the category that unlocks them. |
| `benchmarks_list_runs` | Read | `benchmarks:read` | List runs of a benchmark, newest first — id, name, status, dates, sizing and owning org. |
| `benchmarks_get_results` | Read | `benchmarks:read` | Get benchmark results: runs with per-participant task overviews (counts, success rate = successCount/taskCount, latencyMs over successful tasks only — p50/p95/p99). |
| `benchmarks_get_run_results` | Read | `benchmarks:read` | Get one run's results: overall totals, per-participant task overviews and per-step overviews (counts, success rates, latencyMs p50/p95/p99 over successful work), and customMetrics: each custom metric's median overall (run-wide even with `participants`) and per participant. |
| `benchmarks_get_run_iterations` | Read | `benchmarks:read` | Get one run's per-iteration rows: every task (or step) execution with per-iteration latencyMs — where outlier tasks show up. |
| `benchmarks_get_reliability` | Read | `benchmarks:read` | Read a reliability benchmark — the same data as GET /api/v1/benchmarks/:slug/reliability. |
| `benchmarks_get_participant_logs` | Read | `benchmarks:read` | Read one participant's parsed worker logs for a run. |
| `benchmarks_get_participant_logos` | Read | `benchmarks:read` | Get the public logo URLs for benchmark participants by provider slug — the light and dark logomark SVG URLs on logos.computesdk.com, or null for a participant with no logo mapped. |
| `benchmarks_get_run_again` | Read | `benchmarks:read` | Poll a benchmark run-again request by runAgainId and get the benchmark run ID once it is reported. |
| `benchmarks_get_run_again_state` | Read | `benchmarks:read` | Whether the org may run a daily benchmark again today (`available`, and `disabledReason` when not) and today's quota use (`quota.used` of `quota.limit` 1 per benchmark and UTC day, resetting at `quota.resetsAt`). |
| `benchmarks_list_org_runs` | Read | `benchmarks:read` | The org's run feed: the latest runs across every benchmark it can see, newest first, each with its benchmark, participants, submitter, status and progress. |
| `benchmarks_list_run_days` | Read | `benchmarks:read` | How many feed runs each local day holds, newest first: the run feed's timeline. |
| `benchmarks_list_runs_for_day` | Read | `benchmarks:read` | One page (150 runs) of a local day's feed runs, newest first. |
| `benchmarks_get_reliability_cards` | Read | `benchmarks:read` | A live card per reliability benchmark the org can see: trailing-24 h uptime, current status per participant, the check strip and the last check time, plus `mutedCount`. |
| `benchmarks_get_activity` | Read | `benchmarks:read` | Runs per UTC day over the last `days` days, zero-filled: the org dashboard's activity chart. |
| `benchmarks_get_matrix` | Read | `benchmarks:read` | A matrix index benchmark's newest dataset (the dashboard's results grid): the spec and the merged dataset of the newest non-archived run that uploaded one. |
| `benchmarks_get_model_index` | Read | `benchmarks:read` | A model-matrix index benchmark's newest results (models × gateways) from its newest non-archived run. |
| `benchmarks_get_run_overview` | Read | `benchmarks:read` | One run's Overview as the dashboard shows it: status, progress, overall totals, custom-metric medians, and the participants ranked best first by `rankBy` at `stat`. |
| `benchmarks_get_run_timeline` | Read | `benchmarks:read` | One run over time: completed/succeeded/failed tasks per participant per `bucketMs` (default 10 s) and the workers' reported concurrency samples. |
| `benchmarks_get_run_task_results` | Read | `benchmarks:read` | One run's tasks in index buckets per worker (counts and latency p50/p95/max per bucket of `bucketSize` tasks) and its failed tasks with error codes (up to `failureLimit`). |
| `benchmarks_list_run_workers` | Read | `benchmarks:read` | Every worker of a run with its participant, status, task range, progress and artifacts (id, kind, name, contentType), as the Workers page lists them. |
| `benchmarks_read_artifact` | Read | `benchmarks:read` | A worker artifact's content as text: logs, JSON metrics and other text artifacts (a gzipped log comes back decompressed). |

### Errors and limits

- **Not signed in, or the token expired:** HTTP `401` with a `WWW-Authenticate: Bearer` challenge that points to `https://platform.computesdk.com/.well-known/oauth-protected-resource`. The assistant signs in again.
- **Missing permission:** the tool returns an error naming `insufficient_scope` and the permission it needs. Reconnect and approve it.
- **Not an owner or admin, not found, or bad input:** the tool returns an error with a plain-text reason. Nothing changes.
- **Confirmation:** tools that change org settings or remove things run in two steps. The first call changes nothing and returns `confirmationRequired: true` with a summary; a second call with `confirm: true` applies it.
- **Rate limit:** 240 requests per minute per connection. Past that, the server returns HTTP `429` with `{"error":"rate_limited"}`; wait and retry.
- **Long work:** sandboxes bill until destroyed or until they expire. CI runs report `status` and `conclusion`; check a run with `actions_get_run` instead of dispatching it again.

## Good to know

- **Sandbox visibility:** an assistant sees only sandboxes you created through a connected app. Other members' sandboxes, and ones made in the dashboard, return "Sandbox not found".
- **Billing:** sandboxes on managed accounts bill your org's prepaid credit while they run; sandboxes on your own provider keys are billed by that provider. Sandboxes expire on their own (30 minutes by default); destroying them sooner stops billing.
- **Preview URLs:** a server must listen on `0.0.0.0` and the exact port requested.
- **Response size:** assistant connections get compact results (for example, the newest runs and only their failing jobs). Ask for one run, or narrow with filters, for the full detail.
- **Missing permission:** if a tool answers `insufficient_scope`, the connection predates that permission. Disconnect and connect again to approve it.

## Data and privacy

Tool calls carry only what the assistant sends for that action, such as a command, a file, or a run id. Sandboxes run on third-party compute providers, and code running in a sandbox can reach the internet. See the [privacy policy](https://www.computesdk.com/privacy) for what ComputeSDK collects, how long it keeps it and your choices. Questions: [support](https://www.computesdk.com/support).
