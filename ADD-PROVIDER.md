# Adding a New Sandbox Provider

This guide walks you through creating a new provider package for ComputeSDK.

## Before You Start

- **Node.js** >= 18 and **pnpm** >= 9 are required
- Familiarize yourself with the provider you're integrating (API docs, SDK, auth model)

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
  CodeResult,
  CommandResult,
  SandboxInfo,
  Runtime,
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

      runCode: async (sandbox, code, runtime) => {
        const result = await myAPI.execute(sandbox.id, code, runtime);
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        };
      },

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
| `runCode` | `(sandbox, code, runtime?, config?) => Promise<CodeResult>` | Execute code (Python/Node.js) |
| `getUrl` | `(sandbox, { port, protocol? }) => Promise<string>` | Get URL for a port |

```typescript
list: async () => {
  throw new Error('MyProvider does not support listing sandboxes.');
},
```

### Key return types

```typescript
interface CodeResult {
  stdout?: string;
  stderr?: string;
  exitCode: number;
}

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

## 7. Build and Verify

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

## 8. Submit Your PR

Your PR should include:

- [ ] The new `packages/my-provider/` directory with all files listed above
- [ ] Passing `build`, `typecheck`, and `lint` checks
- [ ] Tests for all required sandbox methods
- [ ] A README with setup and usage instructions

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

**Use `escapeShellArg`** from `@computesdk/provider` when interpolating user input into shell commands to prevent injection.

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
