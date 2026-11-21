# AgentVM provider for ComputeSDK

**Draft integration. No real machine creation or paid lifecycle test has been performed.**

This provider targets **billable dedicated AgentVM machines**, not pooled one-shot gVisor preview jobs. Dedicated machines can continue incurring charges until destroyed or their lease expires.

```ts
import { agentvm } from '@computesdk/agentvm';

const compute = agentvm({
  apiKey: process.env.AGENTVM_API_KEY,
  allowBillableCreate: true,
  machine: {
    provider: 'hetzner',
    region: '<catalog-region-id>',
    planId: '<catalog-plan-id>',
    imageId: '<catalog-image-id>',
    publicKey: '<your-SSH-public-key>',
    maxRuntimeSeconds: 3600,
  },
});

const sandbox = await compute.instances.create();
try {
  console.log((await sandbox.runCommand('echo hello')).stdout);
} finally {
  await sandbox.destroy();
}
```

Values must come from the authenticated AgentVM catalog; a real SSH public key is required for standard machine provisioning. A finite `maxRuntimeSeconds` (at least 300) is mandatory in this adapter, and the server may enforce a tighter account limit. `allowBillableCreate: true` explicitly authorizes a potentially paid machine launch; it is also required for `destroy()` in this draft.

**Limitations:** The API may return a machine while provisioning is still in progress. Command execution requires the guest operation agent to become ready; readiness handling is not yet proven end-to-end. There is no automatic size selection, native live stdout streaming, or arbitrary HTTP preview URL. Timeouts request command cancellation on a best-effort basis. Confirm all machine cleanup and billing behavior in a controlled live test before upstream publication.

The provider uses the caller's AgentVM API key. Never commit the key, machine credentials, or private SSH keys.
