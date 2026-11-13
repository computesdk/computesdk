# ComputeSDK Router

Give Claude a real place to run code. ComputeSDK Router connects Claude to your
ComputeSDK organization so it can create cloud sandboxes, run commands and
long-running processes, read and write files, and share a preview URL for a
server it starts. Each sandbox is placed across sandbox providers (such as
Tensorlake, E2B, Daytona and Modal) through the ComputeSDK gateway, on your own
provider keys or on ComputeSDK's managed accounts.

It also works with ComputeSDK Actions, so Claude can list your connected repos
and workflows, start a CI run, watch it, and read a failed step's logs. It can
show which provider keys your org has connected and read ComputeSDK benchmark
results.

## What you need

- A ComputeSDK account and organization at https://platform.computesdk.com.
- Sandboxes on managed accounts use your organization's prepaid credit; sandboxes
  on your own provider keys are billed by that provider.
- CI features need an org admin to connect repositories through the ComputeSDK
  GitHub App first.

## Connecting

The plugin connects to one remote MCP server, `https://platform.computesdk.com/mcp`.
The first time it's used, Claude opens a ComputeSDK sign-in in your browser:
sign in, pick the organization to use, and approve the permissions. Nothing is
installed or run on your computer, and no API key is stored in the plugin.

## What it does with your data

- Every action is a call to the ComputeSDK MCP server above, made on your
  behalf with the permissions you approved. Commands, files and processes run
  inside cloud sandboxes, never on your machine.
- Sandboxes run on third-party providers chosen by ComputeSDK's router or by
  you. Code running inside a sandbox can reach the internet.
- Claude can only see sandboxes you created through a connected app such as
  Claude or ChatGPT, never other members' sandboxes or ones made in the
  dashboard.
- Provider API keys and vault secret values are never returned to Claude; it
  sees only whether a key is connected and a masked hint.
- The plugin contains no hooks, local servers or scripts; its skills are
  instructions that help Claude use the tools well.

## Skills

- `sandboxes` — create, run, files, processes, preview URLs, and clean-up.
- `actions` — CI runs, logs, dispatch, cancel and re-run.
- `providers` — provider key status and rates.
- `benchmarks` — read benchmark results and reliability.
- `computesdk-sdk` — writing code that uses the ComputeSDK SDK.

## Links

- Website: https://www.computesdk.com
- Privacy policy: https://www.computesdk.com/privacy
- Terms of service: https://www.computesdk.com/terms
- Support: https://www.computesdk.com/support

Licensed under the MIT license.
