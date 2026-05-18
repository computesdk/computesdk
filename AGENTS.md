# AGENTS.md

## Cursor Cloud specific instructions

This is a TypeScript monorepo (pnpm workspaces) for **ComputeSDK**, a unified SDK for running code in remote sandboxed environments. It is a library, not a deployable application.

### Key commands

All commands are defined in the root `package.json`:

| Task | Command |
|---|---|
| Install deps | `pnpm install` |
| Build all | `pnpm build` |
| Lint | `pnpm lint` |
| Test (unit) | `pnpm test` |
| Typecheck | `pnpm typecheck` |
| Dev (watch) | `pnpm dev` |

### Build order matters

`pnpm build` is ordered: `@computesdk/cmd` → `computesdk` → `@computesdk/provider` → `@computesdk/test-utils` → all remaining packages. Always run a full `pnpm build` after `pnpm install` before running tests or the workbench.

### Tests run in mock mode

Unit tests (`pnpm test`) run without any external API keys. They cover `@computesdk/cmd`, `@computesdk/provider`, `computesdk`, `@computesdk/events`, and `@computesdk/docker`. Integration tests for cloud providers (E2B, Modal, Vercel, etc.) require provider-specific API keys.

### Hello-world without API keys

Use the `@computesdk/just-bash` provider for local testing — no API keys needed. Import from its built dist: `import { justBash } from "./dist/index.mjs"` when running from `packages/just-bash/`, or use it within the workbench.

### ESM considerations

The `just-bash` npm dependency only exports ESM (no CJS `require` entry). When running scripts outside the monorepo test framework, use `node --input-type=module` or write `.mjs` files. Inside vitest tests this is handled automatically.

### pnpm install warning

After `pnpm install`, you may see: `WARN Failed to create bin at .../computesdk-cloudflare. ENOENT`. This is benign — the cloudflare setup binary depends on `dist/setup.mjs` which is created by `pnpm build`.
