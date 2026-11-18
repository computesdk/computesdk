# Work with files

Upload inputs, write files for agent tools and download results. Complete a
[quickstart](../getting-started/quick-start.md) and create a sandbox first.

{% tabs %}
{% tab title="CLI" %}

Use `:/absolute/path` for the selected sandbox:

```bash
compute cp ./input.json :/tmp/input.json
compute exec "cat /tmp/input.json"
compute cp :/tmp/input.json ./downloaded.json
```

Use `<sandbox-id>:/absolute/path` to address a different sandbox. For a complete
project, use [sync](../cli/project-sync.md):

```bash
compute sync . :/app
compute sync :/app ./results
```

{% endtab %}
{% tab title="TypeScript" %}

```typescript
import { compute } from 'computesdk';

const sandbox = await compute.instances.create();
try {
  await sandbox.filesystem.writeFile('/tmp/input.json', JSON.stringify({ value: 42 }));
  const contents = await sandbox.filesystem.readFile('/tmp/input.json');
  console.log(contents);
  console.log(await sandbox.filesystem.readdir('/tmp'));
} finally {
  await sandbox.destroy();
}
```

`readFile` and `writeFile` handle UTF-8 text, with a limit of approximately 4 MB
per call. Use CLI transfers for larger files or directories. See
[SDK limits](../sdk/errors.md#limits).

{% endtab %}
{% endtabs %}

Files live in the remote sandbox. Download results you need before destroying
it; deleting the sandbox is not a file backup. For project ignore rules,
one-way watch and sync snapshots, see [project sync](../cli/project-sync.md).
