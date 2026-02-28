# @computesdk/just-bash

[just-bash](https://justbash.dev/) provider for ComputeSDK - Local sandboxed bash execution with a virtual filesystem. No external services, containers, or authentication required.

## Installation

```bash
npm install @computesdk/just-bash
```

## Quick Start

### Gateway Mode (Recommended)

Use the gateway for zero-config auto-detection:

```typescript
import { compute } from 'computesdk';

// just-bash is always available - no credentials needed
const sandbox = await compute.sandbox.create();

const result = await sandbox.runCode('echo "Hello from just-bash!"');
console.log(result.output); // "Hello from just-bash!"

await sandbox.destroy();
```

### Direct Mode

For direct SDK usage without the gateway:

```typescript
import { justBash } from '@computesdk/just-bash';

const compute = justBash({});

const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand('echo "Hello" | tr a-z A-Z');
console.log(result.stdout); // "HELLO"

await sandbox.destroy();
```

## Configuration

### Environment Variables

No environment variables are required. just-bash runs entirely locally.

### Configuration Options

```typescript
interface JustBashConfig {
  /** Enable Python support via pyodide (disabled by default) */
  python?: boolean;
  /** Initial files to populate in the virtual filesystem */
  files?: Record<string, string>;
  /** Initial environment variables */
  env?: Record<string, string>;
  /** Working directory (defaults to /home/user) */
  cwd?: string;
  /** Custom filesystem implementation (see Filesystem Backends below) */
  fs?: IFileSystem;
  /** Custom commands created with defineCommand() (see Custom Commands below) */
  customCommands?: CustomCommand[];
  /** Network configuration for curl (disabled by default) */
  network?: NetworkConfig;
}
```

## Filesystem Backends

By default, just-bash uses an **InMemoryFs** — a pure in-memory filesystem. You can swap in alternative backends depending on your use case:

### InMemoryFs (default)

All files live in memory. Fast, deterministic, fully isolated.

```typescript
const compute = justBash({}); // InMemoryFs is the default
```

### OverlayFs (copy-on-write)

Reads from a real directory on disk; writes stay in memory. The underlying directory is never modified.

```typescript
import { OverlayFs } from 'just-bash';

const compute = justBash({
  fs: new OverlayFs({ root: '/path/to/project' }),
  cwd: '/path/to/project',
});
```

### ReadWriteFs (direct disk access)

Reads and writes go directly to a real directory. Use with caution — changes are real.

```typescript
import { ReadWriteFs } from 'just-bash';

const compute = justBash({
  fs: new ReadWriteFs({ root: '/tmp/sandbox' }),
});
```

### MountableFs (compose multiple filesystems)

Mount different filesystem backends at different paths.

```typescript
import { MountableFs, InMemoryFs } from 'just-bash';
import { OverlayFs } from 'just-bash';

const compute = justBash({
  fs: new MountableFs({
    base: new InMemoryFs(),
    mounts: [
      { mountPoint: '/project', filesystem: new OverlayFs({ root: '/real/project' }) },
    ],
  }),
  cwd: '/project',
});
```

## Custom Commands

You can extend just-bash with custom commands using `defineCommand()`:

```typescript
import { justBash } from '@computesdk/just-bash';
import { defineCommand } from 'just-bash';

const hello = defineCommand('hello', async (args, ctx) => {
  const name = args[0] || 'world';
  return {
    stdout: `Hello, ${name}!\n`,
    stderr: '',
    exitCode: 0,
  };
});

const compute = justBash({ customCommands: [hello] });
const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand('hello Alice');
console.log(result.stdout); // "Hello, Alice!\n"
```

Custom commands receive a context object (`ctx`) with access to:
- `ctx.fs` — the virtual filesystem
- `ctx.cwd` — current working directory
- `ctx.env` — environment variables
- `ctx.stdin` — standard input
- `ctx.exec(command)` — run subcommands

## API Reference

### Code Execution

```typescript
// Execute bash scripts
const result = await sandbox.runCode(`
  for i in 1 2 3; do
    echo "Number: $i"
  done
`);
console.log(result.output);
// Number: 1
// Number: 2
// Number: 3

// Execute Python code (requires python: true in config)
const compute = justBash({ python: true });
const sandbox = await compute.sandbox.create();

const result = await sandbox.runCode(`
import json
data = {"message": "Hello from Python"}
print(json.dumps(data))
`, 'python');
```

### Command Execution

```typescript
// Pipes and text processing
const result = await sandbox.runCommand('echo -e "banana\\napple\\ncherry" | sort');
console.log(result.stdout); // "apple\nbanana\ncherry\n"

// JSON processing with jq
await sandbox.filesystem.writeFile('/data.json', '[{"name":"Alice"},{"name":"Bob"}]');
const result = await sandbox.runCommand('cat /data.json | jq ".[].name"');

// Environment variables per command
const result = await sandbox.runCommand('echo $MY_VAR', { env: { MY_VAR: 'hello' } });

// Working directory per command
const result = await sandbox.runCommand('cat config.json', { cwd: '/app' });
```

### Filesystem Operations

```typescript
// Write file
await sandbox.filesystem.writeFile('/tmp/hello.txt', 'Hello World');

// Read file
const content = await sandbox.filesystem.readFile('/tmp/hello.txt');

// Create directory
await sandbox.filesystem.mkdir('/tmp/data');

// List directory contents
const files = await sandbox.filesystem.readdir('/tmp');

// Check if file exists
const exists = await sandbox.filesystem.exists('/tmp/hello.txt');

// Remove file or directory
await sandbox.filesystem.remove('/tmp/hello.txt');
```

### Sandbox Management

```typescript
// Get sandbox info
const info = await sandbox.getInfo();
console.log(info.id, info.provider, info.status);

// List all active sandboxes
const sandboxes = await compute.sandbox.list();

// Get sandbox by ID
const existing = await compute.sandbox.getById('sandbox-id');

// Destroy sandbox
await sandbox.destroy();
```

### Pre-populated Files

```typescript
const compute = justBash({
  files: {
    '/app/config.json': '{"port": 3000}',
    '/app/data.csv': 'name,age\nAlice,25\nBob,30',
  },
  env: {
    APP_ENV: 'production',
  },
  cwd: '/app',
});

const sandbox = await compute.sandbox.create();
const result = await sandbox.runCommand('cat config.json');
console.log(result.stdout); // {"port": 3000}
```

## Built-in Commands

just-bash includes 60+ built-in commands:

| Category | Commands |
|----------|----------|
| **File ops** | `cat`, `cp`, `ls`, `mkdir`, `mv`, `rm`, `touch`, `tree`, `ln`, `find` |
| **Text processing** | `awk`, `grep`, `sed`, `cut`, `sort`, `uniq`, `wc`, `head`, `tail`, `tr` |
| **Data processing** | `jq` (JSON), `yq` (YAML/XML), `sqlite3` (SQLite), CSV tools |
| **Compression** | `gzip`, `tar` |
| **Utilities** | `echo`, `printf`, `date`, `seq`, `timeout`, `basename`, `dirname` |
| **Shell** | `export`, `source`, `alias`, `test`, `read`, `set`, `unset` |

## Error Handling

```typescript
import { justBash } from '@computesdk/just-bash';

const compute = justBash({});
const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand('cat /nonexistent');
if (result.exitCode !== 0) {
  console.error('Command failed:', result.stderr);
}

// getUrl throws since just-bash has no network
try {
  await sandbox.getUrl({ port: 3000 });
} catch (error) {
  console.error(error.message); // "just-bash is a local sandbox without network capabilities..."
}
```

## Examples

### Data Pipeline

```typescript
import { justBash } from '@computesdk/just-bash';

const compute = justBash({});
const sandbox = await compute.sandbox.create();

// Create CSV data
await sandbox.filesystem.writeFile('/data/sales.csv',
  'product,quantity,price\nWidget,100,9.99\nGadget,50,24.99\nDoohickey,200,4.99'
);

// Process with awk
const result = await sandbox.runCommand(
  'cat /data/sales.csv | tail -n +2 | awk -F, \'{ total += $2 * $3 } END { printf "Total revenue: $%.2f\\n", total }\''
);
console.log(result.stdout); // Total revenue: $3247.50

await sandbox.destroy();
```

### JSON Processing

```typescript
import { justBash } from '@computesdk/just-bash';

const compute = justBash({
  files: {
    '/data/users.json': JSON.stringify([
      { name: 'Alice', age: 30, role: 'admin' },
      { name: 'Bob', age: 25, role: 'user' },
      { name: 'Charlie', age: 35, role: 'admin' },
    ]),
  },
});
const sandbox = await compute.sandbox.create();

// Filter admins and extract names
const result = await sandbox.runCommand(
  'cat /data/users.json | jq \'[.[] | select(.role == "admin") | .name]\''
);
console.log(result.stdout); // ["Alice", "Charlie"]

await sandbox.destroy();
```

### Script Execution

```typescript
import { justBash } from '@computesdk/just-bash';

const compute = justBash({});
const sandbox = await compute.sandbox.create();

const result = await sandbox.runCode(`
#!/bin/bash
count=0
for f in /proc/self/status /etc/hostname; do
  if test -f "$f"; then
    count=$((count + 1))
  fi
done
echo "Found $count system files"
`);

console.log(result.output);

await sandbox.destroy();
```

## Limitations

- **No Network Access** - `getUrl()` is not supported; `curl` requires explicit `network` config
- **No Real Processes** - Commands are interpreted in TypeScript, not executed as real OS processes
- **No Node.js Runtime** - `runCode` with `node` runtime executes as bash, not actual Node.js
- **In-Memory by Default** - Files don't persist unless you use `OverlayFs`, `ReadWriteFs`, or `MountableFs`
- **Python via Pyodide** - Python support requires `python: true` and uses pyodide (WebAssembly-based)

## When to Use just-bash

- **Testing & Development** - Fast, no-cost sandbox for development and CI
- **AI Agent Tools** - Secure bash execution for AI code generation
- **Offline Environments** - No network or API keys required
- **Unit Tests** - Deterministic, isolated test environments

## License

MIT
