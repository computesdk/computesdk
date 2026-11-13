---
description: >-
  Connect Claude, ChatGPT and other AI assistants to the ComputeSDK Platform
  through its remote MCP server: run code in cloud sandboxes, work with Actions
  CI, check provider keys and read benchmark resu
---

# MCP server (Claude, ChatGPT and other assistants)

The ComputeSDK Platform has a remote [Model Context Protocol](https://modelcontextprotocol.io) server. Connect it to an AI assistant and the assistant can create cloud sandboxes, run commands and long-running processes, read and write files, share a preview URL for a server it starts, work with your org's Actions CI runs, show which provider keys are connected, and read benchmark results.

**Server URL:** `https://platform.computesdk.com/mcp` (streamable HTTP)

Nothing runs on your computer: every tool call goes to this server, and commands run inside cloud sandboxes.

## Connect

### Claude

* **Claude (web and desktop):** add ComputeSDK Router from the connectors directory, or go to **Settings → Connectors → Add custom connector** and enter the server URL.
*   **Claude Code:** install the plugin, which adds the server and skills that help Claude use the tools well:

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

| Permission       | Scope             | Allows                                                                    |
| ---------------- | ----------------- | ------------------------------------------------------------------------- |
| Read sandboxes   | `sandboxes:read`  | List and inspect your sandboxes, files, processes and URLs                |
| Use sandboxes    | `sandboxes:write` | Create and destroy sandboxes, run commands, write files, manage processes |
| Read Actions     | `actions:read`    | Read CI runs, jobs, logs and settings                                     |
| Manage Actions   | `actions:write`   | Dispatch, cancel and re-run CI runs; change Actions settings              |
| Read providers   | `providers:read`  | Provider key status and rates                                             |
| Manage providers | `providers:write` | Verify or remove provider keys, set reporting rates                       |
| Read benchmarks  | `benchmarks:read` | Benchmark runs and results                                                |
| Stay signed in   | `offline_access`  | Keep the connection after you close the browser                           |

Settings changes, provider keys and repo controls also need you to be an org owner or admin. To disconnect, remove the app in **Settings → Connected apps** on the platform, or remove the connector in your assistant.

## What the assistant can do

**Sandboxes**

* See what you can run on and what each size costs (`sandboxes_get_options`), and price one create (`get_quote`).
* Create a sandbox (`create_sandbox`), on the router's choice or a provider you name, on your own keys or ComputeSDK's managed accounts.
* Run commands (`run_command`), start long-running processes (`start_process`, `process_status`, `wait_process`, `kill_process`, `write_process_stdin`), and work with files (`write_file`, `read_file`, `make_directory`, `remove_path`).
* Get a public preview URL for a port a server listens on (`sandbox_url`).
* List, inspect and destroy sandboxes (`list_sandboxes`, `get_sandbox`, `destroy_sandbox`), and see spend (`sandboxes_get_costs`).

**Actions (CI)**, for repos connected through the ComputeSDK GitHub App:

* List repos, branches, workflows, runs and the schedule; read a run, its jobs and step logs (logs are secret-redacted).
* Dispatch, cancel and re-run runs (any org member).
* Poll a repo, and change repo, workflow and Actions settings (owners and admins).

**Providers**

* List the providers your org can bring its own key for, with key status and a masked hint. Key values are never returned.

**Benchmarks**

* Read benchmarks, runs, per-provider results, reliability and worker logs.

Billing, top-ups and org membership are managed on the platform, not through assistants.

## Good to know

* **Sandbox visibility:** an assistant sees only sandboxes you created through a connected app. Other members' sandboxes, and ones made in the dashboard, return "Sandbox not found".
* **Billing:** sandboxes on managed accounts bill your org's prepaid credit while they run; sandboxes on your own provider keys are billed by that provider. Sandboxes expire on their own (30 minutes by default); destroying them sooner stops billing.
* **Preview URLs:** a server must listen on `0.0.0.0` and the exact port requested.
* **Response size:** assistant connections get compact results (for example, the newest runs and only their failing jobs). Ask for one run, or narrow with filters, for the full detail.
* **Missing permission:** if a tool answers `insufficient_scope`, the connection predates that permission. Disconnect and connect again to approve it.

## Data and privacy

Tool calls carry only what the assistant sends for that action, such as a command, a file, or a run id. Sandboxes run on third-party compute providers, and code running in a sandbox can reach the internet. See the [privacy policy](https://www.computesdk.com/privacy) for what ComputeSDK collects, how long it keeps it and your choices. Questions: [support](https://www.computesdk.com/support).
