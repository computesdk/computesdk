# Adding a New Sandbox Provider

This guide walks you through creating a new provider package for ComputeSDK.

## Before You Start

- **Node.js** >= 18 and **pnpm** >= 9 are required
- Familiarize yourself with the provider you're integrating (API docs, SDK, auth model)

### Scope: no core SDK changes

A provider PR adds a provider. It must not modify the SDK core. Confine your changes to
these paths:

| Path | What goes there |
|---|---|
| `packages/my-provider/` | Your entire provider package |
| `docs/providers/my-provider.md` | Your docs page (§7) |
| `docs/SUMMARY.md` | The one nav line linking your docs page (§7) |
| `.changeset/<slug>.md` | Your changeset (§8) |
| `README.md` (root) | Your row in the provider table and package list |

**Do not touch** anything else -- in particular:

- `packages/computesdk/` and `packages/provider/` -- the SDK core and provider framework.
  If your provider can't be expressed with the existing `defineProvider` interface, that's
  a framework gap: open an issue describing what you need, and don't work around it by
  editing core in your PR.
- Other providers' packages, shared tooling, root configs (`tsconfig.json`,
  `pnpm-workspace.yaml`, CI workflows), and lockfile edits beyond what `pnpm install`
  produces for your own package.

A PR that changes core alongside a new provider will be asked to split into two.

## 1. Scaffold the Package

Create a new directory under `packages/`:

```
packages/my-provider/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── README.md
└── src/
    ├── index.ts
    └── __tests__/
        └── index.test.ts
```

### package.json

```json
{
  "name": "@computesdk/my-provider",
  "version": "1.0.0",
  "description": "My Provider for ComputeSDK - brief description of capabilities",
  "author": "Your Name",
  "license": "MIT",
  "main": "./dist/index.js",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "clean": "rimraf dist",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest watch",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "eslint"
  },
  "keywords": [
    "computesdk",
    "provider",
    "sandbox",
    "code-execution",
    "cloud",
    "compute"
  ],
  "dependencies": {
    "@computesdk/provider": "workspace:*",
    "computesdk": "workspace:*",
    "my-provider-sdk": "^1.0.0"
  },
  "devDependencies": {
    "@computesdk/test-utils": "workspace:*",
    "@types/node": "^20.0.0",
    "@vitest/coverage-v8": "^1.0.0",
    "eslint": "^8.37.0",
    "rimraf": "^5.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/computesdk/computesdk.git",
    "directory": "packages/my-provider"
  },
  "homepage": "https://www.computesdk.com",
  "bugs": {
    "url": "https://github.com/computesdk/computesdk/issues"
  }
}
```

### tsconfig.json

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### tsup.config.ts

```typescript
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
})
```

### vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.d.ts',
        '**/*.config.*'
      ]
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})
```

The `pnpm-workspace.yaml` already includes `packages/*`, so your new package is automatically part of the workspace.

## 2. Implement the Provider

Use `defineProvider` from `@computesdk/provider` to define your provider. It takes two type parameters -- `TSandbox` (your provider's native sandbox object) and `TConfig` (your configuration type) -- and an object with your provider name and method implementations.

```typescript
// src/index.ts
import { defineProvider } from '@computesdk/provider';
import type { ProviderConfig } from '@computesdk/provider';
import type {
  CommandResult,
  SandboxInfo,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
} from 'computesdk';

// 1. Define your configuration type
interface MyProviderConfig extends ProviderConfig {
  apiKey: string;
  region?: string;
  // etc
}

// 2. Define the provider
export const myProvider = defineProvider<any, MyProviderConfig>({
  name: 'my-provider',
  methods: {
    sandbox: {
      // --- Collection operations ---

      create: async (config, options) => {
        const sandbox = await myAPI.createSandbox(config.apiKey, options);
        return { sandbox, sandboxId: sandbox.id };
      },

      getById: async (config, sandboxId) => {
        const sandbox = await myAPI.getSandbox(config.apiKey, sandboxId);
        return sandbox ? { sandbox, sandboxId } : null;
      },

      list: async (config) => {
        const sandboxes = await myAPI.listSandboxes(config.apiKey);
        return sandboxes.map(s => ({ sandbox: s, sandboxId: s.id }));
      },

      destroy: async (config, sandboxId) => {
        await myAPI.destroySandbox(config.apiKey, sandboxId);
      },

      // --- Instance operations ---

      runCommand: async (sandbox, command, args) => {
        const result = await myAPI.runCommand(sandbox.id, command, args);
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        };
      },

      getInfo: async (sandbox) => ({
        id: sandbox.id,
        status: 'running',
        createdAt: new Date(sandbox.createdAt),
      }),

      getUrl: async (sandbox, options) => {
        return `https://${sandbox.id}.my-provider.com:${options.port}`;
      },
    },
  },
});
```

## 3. Sandbox Methods

Every provider must define the `SandboxMethods<TSandbox, TConfig>` interface. The methods below are all required keys, but not every provider can support every operation. For methods your provider doesn't support, throw a descriptive error explaining the limitation.

### Core methods (must be fully implemented)

| Method | Signature | Description |
|---|---|---|
| `create` | `(config, options?) => Promise<{ sandbox, sandboxId }>` | Create a new sandbox |
| `getById` | `(config, sandboxId) => Promise<{ sandbox, sandboxId } \| null>` | Get sandbox by ID |
| `destroy` | `(config, sandboxId) => Promise<void>` | Destroy a sandbox |
| `runCommand` | `(sandbox, command, args?, options?) => Promise<CommandResult>` | Run a shell command |
| `getInfo` | `(sandbox) => Promise<SandboxInfo>` | Get sandbox info |

### Methods that can throw "not supported"

If your provider can't support these, define them but throw a clear error:

| Method | Signature | Description |
|---|---|---|
| `list` | `(config) => Promise<Array<{ sandbox, sandboxId }>>` | List all sandboxes |
| `getUrl` | `(sandbox, { port, protocol? }) => Promise<string>` | Get URL for a port |

```typescript
list: async () => {
  throw new Error('MyProvider does not support listing sandboxes.');
},
```

### Key return types

```typescript
interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface SandboxInfo {
  id: string;
  status: 'running' | 'stopped' | 'error';
  createdAt: Date;
}
```

## 4. Optional Methods

### Filesystem

If your provider supports file operations, add a `filesystem` object. If you omit it, the framework auto-generates "not supported" errors -- you don't need to handle that yourself.

```typescript
filesystem: {
  readFile: async (sandbox, path, runCommand) => {
    const result = await runCommand(sandbox, 'cat', [path]);
    return result.stdout;
  },
  writeFile: async (sandbox, path, content, runCommand) => {
    await runCommand(sandbox, 'sh', ['-c', `cat > '${path}' << 'EOF'\n${content}\nEOF`]);
  },
  mkdir: async (sandbox, path, runCommand) => {
    await runCommand(sandbox, 'mkdir', ['-p', path]);
  },
  readdir: async (sandbox, path, runCommand) => {
    // Parse and return FileEntry[]
  },
  exists: async (sandbox, path, runCommand) => {
    const result = await runCommand(sandbox, 'test', ['-e', path]);
    return result.exitCode === 0;
  },
  remove: async (sandbox, path, runCommand) => {
    await runCommand(sandbox, 'rm', ['-rf', path]);
  },
}
```

### Templates

For providers that support sandbox templates/images:

```typescript
methods: {
  sandbox: { /* ... */ },
  template: {
    create: async (config, options) => { /* ... */ },
    getById: async (config, templateId) => { /* ... */ },
    list: async (config) => { /* ... */ },
    destroy: async (config, templateId) => { /* ... */ },
  },
}
```

## 5. Write Tests

The `@computesdk/test-utils` package provides standard test suites that validate your provider against the full interface. Create `src/__tests__/index.test.ts`:

```typescript
import { runProviderTestSuite } from '@computesdk/test-utils';
import { myProvider } from '../index';

runProviderTestSuite({
  name: 'my-provider',
  provider: myProvider({ apiKey: process.env.MY_PROVIDER_API_KEY }),
  supportsFilesystem: true, // set to false if you didn't implement filesystem
  skipIntegration: !process.env.MY_PROVIDER_API_KEY,
});
```

## 6. Add a README

Create a `README.md` for your package that includes:

- What the provider does and its key features
- Installation instructions
- Configuration options (API keys, env vars, etc.)
- A usage example
- Supported runtimes and features
- Any limitations or caveats

See [packages/e2b/README.md](e2b/README.md) for a good example.

## 7. Add a Docs Page

Every provider gets a page in the published documentation site (GitBook), which lives in
the top-level [docs/](docs/) directory.

### Create `docs/providers/my-provider.md`

Start with the GitBook front matter block, then the page body. Copy the `layout` block
verbatim -- it's identical across every provider page -- and write your own `description`:

````markdown
---
description: >-
  My Provider for ComputeSDK - one or two sentences describing what the provider
  does and its key capabilities.
layout:
  width: default
  title:
    visible: true
  description:
    visible: false
  tableOfContents:
    visible: true
  outline:
    visible: true
  pagination:
    visible: true
  metadata:
    visible: true
  tags:
    visible: true
  actions:
    visible: true
---

# My Provider

[My Provider](https://my-provider.com) provider for ComputeSDK - brief description.

## Installation & Setup

```bash
npm install @computesdk/my-provider
```

Add your My Provider credentials to a `.env` file:

```bash
MY_PROVIDER_API_KEY=your_my_provider_api_key
```

## Usage

```typescript
import { myProvider } from '@computesdk/my-provider';

