/**
 * The first-use state machine of a sandbox created lazily (`lazyCreate`).
 *
 * `create()` hands back a handle and sends nothing. The first call that needs
 * the sandbox starts its create; the first `runCommand()` starts it with the
 * command as the create's `run`, so one request creates the sandbox and runs
 * the command. Every other call, however many and however concurrent, waits
 * on that one request.
 *
 * A create the API refused (a 4xx answer) made nothing, since the API checks
 * every field, `run` included, before it makes anything. The calls that
 * waited on it get its error, except that a call that did not send the
 * refused `run` starts a plain create of its own, and the handle is left
 * unused for the next call. Any other failure is remembered and every later
 * call gets it: the request may have reached the API and made a sandbox, so it
 * is never sent again.
 */

import { randomUUID } from 'node:crypto';

/** A client-side id for a sandbox that has not been created yet. */
export function placeholderId(): string {
  return `lazy_${randomUUID()}`;
}

export class DeferredCreate<Run, Result> {
  private pending: Promise<Result> | undefined;
  private cancelled = false;

  constructor(
    private readonly placeholder: string,
    /** Sends the create, carrying `run` when given. */
    private readonly create: (run: Run | undefined) => Promise<Result>,
    /** Whether a failed create provably made nothing. */
    private readonly madeNothing: (error: unknown) => boolean,
  ) {}

  /** True once a create is running or has succeeded, or has failed in a way that may have made a sandbox. */
  get started(): boolean {
    return this.pending !== undefined;
  }

  /**
   * Starts the create unless one has started, carrying `run` when given.
   * `starter` is true only for the call that started it: only that call may
   * read the outcome of its `run` from the result.
   */
  begin(run?: Run): { starter: boolean; result: Promise<Result> } {
    if (this.pending !== undefined) {
      return {
        starter: false,
        result: this.pending.catch((error: unknown) => {
          if (this.madeNothing(error)) return this.begin().result;
          throw error;
        }),
      };
    }
    if (this.cancelled) {
      return {
        starter: false,
        result: Promise.reject(new Error(`Offstage: sandbox ${this.placeholder} was destroyed before it was created`)),
      };
    }
    const attempt = this.create(run);
    this.pending = attempt;
    // Registered before any waiter's handler, so a waiter that starts again finds the handle unused.
    attempt.catch((error: unknown) => {
      if (this.pending === attempt && this.madeNothing(error)) this.pending = undefined;
    });
    return { starter: true, result: attempt };
  }

  /**
   * Stops any further create from starting: later calls fail instead of
   * creating a sandbox the caller already destroyed. A create already running
   * still settles, so the caller can destroy what it made.
   */
  cancel(): void {
    this.cancelled = true;
  }

  /** Waits for a running create. True when it made the sandbox. Never throws. */
  async settled(): Promise<boolean> {
    if (this.pending === undefined) return false;
    try {
      await this.pending;
      return true;
    } catch {
      return false;
    }
  }
}
