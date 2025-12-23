# Updated ComputeSandbox Implementation

Based on Gateway PR #73, here's the updated implementation that works with the new API.

## Changes from Original

1. **`findOrCreate`** → Calls `POST /v1/sandbox/find-or-create`
2. **`find`** → Calls `POST /v1/sandbox/find`
3. **`extendTimeout`** → Removed (not supported by gateway)
4. **Property mapping:**
   - `projectGroupId` → `name`
   - `tenantKey` → `namespace`
   - Uses `sandboxId` from response (which is actually the subsandbox ID, but that's transparent)

## Implementation

```typescript
/**
 * ComputeSandbox - Wrapper around ComputeSDK Gateway
 *
 * Replaces E2BSandbox.ts with "one sandbox per project, multiple servers" model.
 * No Redis state management - gateway handles identity via (namespace, name).
 *
 * Uses Gateway API endpoints:
 * - POST /v1/sandbox/find-or-create
 * - POST /v1/sandbox/find
 */

import { publish } from '@/pubsub';
import { getLogger } from '@createinc/logger';
import { Sandbox } from '@computesdk/client';
import { createPubSubClient, type EventsPubSubClient } from '@computesdk/events';

const logger = getLogger({ module: 'dev-server/compute-sandbox' });

/**
 * Configuration for gateway API calls
 */
interface GatewayConfig {
  gatewayUrl: string;
  apiKey: string;
  provider?: string;
}

/**
 * Thin wrapper around ComputeSDK sandbox providing:
 * - Lifecycle management via (namespace, name) lookup
 * - Direct access to SDK namespaces (servers, files, commands, env)
 * - Event subscription forwarding to Flux pubsub
 */
class ComputeSandbox {
  private sandbox: Sandbox;
  private _projectGroupId: string;
  private _tenantKey: string;
  private eventSubscription: EventsPubSubClient | null = null;

  private constructor(sandbox: Sandbox, projectGroupId: string, tenantKey: string) {
    this.sandbox = sandbox;
    this._projectGroupId = projectGroupId;
    this._tenantKey = tenantKey;
  }

  get sandboxId(): string {
    return this.sandbox.sandboxId;
  }

  get projectGroupId(): string {
    return this._projectGroupId;
  }

  get tenantKey(): string {
    return this._tenantKey;
  }

  /** Direct access to servers namespace (start, stop, restart, retrieve) */
  get servers(): Sandbox['servers'] {
    return this.sandbox.servers;
  }

  /** Direct access to files namespace (write, batchWrite, read, delete) */
  get files(): Sandbox['files'] {
    return this.sandbox.files;
  }

  /** Direct access to commands namespace (run) */
  get commands(): Sandbox['commands'] {
    return this.sandbox.commands;
  }

  /** Direct access to env namespace (retrieve, update, remove) */
  get env(): Sandbox['env'] {
    return this.sandbox.env;
  }

  // ---------------------------------------------------------------------------
  // LIFECYCLE
  // ---------------------------------------------------------------------------

  /**
   * Find existing or create new sandbox by (namespace, name)
   */
  static async findOrCreate({
    projectGroupId,
    tenantKey = 'default',
    timeout = 30 * 60 * 1000,
  }: {
    projectGroupId: string;
    tenantKey?: string;
    timeout?: number;
  }): Promise<ComputeSandbox> {
    logger.info({ projectGroupId, tenantKey, timeout }, 'Finding or creating sandbox');

    const config = getGatewayConfig();

    const response = await fetch(`${config.gatewayUrl}/v1/sandbox/find-or-create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ComputeSDK-API-Key': config.apiKey,
        ...(config.provider && { 'X-Provider': config.provider }),
      },
      body: JSON.stringify({
        namespace: tenantKey,
        name: projectGroupId,
        timeout,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gateway API error: ${error}`);
    }

    const data = await response.json();
    if (!data.success || !data.data) {
      throw new Error(`Gateway returned invalid response: ${JSON.stringify(data)}`);
    }

    const { sandboxId, url, token, provider } = data.data;

    logger.info({ projectGroupId, sandboxId }, 'Sandbox ready');

    // Create Sandbox client instance
    const sandbox = new Sandbox({
      sandboxId,
      sandboxUrl: url,
      provider,
      token,
    });

    return new ComputeSandbox(sandbox, projectGroupId, tenantKey);
  }

  /**
   * Find existing sandbox by (namespace, name) without creating
   */
  static async find({
    projectGroupId,
    tenantKey = 'default',
  }: {
    projectGroupId: string;
    tenantKey?: string;
  }): Promise<ComputeSandbox | null> {
    const config = getGatewayConfig();

    const response = await fetch(`${config.gatewayUrl}/v1/sandbox/find`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ComputeSDK-API-Key': config.apiKey,
        ...(config.provider && { 'X-Provider': config.provider }),
      },
      body: JSON.stringify({
        namespace: tenantKey,
        name: projectGroupId,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gateway API error: ${error}`);
    }

    const data = await response.json();
    if (!data.success) {
      return null;
    }

    if (!data.data) {
      return null; // Not found
    }

    const { sandboxId, url, token, provider } = data.data;

    const sandbox = new Sandbox({
      sandboxId,
      sandboxUrl: url,
      provider,
      token,
    });

    return new ComputeSandbox(sandbox, projectGroupId, tenantKey);
  }

  /**
   * Destroy the sandbox
   */
  async destroy(): Promise<void> {
    logger.info({ projectGroupId: this._projectGroupId }, 'Destroying sandbox');
    
    await this.unsubscribeFromEvents();

    const config = getGatewayConfig();

    const response = await fetch(
      `${config.gatewayUrl}/v1/sandbox/${this.sandboxId}`,
      {
        method: 'DELETE',
        headers: {
          'X-ComputeSDK-API-Key': config.apiKey,
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to destroy sandbox: ${error}`);
    }
  }

  // ---------------------------------------------------------------------------
  // SERVER HELPERS
  // ---------------------------------------------------------------------------

  async isServerRunning(name: string): Promise<boolean> {
    try {
      const info = await this.servers.retrieve(name);
      return info.status === 'running' || info.status === 'ready';
    } catch {
      return false;
    }
  }

  async isServerActive(name: string): Promise<boolean> {
    try {
      const info = await this.servers.retrieve(name);
      return ['starting', 'running', 'ready'].includes(info.status);
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // EVENTS
  // ---------------------------------------------------------------------------

  async subscribeToEvents(): Promise<void> {
    if (this.eventSubscription) return;

    logger.info({ projectGroupId: this._projectGroupId }, 'Subscribing to events');

    this.eventSubscription = createPubSubClient({
      accessToken: process.env['COMPUTESDK_ACCESS_TOKEN']!,
      sandboxId: this.sandboxId,
    });

    this.eventSubscription.on('event', (event) => {
      if (event.type === 'server.status_changed') {
        publish('SANDBOX_SERVER_UPDATE', this._projectGroupId, {
          projectGroupId: this._projectGroupId,
          sandboxId: this.sandboxId,
          serverName: event.data.serverName as string,
          status: event.data.status as string,
          url: (event.data.url as string) ?? null,
          error: (event.data.error as string) ?? null,
        });
      }

      if (event.type === 'sandbox.status_changed') {
        publish('SANDBOX_UPDATE', this._projectGroupId, {
          projectGroupId: this._projectGroupId,
          sandboxId: this.sandboxId,
          status: event.data.status as 'created' | 'ready' | 'destroyed' | 'error',
          error: (event.data.error as string) ?? null,
        });
      }
    });

    this.eventSubscription.on('error', (error) => {
      logger.error({ err: error }, 'Event subscription error');
    });

    await this.eventSubscription.connect();
  }

  async unsubscribeFromEvents(): Promise<void> {
    if (this.eventSubscription) {
      await this.eventSubscription.disconnect();
      this.eventSubscription = null;
    }
  }
}

/**
 * Helper to get gateway configuration from environment
 */
function getGatewayConfig(): GatewayConfig {
  const gatewayUrl = process.env.COMPUTESDK_GATEWAY_URL || 'https://gateway.computesdk.com';
  const apiKey = process.env.COMPUTESDK_API_KEY;

  if (!apiKey) {
    throw new Error(
      'COMPUTESDK_API_KEY environment variable is required. ' +
      'Get your API key at: https://computesdk.com/dashboard'
    );
  }

  return {
    gatewayUrl,
    apiKey,
    provider: process.env.COMPUTESDK_PROVIDER,
  };
}

export default ComputeSandbox;
```

## Key Changes

### ✅ What's New
1. **Gateway API calls** instead of `compute.sandbox.*` 
2. **Direct REST API** to `/v1/sandbox/find-or-create` and `/v1/sandbox/find`
3. **Default namespace** of `"default"` when `tenantKey` not provided
4. **Manual Sandbox instantiation** from gateway response

### ❌ What's Removed
1. **`extendTimeout()`** - Not supported by gateway (just set long initial timeout)
2. **Redis dependency** - Gateway handles all mapping internally
3. **`compute` import** - Direct gateway API calls instead

### 🔄 What Stays the Same
1. All server helpers (`isServerRunning`, `isServerActive`)
2. Event subscription via `@computesdk/events`
3. Direct access to namespaces (`servers`, `files`, `commands`, `env`)
4. Same public API surface

## Usage Example

```typescript
// Find or create sandbox for a user's project
const sandbox = await ComputeSandbox.findOrCreate({
  projectGroupId: 'proj_123',
  tenantKey: 'user_456',
  timeout: 2 * 60 * 60 * 1000, // 2 hours
});

// Use it like before
await sandbox.servers.start({
  slug: 'dev-server',
  command: 'npm run dev',
  path: '/app',
});

const isRunning = await sandbox.isServerRunning('dev-server');

// Subscribe to events
await sandbox.subscribeToEvents();

// Later: Find existing sandbox
const existing = await ComputeSandbox.find({
  projectGroupId: 'proj_123',
  tenantKey: 'user_456',
});

if (existing) {
  console.log('Found existing sandbox:', existing.sandboxId);
}

// Clean up
await sandbox.destroy();
```

## Environment Variables Required

```bash
COMPUTESDK_API_KEY=computesdk_xxx           # Required
COMPUTESDK_GATEWAY_URL=https://...          # Optional (defaults to production)
COMPUTESDK_PROVIDER=e2b                     # Optional (defaults to gateway's default)
COMPUTESDK_ACCESS_TOKEN=...                 # Required for event subscriptions
```

## Migration Notes

If you have existing code using the old `ComputeSandbox`:

1. **`extendTimeout()` calls** → Remove or set longer initial timeout
2. **No other changes needed** → API surface is the same!

## Testing Checklist

- [ ] `findOrCreate` creates new sandbox on first call
- [ ] `findOrCreate` returns same sandbox on second call with same (namespace, name)
- [ ] `find` returns null when sandbox doesn't exist
- [ ] `find` returns sandbox when it exists
- [ ] `destroy` cleans up sandbox and mappings
- [ ] Server helpers work correctly
- [ ] Event subscriptions work
- [ ] Different `tenantKey` values create isolated sandboxes
