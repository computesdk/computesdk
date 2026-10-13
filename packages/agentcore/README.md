# @computesdk/agentcore (deprecated)

> **Deprecated:** this package has moved to [`@computesdk/aws`](../aws). Import the AgentCore provider from the `agentcore` subpath instead:
>
> ```bash
> npm install @computesdk/aws
> ```
>
> ```typescript
> import { agentcore } from '@computesdk/aws/agentcore'
> ```

`@computesdk/agentcore` is now a thin re-export of `@computesdk/aws/agentcore`, so existing imports keep working:

```typescript
import { agentcore } from '@computesdk/agentcore' // still works, but deprecated
```

See the [`@computesdk/aws` README](../aws/README.md#agentcore) for authentication, configuration, and usage.
