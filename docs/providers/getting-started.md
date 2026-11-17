# Start on a provider

If you already know which provider you want, use its npm starter. This follows the same ComputeSDK routing and authentication as the CLI.

## 1. Create a sandbox

With Node.js 22 or later and npm installed:

```bash
npm create modal@latest
```

The starter offers to install or upgrade `@computesdk/cli` when needed, guides setup and creates a sandbox pinned to Modal. You do not need a local Modal SDK or provider key. The sandbox becomes current for this directory unless you pass `--no-use`.

Managed compute uses your organization's ComputeSDK credits. If you have configured your own provider keys, your saved routing settings determine which account is used. See [routing](../guides/routing.md) and [billing](../guides/billing.md). Creation can incur charges.

Provider-pinned starters return an error if that provider cannot place the sandbox; they do not silently switch to a different provider. If a create fails with an uncertain outcome, inspect `compute list` before creating again.

For another provider, use a [published starter](README.md#start-with-a-provider), or [install the CLI](../getting-started/installation.md#cli) and run `compute new <provider>`. Starter names are not always identical to provider IDs; use the verified commands in the catalog rather than guessing an npm name.

## 2. Run commands

```bash
compute exec echo hello
compute list
```

`exec` uses the selected sandbox. For files, processes and preview URLs, see [command execution](../cli/execution.md).

## 3. Destroy the sandbox

```bash
compute destroy
```

Closing the terminal does not stop the sandbox or billing. It runs until destroyed or its lifetime expires. Check `compute list` and retry cleanup if destruction fails.

## Let the router choose instead

With the CLI installed:

```bash
compute new
```

Leave out the provider to follow your organization's saved router. Set provider preferences and fallback in [routing and BYOK](../guides/routing.md). Continue with the [CLI quickstart](../getting-started/quick-start.md) or [TypeScript SDK quickstart](../getting-started/sdk-quick-start.md).
