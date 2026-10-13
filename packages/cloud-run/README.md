# @computesdk/cloud-run (deprecated)

> **Deprecated:** this package has moved to [`@computesdk/gcp`](../gcp). Import the Cloud Run provider from the `cloud-run` subpath instead:
>
> ```bash
> npm install @computesdk/gcp
> ```
>
> ```typescript
> import { cloudRun } from '@computesdk/gcp/cloud-run'
> ```
>
> Gateway setup: `npx -p @computesdk/gcp computesdk-cloud-run`.

`@computesdk/cloud-run` is now a thin re-export of `@computesdk/gcp/cloud-run`, so existing imports keep working:

```typescript
import { cloudRun } from '@computesdk/cloud-run' // still works, but deprecated
```

`npx @computesdk/cloud-run` still runs the gateway setup by delegating to `@computesdk/gcp`.

See the [`@computesdk/gcp` README](../gcp/README.md) for configuration and usage.
