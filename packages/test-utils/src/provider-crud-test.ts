/**
 * Focused CRUD Test Suite for ComputeSDK Providers
 * 
 * Tests the core sandbox lifecycle: create → getById → list → destroy
 */

import { describe, it, expect, afterAll } from 'vitest';
import { waitForSandboxAbsence, withDeadline } from './provider-lifecycle';
// @ts-ignore - workspace reference
import type { Provider } from '@computesdk/provider';

export interface ProviderCrudTestConfig {
  /** The provider instance to test */
  provider: Provider;
  /** Provider name for test descriptions */
  name: string;
  /** Custom test timeout in milliseconds */
  timeout?: number;
  /** Skip tests that require real API calls */
  skipIntegration?: boolean;
  /**
   * Execute the existing CRUD tests, not capability certification. Undefined
   * preserves the legacy allowlist; true explicitly opts this provider in;
   * false forces a skip. This never overrides skipIntegration.
   */
  enabled?: boolean;
  /** Budget for SDK-reported absence (default: 10000ms, capped below the test timeout). */
  verificationTimeout?: number;
  /** Delay between successful, non-null absence queries (default: 250ms). */
  verificationPollInterval?: number;
}

/**
 * Centralized whitelist of providers that should run CRUD tests
 * 
 * By default only providers in this list execute CRUD tests. A caller may
 * explicitly opt a selected provider in with enabled: true, after separately
 * approving remote execution and checking credentials. The list itself is
 * unchanged; undefined preserves the legacy automatic execution policy.
 * 
 * This approach:
 * - Prevents CRUD test failures for providers with limited implementations
 * - Avoids issues like Vercel's ephemeral sandboxes not supporting listing
 * - Makes it explicit which providers are ready for full CRUD testing
 * - Simplifies CI by avoiding complex environment variable logic
 * 
 * This guard decides execution, not provider capability certification.
 */
const CRUD_ENABLED_PROVIDERS = [
  'railway',  // Has working CRUD operations with stable sandbox lifecycle
  'render',   // Stable provider ready for CRUD testing
  'lambda',   // Lambda provider with instance lifecycle management
  'namespace',
  'avm',
  'northflank', // Service-per-sandbox lifecycle is fully stable and listed
  'isorun',   // Isolated Linux VM, full create/getById/list/destroy lifecycle
  'agentcore', // AgentCore Code Interpreter sessions support full CRUD lifecycle
  'novita',   // Novita's test entry point requires explicit integration opt-in and credentials
  // Add more providers here as they become stable for CRUD testing
  // 'e2b',      // Add when CRUD implementation is stable
  // 'vercel',   // Skip - ephemeral sandboxes don't support listing operations
];

