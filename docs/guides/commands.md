# Run commands

Run generated code, tests or scripts in a sandbox. Complete the [CLI](../getting-started/quick-start.md)
or [TypeScript](../getting-started/sdk-quick-start.md) quickstart first.

{% tabs %}
{% tab title="CLI" %}

For project commands, [sync your application](../cli/project-sync.md) to `/app`
and install its dependencies first.

```bash
compute exec echo hello
compute exec --cwd /app --timeout 120 npm test
compute exec --stream "npm run build"
```

Commands use the selected sandbox. `compute use <id>` changes the selection;
`compute exec <id> <command>` runs on an explicit sandbox.

{% endtab %}
{% tab title="TypeScript" %}

```typescript
import { compute } from 'computesdk';

const sandbox = await compute.instances.create();
try {
  const result = await sandbox.runCommand('echo hello');
  console.log(result.stdout);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `Command exited ${result.exitCode}`);
  }
} finally {
  await sandbox.destroy();
}
```

For a project already uploaded to `/app`, set `cwd` and a command timeout:

```typescript
const result = await sandbox.runCommand('npm test', {
  cwd: '/app',
  timeout: 120000,
  onStdout: (chunk) => process.stdout.write(chunk),
});
```

{% endtab %}
{% endtabs %}

## Long-running work

The CLI can follow a long-running process or detach and return a job ID:

```bash
compute exec --timeout 0 "long-running-command"
compute exec --detach "long-running-command"
compute logs <sandbox-id> <job-id> --follow
compute ps
```

In the SDK, `runCommand(command, { background: true })` starts detached work.
Buffered SDK commands are limited to 290 seconds. A command's timeout is
separate from the sandbox's lifetime: ending a command does not release compute.
CLI `--timeout` uses seconds; SDK `timeout` uses milliseconds.

See [CLI execution details](../cli/execution.md) for shell quoting, streaming,
exit codes and process recovery. For development servers, continue with
[application previews](previews.md). For API failures and safe retries, see
[errors and limits](../sdk/errors.md).
