/**
 * Ambient contract for `@miosa/sdk`'s SOMA one-hop runner transport
 * (RUNNER-CONTRACTS-2026-10-02.md C5/C6 in the miosa repo's
 * tasks/soma-speed/), hand-written against
 * sdks/typescript/src/runner/runner-client.ts on branch
 * feat/sdk-soma-runner (miosa PR #213).
 *
 * `@miosa/sdk` has not published a version containing `RunnerClient` yet
 * (npm still tops out at 3.2.5, no runner module), so there are no real
 * types on disk to resolve against. This file is the only reason this
 * package's dynamic `import("@miosa/sdk")` type-checks today.
 *
 * DELETE THIS FILE the moment a published `@miosa/sdk` version exports
 * `RunnerClient` - its real `.d.ts` take over module resolution, and this
 * ambient declaration would then just be a redundant (and driftable) second
 * source of truth. Until then, keep it byte-for-byte in sync with the real
 * class's public surface; nothing here should be used by the real package's
 * other call sites, so this covers only what this provider calls.
 */
declare module "@miosa/sdk" {
  export interface RunnerClientOptions {
    apiKey: string;
    /** Overrides the default region (`us` - no API key carries a region this release, C5). */
    region?: string;
    /** Overrides `miosa.ai` - for self-hosted / test deployments. */
    baseDomain?: string;
    tenant?: string;
  }

  export interface RunnerExecOptions {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  }

  export interface RunnerSandboxCreateResult {
    /** Empty string if the response body carried no `id` field. */
    id: string;
    /** The runner host that owns this sandbox - cached for exec/destroy. */
    runnerIp: string;
    data: Record<string, unknown>;
  }

  export class RunnerClient {
    constructor(options: RunnerClientOptions);
    readonly region: string;
    readonly hostname: string;

    /**
     * POST /api/v1/sandboxes against the region hostname. On `503
     * runtime_busy`/`feed_stale` or a connect failure, retries on the next
     * resolved IP, at most n-1 times (C6).
     */
    createSandbox(
      params?: Record<string, unknown>,
      opts?: { idempotencyKey?: string },
    ): Promise<RunnerSandboxCreateResult>;

    exec(
      sandboxId: string,
      command: string,
      opts?: RunnerExecOptions,
    ): Promise<Record<string, unknown>>;

    destroySandbox(sandboxId: string): Promise<void>;

    close(): Promise<void>;
  }
}
