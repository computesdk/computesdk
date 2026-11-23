# @computesdk/platform

Compatibility exports for the ComputeSDK router. New applications need only `computesdk`:

```bash
npm install computesdk
```

```typescript
import { compute } from 'computesdk';

const sandbox = await compute.instances.create({ size: 'small' });
try {
  console.log((await sandbox.runCommand('echo hello')).stdout);
} finally {
  await sandbox.destroy();
}
```

Set `COMPUTE_API_KEY` or sign in with the separately installed CLI using `compute login`. The SDK includes saved-session resolution and refresh. Sandboxes keep running and billing until destroyed or their lifetime expires.

## Existing integrations

Existing imports of `platform`, `PlatformClient`, error classes, auth helpers and wire types from `@computesdk/platform` continue to work. They use the same implementation as the exports in `computesdk`. The wire types `CommandResult` and `FileEntry` retain their original names here; in `computesdk`, they are `PlatformCommandResult` and `PlatformFileEntry` to distinguish them from normalized instance types.

Explicit provider configuration, custom endpoints and defaults remain available. Without an explicit order, creation follows the organization's saved Sandboxes router. A `providerOrder`, whether passed per call or set in `defaults`, bypasses that saved routing; a call-level order overrides `defaults.providerOrder`. REST-only fields such as `only` and `byok` are not typed provider create options.

For `computesdk@4.1.18` and earlier, continue using the separate adapter package until you upgrade to a release containing the built-in router.

[SDK quickstart](https://docs.computesdk.com/start-here/sdk-quick-start) · [Authentication](https://docs.computesdk.com/start-here/authentication) · [SDK reference and compatibility](https://docs.computesdk.com/typescript-sdk/reference) · [Routing](https://docs.computesdk.com/guides/routing)

---

[Sandbox Router](https://www.computesdk.com/sandbox-router) · [SDK quickstart](https://docs.computesdk.com/interfaces/sdk/sdk-quick-start)
