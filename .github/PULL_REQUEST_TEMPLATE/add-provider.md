<!--
Adding a new compute provider to ComputeSDK? You're in the right place.
See ADD-PROVIDER.md for the full implementation guide.
Replace the placeholders below and tick the boxes as you go.
-->

## Provider: `@computesdk/<name>`

**What is it?** <one-line description of the service and what it's good for>

**Underlying SDK / API:** <npm package + version, or REST API>

**Credentials:** <env vars / config fields needed, and where to get them>

### Capabilities

| Capability | Supported? | Notes |
|---|---|---|
| `runCommand` (required) | ✅ | |
| Filesystem | ✅ / ❌ | |
| `getUrl` (port exposure) | ✅ / ❌ | |
| `list` | ✅ / ❌ | |
| Templates | ✅ / ❌ | |
| Snapshots | ✅ / ❌ | |

> Unsupported methods are defined but throw a clear "not supported" error — they are not omitted.

### Checklist

- [ ] New `packages/<name>/` package with `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `README.md`, and `src/`
- [ ] Core sandbox methods implemented: `create`, `getById`, `destroy`, `runCommand`, `getInfo`
- [ ] Config validated early with a helpful error; env-var fallback supported
- [ ] Shell interpolation uses `escapeShellArg` wrapped in double quotes
- [ ] Tests via `runProviderTestSuite` (unit pass; integration gated on credentials)
- [ ] `pnpm build` passes
- [ ] `pnpm --filter @computesdk/<name> run typecheck` passes
- [ ] `pnpm --filter @computesdk/<name> run lint` passes
- [ ] Root `README.md` "Supported Providers" table updated (and install list if applicable)
- [ ] Docs page added/updated at `docs/providers/<name>.md` (see existing pages for the expected structure)
- [ ] Changeset added (`patch`)

### Notes for reviewers

<anything non-obvious: deliberate limitations, API quirks, why a method is stubbed, etc.>
