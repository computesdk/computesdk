# Accounts and authentication

Every hosted sandbox, provider credential, API key and Actions run belongs to an organization. Start at [platform.computesdk.com](https://platform.computesdk.com). Owners and admins manage keys and provider credentials in Settings.

## CLI browser login

```bash
compute login
compute whoami
compute org list
compute org use <slug>
```

Login uses an OAuth device flow and stores credentials in `~/.benchsdk/credentials.json`. Expired access tokens are refreshed automatically. `compute logout` clears local credentials. `--no-browser` prints a URL and code for manual sign-in.

`compute org use` changes the active organization associated with the login. For one invocation, pass `--org <slug>` or set `COMPUTE_ORG`. Organization API keys always act on their own org; an org override does not change their scope.

## API keys for applications and CI

Create an organization key in **Settings → API keys**, then export it:

```bash
export COMPUTE_API_KEY="your_org_api_key"
```

The CLI checks an explicit `--api-key`, then `COMPUTE_API_KEY`, then the legacy `BENCHMARKS_PLATFORM_API_KEY`, then stored login credentials. An environment key takes precedence over a browser login.

The Platform SDK follows the same precedence, using `apiKey` in provider configuration in place of the CLI flag. A key-only SDK application needs no CLI or stored login dependency.

## Reuse a CLI login in the SDK

Install the optional credential reader in your application:

```bash
npm install @benchsdk/cli
```

Separately, [install the compute CLI](installation.md#cli) (`@computesdk/cli`) if it is not already available, then sign in:

```bash
compute login
```

`@benchsdk/cli` lets the SDK read the saved login; it does not install the `compute` command.

Then use `platform({})` without an explicit key. The SDK reads and refreshes the saved session; it never starts a browser login. Unset key environment variables if you want the stored session to apply.

## Hosts and deployments

The default platform URL is `https://platform.computesdk.com`. Override it with `COMPUTE_PLATFORM_URL`, the CLI's `--base-url`, or the SDK's `baseUrl`. The legacy `BENCHMARKS_PLATFORM_URL` is a fallback.

Credentials are restricted to computesdk.com and loopback hosts by default. Explicit keys can opt into another HTTPS host with `--allow-untrusted-host` or `allowUntrustedHost: true`. Stored login credentials are never resolved for an untrusted host. Plain HTTP is accepted only for loopback.

For scripts without a browser, see [CLI automation](../cli/automation.md). For assistant authorization, see [MCP](../platform/mcp.md).
