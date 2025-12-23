---
"computesdk": minor
---

Add `extendTimeout` method to extend sandbox expiration

## New Feature: Extend Sandbox Timeout

You can now extend the timeout/expiration of an existing sandbox to keep it alive longer:

```typescript
import { compute } from 'computesdk';

// Extend timeout by default 15 minutes
await compute.sandbox.extendTimeout('sandbox-123');

// Extend timeout by custom duration (30 minutes)
await compute.sandbox.extendTimeout('sandbox-123', {
  duration: 30 * 60 * 1000
});

// Useful with named sandboxes
const sandbox = await compute.sandbox.findOrCreate({
  name: 'long-running-task',
  namespace: 'user-alice'
});

// Extend timeout before it expires
await compute.sandbox.extendTimeout(sandbox.sandboxId, {
  duration: 60 * 60 * 1000 // 1 hour
});
```

### API

- **`compute.sandbox.extendTimeout(sandboxId, options?)`**
  - `sandboxId` (string, required): ID of the sandbox to extend
  - `options.duration` (number, optional): Additional time in milliseconds. Defaults to 900000 (15 minutes)
  - Returns: `Promise<void>`

### Notes

- Only available with gateway provider
- Other providers will throw an error indicating lack of support
- Default extension duration is 15 minutes (900000ms)
- Gateway endpoint: `POST /v1/sandbox/:id/extend`
