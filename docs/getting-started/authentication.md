# Accounts and authentication

Every hosted sandbox, provider credential, API key and Actions run belongs to an organization. Start at [platform.computesdk.com](https://platform.computesdk.com). Owners and admins manage keys and provider credentials in Settings.

## CLI browser login

```bash
compute login
compute whoami
compute org list
compute org use <slug>
```

Login opens your browser and saves your session locally. Expired access tokens are refreshed automatically. `compute logout` clears local credentials. `--no-browser` prints a URL and code for manual sign-in.

`compute org use` changes the active organization associated with the login. For one invocation, pass `--org <slug>` or set `COMPUTE_ORG`. Organization API keys always act on their own org; an org override does not change their scope.

## API keys for applications and CI

Create an organization key in **Settings → API keys**, then export it:

```bash
export COMPUTE_API_KEY="your_org_api_key"
```

Use `COMPUTE_API_KEY` for applications and CI. In the CLI, an explicit `--api-key` or `COMPUTE_API_KEY` takes precedence over a browser login.

The TypeScript SDK reads `COMPUTE_API_KEY` automatically.

## API URL

The default ComputeSDK API URL is `https://platform.computesdk.com`. Override it with `COMPUTE_PLATFORM_URL`, the CLI's `--base-url`, or the SDK's `baseUrl`.

Credentials are restricted to computesdk.com and loopback hosts by default. Explicit keys can opt into another HTTPS host with `--allow-untrusted-host` or `allowUntrustedHost: true`. Stored login credentials are never resolved for an untrusted host. Plain HTTP is accepted only for loopback.

For scripts without a browser, see [CLI automation](../cli/automation.md). For assistant authorization, see [MCP](../platform/mcp.md).