const compute = myProvider({
  apiKey: process.env.MY_PROVIDER_API_KEY,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from My Provider!"');
console.log(result.stdout);

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface MyProviderConfig {
  /** My Provider API key - if not provided, will use MY_PROVIDER_API_KEY env var */
  apiKey?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
}
```
````

Keep the page focused on what a user needs to get running: install, credentials, a
working example, config options, and any provider-specific concepts or limitations. The
`tags:` front matter key (e.g. the `benchmarked` tag) and the benchmark embed are added by
maintainers once a provider has been benchmarked -- leave them out of your initial page.

### Register it in `docs/SUMMARY.md`

GitBook builds its navigation from [docs/SUMMARY.md](docs/SUMMARY.md). Add your page to
the `Providers` list, **in alphabetical order by display name**:

```markdown
* [Providers](providers/README.md)
  ...
  * [Modal](providers/modal.md)
  * [My Provider](providers/my-provider.md)
  * [Namespace](providers/namespace.md)
  ...
```

A page that isn't in `SUMMARY.md` won't appear in the docs site.

See [docs/providers/leap0.md](docs/providers/leap0.md) for a good example.

## 8. Add a Changeset

Releases are managed with [Changesets](https://github.com/changesets/changesets). Every PR
that adds or changes a published package needs one, or the package won't be versioned and
published.

Create `.changeset/<short-slug>.md` (any unique kebab-case filename works):

```markdown
---
"@computesdk/my-provider": patch
---

Add My Provider provider
```

### Bump type

**Never use `major`.** A new provider package is additive -- it can't break existing
consumers -- so a major bump is always wrong here.

| Bump | When |
|---|---|
| `patch` | **Default for a new provider package.** Use this unless a maintainer says otherwise. |
| `minor` | Only when a maintainer explicitly asks for it (e.g. a notable feature landing alongside the package). |
| `major` | Never. |

List only the package your PR adds. For a new provider that's exactly one entry --
`"@computesdk/my-provider"`. Never list `computesdk` or `@computesdk/provider`: a provider
PR doesn't change them (see [Scope](#scope-no-core-sdk-changes)), so they have nothing to
release.

## 9. Build and Verify

```bash
# Install dependencies
pnpm install

# Build the full dependency chain (provider framework first, then your package)
pnpm run build

# Or build just your package (after dependencies are built)
pnpm --filter @computesdk/my-provider run build

# Type check
pnpm --filter @computesdk/my-provider run typecheck

# Lint
pnpm --filter @computesdk/my-provider run lint

# Run tests
pnpm --filter @computesdk/my-provider run test
```

## 10. Submit Your PR

Your PR should include:

- [ ] The new `packages/my-provider/` directory with all files listed above
- [ ] Passing `build`, `typecheck`, and `lint` checks
- [ ] Tests for all required sandbox methods
- [ ] A README with setup and usage instructions
- [ ] A docs page at `docs/providers/my-provider.md`, linked from `docs/SUMMARY.md`
- [ ] A changeset in `.changeset/` with a `patch` (or `minor`) bump -- never `major`
- [ ] **No changes outside the allowed paths** -- run `git diff --stat main` and confirm
      every file is in `packages/my-provider/`, `docs/`, `.changeset/`, or the root
      `README.md`. No edits to `packages/computesdk/` or `packages/provider/`.
      See [Scope](#scope-no-core-sdk-changes).

## Best Practices

**Validate config early.** Check API keys exist and provide helpful setup instructions in error messages:

```typescript
if (!config.apiKey) {
  throw new Error(
    'Missing API key for my-provider.\n\n' +
    'Get your key at https://my-provider.com/keys\n' +
    'Then pass it: myProvider({ apiKey: "xxx" })\n' +
    'Or set MY_PROVIDER_API_KEY in your environment.'
  );
}
```

**Handle errors gracefully.** Catch provider-specific errors and convert them to user-friendly messages.

**Use `escapeShellArg`** from `@computesdk/provider` when interpolating user input into shell commands, and always wrap it in double quotes (e.g. `` `cat "${escapeShellArg(path)}"` ``). The helper escapes `\`, `"`, `$`, and backticks but not spaces or metacharacters like `;` and `|`, so unquoted usage breaks on paths with spaces and is unsafe for user-controlled input.

**Support env var fallbacks.** Accept config via constructor params and fall back to environment variables:

```typescript
const apiKey = config.apiKey ?? process.env.MY_PROVIDER_API_KEY;
```

## Naming Conventions

| Item | Convention | Example |
|---|---|---|
| Package name | `@computesdk/{kebab-case}` | `@computesdk/my-provider` |
| Export name | camelCase, matches provider | `export const myProvider = ...` |
| Config type | `{PascalCase}Config` | `MyProviderConfig` |
| Directory | `packages/{kebab-case}` | `packages/my-provider` |

## Reference Implementations

| Provider | Path |
|---|---|
| Blaxel | [packages/blaxel](blaxel/) |
| E2B |  [packages/e2b](e2b/) |
| Modal | [packages/modal](modal/) |
| Vercel | [packages/vercel](vercel/) |

## Questions?

Open an issue at https://github.com/computesdk/computesdk/issues or check the [@computesdk/provider README](provider/README.md) for the full API reference.
