/**
 * Exit-code recovery for Sandock shell commands.
 *
 * Sandock's shell API (as of sandock@2.6.0) reports every non-zero exit as
 * `1`, so `exit 3` and `false` look the same to the caller. To hand ComputeSDK
 * the real exit code, each command runs in a subshell and its status is
 * printed to stderr behind a per-call marker, which is stripped again before
 * the output reaches the caller.
 *
 * TODO: drop this once the Sandock API returns the command's own exit code.
 */

import { randomBytes } from 'node:crypto';

export interface ExitMarker {
  /** The text printed (to stderr) right before the exit code. */
  readonly head: string;
  /** `command`, wrapped so that its exit code is printed behind the marker. */
  wrap(command: string): string;
  /** Removes the marker from collected stderr and returns the exit code it carried. */
  extract(stderr: string): { stderr: string; exitCode: number | undefined };
}

export function createExitMarker(nonce: string = randomBytes(8).toString('hex')): ExitMarker {
  const token = `__COMPUTESDK_EXIT_${nonce}__=`;
  const head = `\n${token}`;
  return {
    head,
    wrap(command: string): string {
      // The newlines keep a trailing comment or heredoc in `command` from
      // swallowing the closing parenthesis.
      return `(\n${command}\n); __csdk_rc=$?; printf '\\n${token}%d' "$__csdk_rc" 1>&2; exit $__csdk_rc`;
    },
    extract(stderr: string) {
      const at = stderr.lastIndexOf(head);
      if (at < 0) return { stderr, exitCode: undefined };
      const digits = /^\d+/.exec(stderr.slice(at + head.length));
      if (!digits) return { stderr, exitCode: undefined };
      return {
        stderr: stderr.slice(0, at) + stderr.slice(at + head.length + digits[0].length),
        exitCode: Number(digits[0]),
      };
    },
  };
}

/**
 * Streams stderr chunks through to `emit` with the exit marker removed. Text
 * that could be the start of the marker is held back until the next chunk (or
 * `end()`) shows whether it is.
 */
export class StderrMarkerFilter {
  private buffer = '';
  private exitCode: number | undefined;

  constructor(
    private readonly head: string,
    private readonly emit?: (chunk: string) => void
  ) {}

  push(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const at = this.buffer.indexOf(this.head);
      if (at >= 0) {
        this.flush(this.buffer.slice(0, at));
        const rest = this.buffer.slice(at + this.head.length);
        const digits = /^\d+/.exec(rest);
        if (digits && digits[0].length < rest.length) {
          // The marker and its whole exit code have arrived.
          this.exitCode = Number(digits[0]);
          this.buffer = rest.slice(digits[0].length);
          continue;
        }
        if (!digits && rest.length > 0) {
          // Looked like the marker but carries no exit code: ordinary output.
          this.flush(this.head);
          this.buffer = rest;
          continue;
        }
        // More digits may follow.
        this.buffer = this.buffer.slice(at);
        return;
      }
      const keep = this.partialMarkerLength();
      this.flush(this.buffer.slice(0, this.buffer.length - keep));
      this.buffer = this.buffer.slice(this.buffer.length - keep);
      return;
    }
  }

  /** Flushes held-back text and returns the exit code the marker carried, if it arrived. */
  end(): number | undefined {
    if (this.buffer.startsWith(this.head)) {
      const rest = this.buffer.slice(this.head.length);
      if (/^\d+$/.test(rest)) {
        this.exitCode = Number(rest);
        this.buffer = '';
      }
    }
    this.flush(this.buffer);
    this.buffer = '';
    return this.exitCode;
  }

  /** Length of the longest buffer suffix that is a prefix of the marker. */
  private partialMarkerLength(): number {
    const max = Math.min(this.head.length - 1, this.buffer.length);
    for (let k = max; k > 0; k -= 1) {
      if (this.buffer.endsWith(this.head.slice(0, k))) return k;
    }
    return 0;
  }

  private flush(text: string): void {
    if (text && this.emit) this.emit(text);
  }
}
