/**
 * Create-and-run: the one module that knows the runner's contract for
 * creating a sandbox and running its first command in a single request.
 *
 * Request: the usual create body plus
 *
 *   "run": { "command": "<string>", "timeout_ms": <int, optional> }
 *
 * `timeout_ms` may be left out; the runner then applies the exec default.
 * Any create the runner serves accepts the field.
 *
 * Response: 201 with the usual create body plus
 *
 *   "run": { "exit_code": <int|null>, "stdout": "", "stderr": "", "duration_ms": <int>, "error": <null|object> }
 *
 * `error` is null when the command ended. When it produced no result
 * (deadline, output allowance, spawn failure) `exit_code` is null and `error`
 * is the exec endpoint's own error object. The sandbox exists either way.
 *
 * A command the exec contract refuses refuses the whole create, and no
 * sandbox exists: 400 MISSING_PARAM, INVALID_PARAM, INVALID_TIMEOUT or
 * EXEC_TIMEOUT_UNSUPPORTED, or 413 RUNNER_COMMAND_TOO_LARGE. That is not
 * RUNNER_UNSUPPORTED_REQUEST, which still means the create itself is not
 * served here (environment, image, template, size) and goes to the account
 * API without the `run` field.
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

/** Body fields owned by this contract. Nothing but the runner understands them. */
const CONTRACT_FIELDS = ["run"] as const;

/** The first command, as the runner is asked to run it inside the create request. */
export interface RunSpec {
  readonly command: string;
  /** Left out of the request when absent, so the runner's own default applies. */
  readonly timeoutMs?: number;
}

/** What the runner reports back for that command. */
export interface RunOutcome {
  /** Null when the command produced no result; see `error`. */
  readonly exitCode: number | null;
  /** Why the command produced no result. Undefined when it ended. */
  readonly error: string | undefined;
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
    run: {
      command: run.command,
      ...(run.timeoutMs !== undefined ? { timeout_ms: run.timeoutMs } : {}),
    },
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
  const error = describeError(run["error"]);
  // Neither an exit code nor an error is no outcome at all: a runner that
  // ignored the field. Do not invent one.
  if (typeof exitCode !== "number" && error === undefined) return undefined;
  const durationMs = run["duration_ms"];
  return {
    exitCode: typeof exitCode === "number" ? exitCode : null,
    error,
    stdout: typeof run["stdout"] === "string" ? run["stdout"] : "",
    stderr: typeof run["stderr"] === "string" ? run["stderr"] : "",
    durationMs: typeof durationMs === "number" ? durationMs : undefined,
  };
}

/** A readable message from an error object or string; undefined for null. */
function describeError(error: unknown): string | undefined {
  if (error === null || error === undefined) return undefined;
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const shaped = error as { message?: unknown; code?: unknown };
    if (typeof shaped.message === "string") return shaped.message;
    if (typeof shaped.code === "string") return shaped.code;
  }
  return JSON.stringify(error);
}

/** Refusals of the `run` block by the exec contract. No sandbox is created. */
const RUN_REFUSAL_CODES = new Set([
  "MISSING_PARAM",
  "INVALID_PARAM",
  "INVALID_TIMEOUT",
  "EXEC_TIMEOUT_UNSUPPORTED",
  "RUNNER_COMMAND_TOO_LARGE",
]);

/**
 * True when a create failed because the runner refused the `run` block.
 * Such a create provisioned nothing, so the handle is left as it was and the
 * refusal is reported as the exec refusal it is.
 */
export function isRunRefusal(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const shaped = error as { name?: unknown; status?: unknown; code?: unknown };
  return (
    shaped.name === "RunnerError" &&
    (shaped.status === 400 || shaped.status === 413) &&
    typeof shaped.code === "string" &&
    RUN_REFUSAL_CODES.has(shaped.code)
  );
}

/** Thrown inside a lazy create whose `run` block the runner refused. */
export class RunRefused extends Error {
  readonly refusal: unknown;

  constructor(refusal: unknown) {
    super(refusal instanceof Error ? refusal.message : String(refusal));
    this.name = "RunRefused";
    this.refusal = refusal;
  }
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
 *
 * One failure is not remembered: a `RunRefused`. The runner refused the
 * command before creating anything, so the handle stays as it was, unused. The
 * call that sent the command gets the refusal; calls that were waiting on that
 * create start a plain one of their own.
 */
export class LazyCreate<T> {
  private pending: Promise<T> | undefined;

  constructor(
    private readonly create: (run: RunSpec | undefined) => Promise<T>
  ) {}

  private cancelled = false;

  /**
   * Stops any further create from starting. Later calls fail instead of
   * creating a sandbox the caller already destroyed, and that includes a call
   * that was waiting on a refused create and would otherwise start its own.
   * A create already running is not interrupted and still settles, so the
   * caller can destroy what it made.
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
      return {
        starter: false,
        result: this.pending.catch((error: unknown) => {
          if (error instanceof RunRefused) return this.begin().result;
          throw error;
        }),
      };
    }
    if (this.cancelled) {
      return {
        starter: false,
        result: Promise.reject(
          new Error("MIOSA sandbox was destroyed before it was created"),
        ),
      };
    }
    const attempt = this.create(run);
    this.pending = attempt;
    // Registered before any other call can wait on `attempt`, so the reset
    // happens before their retries look at `pending`.
    attempt.catch((error: unknown) => {
      if (error instanceof RunRefused && this.pending === attempt) {
        this.pending = undefined;
      }
    });
    return { starter: true, result: attempt };
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
