# Sandbox lifecycle

A sandbox is a remote environment that keeps running across commands and
client connections. Create it, keep its ID, reconnect when needed, and destroy
it to release compute. Placement happens at creation; reconnecting does not
move a running sandbox to another provider.

{% tabs %}
{% tab title="CLI" %}

```bash
compute new
compute list
compute use <sandbox-id>
compute exec echo hello
compute get
compute destroy
```

The selected sandbox is saved for the directory/repository and organization.
Pass an explicit ID to operate on another sandbox. Finishing a command does
not end the sandbox.

{% endtab %}
{% tab title="TypeScript" %}

```typescript
import { compute } from 'computesdk';

const sandbox = await compute.instances.create({ timeout: 600000 });
const id = sandbox.sandboxId;
try {
  const connected = await compute.instances.getById(id);
  if (!connected) throw new Error('Sandbox is no longer available');
  console.log((await connected.runCommand('echo reconnected')).stdout);
  console.log(await connected.getInfo());
} finally {
  await compute.instances.destroy(id);
}
```

Store the ID in your application to reconnect later. `compute.instances.list()`
lists running sandboxes. The same organization credentials are required when
reconnecting.

{% endtab %}
{% endtabs %}

## Lifetime and cleanup

SDK create `timeout` is the sandbox lifetime in milliseconds; command timeouts
are separate. Actual lifetime and provider limits may vary. Use `try/finally`
for short SDK tasks, or `compute run <command>` for CLI work with automatic
cleanup. `--keep` and `--detach` leave a sandbox running.

Destroying a sandbox ends its processes. Save needed files first. If cleanup
fails, use the sandbox ID to retry and inspect the dashboard. Closing a terminal
or application process does not destroy remote compute.

## Snapshots and persistence

Providers differ in snapshot support, what a snapshot captures and how it is
restored. Do not assume that every provider supports pausing, memory snapshots
or restoring on a different provider. Check the [provider catalog](../providers/README.md),
then use the snapshot commands in the [CLI reference](../platform/cli.md#sandboxes)
or the [REST API](../platform/api-reference.md#sandboxes).

For uncertain create outcomes and idempotency, see [errors and safe retries](../sdk/errors.md).
