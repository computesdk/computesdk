# CLI automation

Use an organization API key for CI and scripts. Set `COMPUTE_API_KEY` in the process environment; see [authentication](../getting-started/authentication.md). Missing credentials in noninteractive mode fail instead of starting browser sign-in.

## JSON and exit status

```bash
compute status --check --json
compute list --json
compute run --json echo hello
```

`status --check` exits nonzero unless authentication is verified and the default route is ready. It creates nothing. Check exit status as well as JSON: a command failure, API failure or unconfirmed cleanup can make an invocation fail.

Most commands emit one JSON document. Streamed execution, watch sync and `run --json` use JSON Lines. The final `run` summary contains `sandboxId`, `jobId`, `exitCode`, `elapsedSeconds`, `provider`, `deleted`, `kept` and optional `costUsd`. Unknown remote exit status is null. Cost is included only when teardown returns a settled amount.

Failures use a stderr envelope:

```json
{ "ok": false, "error": { "code": "no_credentials", "message": "...", "hint": "..." } }
```

API errors can also include `httpStatus`, `details` and `retryable`. Keep stdout and stderr separate if you parse the command result.

## User sign-in from an agent

```bash
compute login --json
```

This returns `verificationUrl`, `code` and `expiresAt` immediately. Show the URL and code to the user, then wait for their approval:

```bash
compute login --wait --json
```

The second command waits, saves credentials, and returns sign-in status and organization. Pending login attempts can resume after interruption; `--new` starts a replacement attempt. JSON mode never opens a browser or returns the private device code.

## Recover without repeating work

If following a background process fails, use the reported sandbox/job IDs with `logs`, `ps`, `wait` or `kill`. Do not rerun a command just to reconnect to its output. After a failed teardown, inspect `compute list` and explicitly destroy the reported sandbox.