export function runProviderCrudTest(config: ProviderCrudTestConfig) {
  const {
    provider, name, timeout = 30000, skipIntegration = false, enabled,
    verificationTimeout = 10000, verificationPollInterval = 250,
  } = config;
  const crudEnabled = enabled === undefined
    ? CRUD_ENABLED_PROVIDERS.includes(name)
    : enabled === true;

  // A native invocation must not turn an unconfigured/disabled suite into a
  // successful all-skipped run. Collection fails before any provider call.
  if (process.env.COMPUTESDK_CONFORMANCE_NATIVE === '1' && (skipIntegration || !crudEnabled)) {
    throw new Error(`[CRUD ${name}] Native conformance cannot skip CRUD: enable the selected suite and provide its required configuration`);
  }

  // These five cases deliberately share one lifecycle. An enclosing suite or
  // global --sequence.concurrent must not destroy/read before create completes.
  describe.sequential(`${name} Provider CRUD Operations`, () => {
    // Check if this provider should run CRUD tests
    if (!crudEnabled) {
      it.skip(`CRUD tests not enabled for ${name} provider`, () => {
        console.log(`Skipping CRUD tests for ${name} - not in enabled providers list`);
        console.log(`Enabled providers: ${CRUD_ENABLED_PROVIDERS.join(', ')}`);
      });
      return;
    }

    if (skipIntegration) {
      it.skip('Integration tests skipped - missing credentials', () => {});
      return;
    }

    for (const duration of [timeout, verificationTimeout, verificationPollInterval]) {
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error(`[CRUD ${name}] Timeouts and poll intervals must be finite positive milliseconds`);
      }
    }

    let createdSandboxId: string | undefined;
    // A destroy acknowledgement does not establish absence. Retain every
    // allocated ID (including retry attempts) until getById actually says null.
    const ownedSandboxIds = new Set<string>();
    const pendingAllocations = new Set<Promise<void>>();
    const activeCleanups = new Map<string, Promise<void>>();
    let cleanupStarted = false;
    let lateCleanupFailed = false;
    const verifyAbsence = async (id: string, timeoutMs = Math.min(verificationTimeout, timeout / 2)) => {
      await waitForSandboxAbsence(() => provider.sandbox.getById(id), {
        timeoutMs,
        pollIntervalMs: verificationPollInterval,
        failureMessage: `[CRUD ${name}] SDK-reported absence was not verified before the deadline`,
      });
      ownedSandboxIds.delete(id);
    };

    const cleanupOwnedId = (id: string): Promise<void> => {
      const active = activeCleanups.get(id);
      if (active) return active;
      const cleanup = (async () => {
        const deadline = Date.now() + 10000;
        try {
          await withDeadline(
            () => provider.sandbox.destroy(id), deadline - Date.now(),
            `[CRUD cleanup ${name}] Destroy failed or exceeded its deadline`,
          );
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new Error('Cleanup deadline');
          await verifyAbsence(id, Math.min(verificationTimeout, timeout / 2, remaining));
        } catch {
          // Do not print or attach native errors: they can contain credentials.
          throw new Error(`[CRUD cleanup ${name}] Failed to verify cleanup of an owned sandbox`);
        }
      })();
      activeCleanups.set(id, cleanup);
      // Observe both branches; later cleanup can retry a failed attempt, but
      // overlapping cleanup of the same returned ID is never duplicated.
      void cleanup.then(
        () => { activeCleanups.delete(id); },
        () => { activeCleanups.delete(id); },
      );
      return cleanup;
    };

    // Separate hook failures preserve the original test failure. Only the IDs
    // returned by this suite's create calls are eligible for cleanup.
    afterAll(async () => {
      cleanupStarted = true;
      let allocationUnresolved = false;
      if (pendingAllocations.size > 0) {
        try {
          await withDeadline(
            () => Promise.all([...pendingAllocations]), Math.min(timeout / 2, 4000),
            `[CRUD cleanup ${name}] Allocation remained unresolved during cleanup`,
          );
        } catch {
          allocationUnresolved = true;
        }
      }
      const results = await Promise.allSettled([...ownedSandboxIds].map(cleanupOwnedId));
      if (allocationUnresolved) {
        // Native creation cannot be cancelled by a promise deadline. Its
        // observer remains attached and will clean only its returned late ID.
        throw new Error(`[CRUD cleanup ${name}] Allocation remained unresolved during cleanup`);
      }
      if (lateCleanupFailed || results.some((result) => result.status === 'rejected')) {
        throw new Error(`[CRUD cleanup ${name}] Failed to verify cleanup of an owned sandbox`);
      }
    }, 15000);

    it('should create a sandbox', async () => {
      createdSandboxId = undefined;
      let attemptExpired = false;
      // Register ownership observation before awaiting the allocation. A
      // deadline observes creation; it does not cancel a native allocation.
      const allocation = Promise.resolve().then(() => provider.sandbox.create());
      const observed = allocation.then(async (result) => {
        const id = result?.sandboxId;
        if (typeof id === 'string' && id.length > 0) {
          ownedSandboxIds.add(id);
          if (attemptExpired || cleanupStarted) {
            try {
              await cleanupOwnedId(id);
            } catch {
              lateCleanupFailed = true;
              throw new Error(`[CRUD cleanup ${name}] Failed to verify cleanup of a late allocation`);
            }
          }
        }
        return { result, id };
      });
      // Do not let a late native rejection become an unhandled rejection.
      const settled = observed.then(() => {}, () => {});
      pendingAllocations.add(settled);
      void settled.then(() => { pendingAllocations.delete(settled); });

      try {
        const { result, id } = await withDeadline(
          () => observed, timeout / 2,
          `[CRUD ${name}] Create failed or exceeded its deadline`,
        );
        // An expired attempt never publishes its ID into another test/retry.
        createdSandboxId = id;
        expect(result).toBeDefined();
        expect(result.sandboxId).toBeDefined();
        expect(typeof result.sandboxId).toBe('string');
        expect(result.sandboxId.length).toBeGreaterThan(0);

        console.log(`✓ Created ${name} sandbox: ${createdSandboxId}`);
      } finally {
        attemptExpired = true;
      }
    }, timeout);

    it('should get sandbox by ID', async () => {
      expect(createdSandboxId).toBeDefined();
      
      const result = await provider.sandbox.getById(createdSandboxId!);
      
      expect(result).toBeDefined();
      expect(result?.sandboxId).toBe(createdSandboxId);
      
      console.log(`✓ Retrieved ${name} sandbox by ID: ${createdSandboxId}`);
    }, timeout);

    it('should list sandboxes and include created one', async () => {
      expect(createdSandboxId).toBeDefined();
      
      const sandboxes = await provider.sandbox.list();
      
      expect(Array.isArray(sandboxes)).toBe(true);
      
      // Find our sandbox in the list
      const ourSandbox = sandboxes.find((s: any) => s.sandboxId === createdSandboxId);
      expect(ourSandbox).toBeDefined();
      expect(ourSandbox?.sandboxId).toBe(createdSandboxId);
      
      console.log(`✓ Listed ${name} sandboxes, found our sandbox in ${sandboxes.length} total`);
    }, timeout);

    it('should destroy the sandbox', async () => {
      expect(createdSandboxId).toBeDefined();

      await withDeadline(
        () => provider.sandbox.destroy(createdSandboxId!), Math.min(timeout / 2, 10000),
        `[CRUD ${name}] Destroy failed or exceeded its deadline`,
      );

      console.log(`✓ ${name} acknowledged sandbox destruction`);
    }, timeout);

    it('should report sandbox absence after destruction', async () => {
      expect(createdSandboxId).toBeDefined();
      await verifyAbsence(createdSandboxId!);
      // This proves only the SDK's reported absence, not native physical deletion.
      console.log(`✓ ${name} SDK reports the destroyed sandbox absent`);
    }, timeout);
  });
}
