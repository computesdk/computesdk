# Preview an application

Start a server inside a sandbox, then get a URL for its port. The server must
listen on `0.0.0.0` and the port you expose. Public URLs depend on the provider;
check [available providers](../providers/README.md) and the returned URL.

{% tabs %}
{% tab title="CLI" %}

After [syncing a project](../cli/project-sync.md) and installing its dependencies:

```bash
compute exec --detach --cwd /app "npm run dev -- --host 0.0.0.0"
compute ps
compute url --port 3000
```

Use your application's startup flags and actual port. Inspect a background job
with `compute logs <sandbox-id> <job-id> --follow`.

{% endtab %}
{% tab title="TypeScript" %}

This example serves a small HTML page with Python:

```typescript
import { compute } from 'computesdk';

const sandbox = await compute.instances.create();
try {
  await sandbox.filesystem.mkdir('/tmp/preview');
  await sandbox.filesystem.writeFile('/tmp/preview/index.html', '<h1>Hello from ComputeSDK</h1>');
  await sandbox.runCommand('python3 -m http.server 3000 --bind 0.0.0.0 --directory /tmp/preview', {
    background: true,
  });
  console.log(await sandbox.getUrl({ port: 3000 }));
  console.log(`Clean up with: compute destroy ${sandbox.sandboxId}`);
} catch (error) {
  await sandbox.destroy();
  throw error;
}
```

Use an image with Python installed, or replace the server command with your
application. The example deliberately leaves a successful sandbox running so
you can open its preview. Wait for your server to be ready before opening it.

{% endtab %}
{% endtabs %}

Treat the returned URL as public unless the provider documents access controls.
Keep secrets out of content served on that port. Destroy the sandbox when done;
closing the preview or stopping a local log follower does not stop billing.
