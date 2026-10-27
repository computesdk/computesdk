/**
 * Sandbox wire types — mirror the response shapes of
 * benchmarks-platform `lib/sandboxes` (the `/api/v1/sandboxes` routes).
 * The API is the contract; keep in sync by hand.
 */

export interface SandboxCost {
  rate: { usd: number; unit: string } | null;
  runtimeSeconds: number;
  costUsd: number | null;
  settled: boolean;
}

/** `toSummary` — one row of GET /api/v1/sandboxes. */
export interface SandboxSummary {
  id: string;
  label: string | null;
  provider: string | null;
  providerSandboxId: string | null;
  status: 'creating' | 'running' | 'destroyed' | string;
  placementAttempts: unknown[];
  commandCount: number;
  secrets: string[];
  /** The `boot.image` asked for, and what the provider actually booted. */
  requestedImage: string | null;
  image: string | null;
  createdAt: string;
  lastCommandAt: string | null;
  destroyedAt: string | null;
  destroyError: string | null;
  /** The sandbox's configured timeout, when one was set at create. */
  timeoutMs: number | null;
  /** How the sandbox was placed — source, order type, rate, max price, the
   * requested platform `size` and the seller's `box` on a market fill. */
  placement: {
    source: 'market' | 'own-key';
    size?: string | null;
    box?: {
      provider: string;
      sizeName: string | null;
      resources?: { cpus: number | null; memoryMb: number | null; ephemeralDiskMb: number | null };
    };
    orderType?: 'market' | 'limit';
    rate: { usd: number; per: string };
    maxPrice?: { usd: number; per: string };
  } | null;
  cost: SandboxCost;
}

/** `toDetail` — POST /sandboxes and GET /sandboxes/{id}. */
export interface SandboxDetail extends SandboxSummary {
  /** BYOK direct-attach descriptor — null on market fills and ambient providers. */
  attach: { provider: string; providerSandboxId: string; region: string | null } | null;
}

export interface SandboxProcess {
  id: string;
  jobId: string;
  pid: number | null;
  command: string;
  cwd: string | null;
  envNames: string[];
  /** Whether the job's stdin pipe is open (spawn `--stdin`). */
  stdin: boolean;
  status: string;
  exitCode: number | null;
  signal: string | null;
  startedAt: string;
  exitedAt: string | null;
}

export interface SandboxProcessStatus extends SandboxProcess {
  stdout: string;
  stderr: string;
}

/** The commands route's JSON (non-SSE) result. */
export interface CommandResult {
  commandId: string;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
}

export type PathView =
  | { path: string; type: 'file'; content: string }
  | { path: string; type: 'directory'; entries: FileEntry[] };

/** `snapshotView` — one row of GET /sandboxes/{id}/snapshots. */
export interface SandboxSnapshot {
  id: string;
  sandboxId: string;
  provider: string;
  region: string | null;
  providerSnapshotId: string;
  label: string | null;
  expiresAt: string | null;
  createdAt: string;
  deletedAt: string | null;
}
