/**
 * Create-and-run: the one module that knows the runner's contract for
 * creating a sandbox and running its first command in a single request.
 *
 * Request: the usual create body plus
 *
 *   "run": { "command": "<string>", "timeout_ms": <int> }
 *
 * Response: 201 with the usual create body plus
 *
 *   "run": { "exit_code": <int>, "stdout": "<string>", "stderr": "<string>", "duration_ms": <int> }
 *
 * A runner that does not know the field answers a plain create, with no
 * `run` in the response. Callers treat that as "the sandbox exists, the
 * command has not run" and send the command the ordinary way, so a runner
 * that has not shipped the field yet costs one extra request, never a
 * duplicate sandbox.
 *
 * If the contract changes, this file is the only place that has to.
 */

import { randomUUID } from "node:crypto";

/** The environment switch that turns lazy creation on. Off unless set to "1" or "true". */
export const LAZY_CREATE_ENV = "MIOSA_LAZY_CREATE";

/** The runner's own default for a single command (RUNNER-CONTRACTS C2: 30 seconds). */
export const DEFAULT_RUN_TIMEOUT_MS = 30_000;

/** Body fields owned by this contract. Nothing but the runner understands them. */
const CONTRACT_FIELDS = ["run"] as const;

/** The first command, as the runner is asked to run it inside the create request. */
export interface RunSpec {
  readonly command: string;
  readonly timeoutMs: number;
}

/** What the runner reports back for that command. */
export interface RunOutcome {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Absent when the runner did not report it. */
  readonly durationMs: number | undefined;
}

/** Adds the first command to a create body. Returns a new object. */
export function withRun(
  body: Record<string, unknown>,
  run: RunSpec
): Record<string, unknown> {
  return {
    ...body,
    run: { command: run.command, timeout_ms: run.timeoutMs },
  };
}

/**
 * Removes every field this contract owns. The account API does not know
 * them, so a create handed to it must not carry them.
 */
export function withoutRun(
  body: Record<string, unknown>
): Record<string, unknown> {
  const copy = { ...body };
  for (const field of CONTRACT_FIELDS) delete copy[field];
  return copy;
}

/**
 * Reads the first command's outcome from a create response. Returns
 * undefined when the response carries none - a runner that ignored the
 * field, or a create the account API served.
 */
export function readRun(
  response: Record<string, unknown> | undefined,
): RunOutcome | undefined {
  // The create body may arrive flat or wrapped in { data }; the outcome sits
  // beside the sandbox record either way.
  const nested = response?.["data"];
  const raw =
    response?.["run"] ??
    (typeof nested === "object" && nested !== null
      ? (nested as Record<string, unknown>)["run"]
      : undefined);
  if (typeof raw !== "object" || raw === null) return undefined;
  const run = raw as Record<string, unknown>;
  const exitCode = run["exit_code"];
  // Without an exit code there is no outcome to report; do not invent one.
  if (typeof exitCode !== "number") return undefined;
  const durationMs = run["duration_ms"];
  return {
    exitCode,
    stdout: typeof run["stdout"] === "string" ? run["stdout"] : "",
    stderr: typeof run["stderr"] === "string" ? run["stderr"] : "",
    durationMs: typeof durationMs === "number" ? durationMs : undefined,
  };
}

/**
 * Whether a command can ride in the create request. The contract carries a
 * command and a timeout only; anything else about how it runs has to go
 * through an ordinary exec once the sandbox exists.
 */
export function canRunInCreate(options?: {
  cwd?: string;
  env?: Record<string, string>;
  background?: boolean;
}): boolean {
  return (
    options?.cwd === undefined &&
    options?.env === undefined &&
    options?.background !== true
  );
}

/** A client-side id for a sandbox that has not been created yet. */
export function placeholderId(): string {
  return `lazy-${randomUUID()}`;
}

/** Whether `id` was minted by `placeholderId`. */
export function isPlaceholderId(id: string): boolean {
  return id.startsWith("lazy-");
}

/**
 * The first-call state machine of one lazy sandbox.
 *
 * The first caller to `begin` starts the create; every other caller, however
 * many and however concurrent, shares that one request. The outcome is
 * remembered, failure included: a create that failed is never sent again,
 * because the request may have reached the server and a second one could
 * provision a second sandbox. Later calls see the same error the first one
 * did.
 */
export class LazyCreate<T> {
  private pending: Promise<T> | undefined;

  constructor(
    private readonly create: (run: RunSpec | undefined) => Promise<T>
  ) {}

  private cancelled = false;

  /**
   * Stops a create that has not started from ever starting. Later calls
   * fail instead of creating a sandbox the caller already destroyed. Has no
   * effect once a create has started.
   */
  cancel(): void {
    this.cancelled = true;
  }

  /** True once any call has started the create. */
  get started(): boolean {
    return this.pending !== undefined;
  }

  /**
   * Starts the create if no call has, carrying `run` when given. `starter`
   * is true only for the call that started it; only that call may consume
   * the command outcome in the result.
   */
  begin(run?: RunSpec): { starter: boolean; result: Promise<T> } {
    if (this.pending !== undefined) {
      return { starter: false, result: this.pending };
    }
    if (this.cancelled) {
      return {
        starter: false,
        result: Promise.reject(
          new Error("MIOSA sandbox was destroyed before it was created"),
        ),
      };
    }
    this.pending = this.create(run);
    return { starter: true, result: this.pending };
  }

  /**
   * Resolves when the create has finished, or immediately if none started.
   * Never throws: for a caller that only needs to know whether a sandbox
   * came to exist, such as destroy.
   */
  async settled(): Promise<T | undefined> {
    if (this.pending === undefined) return undefined;
    try {
      return await this.pending;
    } catch {
      return undefined;
    }
  }
}
