/**
 * The shell process tier: background processes, stdin and streaming output on
 * any instance whose provider can run a plain command, built only on that
 * provider's `runCommand`. See `shell-scripts.ts` for what runs in the box.
 */

import { randomBytes } from 'node:crypto';
import type {
  CommandResult,
  ProcessHandle,
  ProcessStatus,
  RunCommandOptions,
  StartProcessOptions,
} from './types/index.js';
import {
  DEFAULT_READ_BYTES,
  MAX_LONG_POLL_MS,
  REPLY_END,
  REPLY_MARKER,
  assertJobId,
  closeStdinScript,
  confirmScript,
  killScript,
  launchScript,
  readScript,
  singleLine,
  writeStdinScript,
} from './shell-scripts.js';

/** Runs one command in the instance — the provider's plain `runCommand`. */
export type CommandRunner = (command: string, options?: RunCommandOptions) => Promise<CommandResult>;

/** Exit code reported for a command killed by its in-box deadline. */
const TIMEOUT_EXIT_CODE = 124;
/** Client-side margin past a command's timeout before it stops waiting on the box. */
const CLIENT_DEADLINE_GRACE_MS = 15_000;
/** Each read exec may take its long-poll plus this long before the client gives up on it. */
const EXEC_GRACE_MS = 30_000;
/** Raw stdin bytes per write exec (keeps the base64 argument well under ARG_MAX). */
const STDIN_CHUNK_BYTES = 48 * 1024;
/** Accumulated output kept per stream on a handle; older output is dropped and `truncated` set. */
const MAX_BUFFERED_CHARS = 4 * 1024 * 1024;
/** A read window must hold one whole record (4096 bytes plus its header), or the cursor never advances. */
const MIN_READ_BYTES = 8 * 1024;

/** The instance lacks a tool the shell tier needs. */
export class ShellProcessUnsupportedError extends Error {
  readonly code = 'unsupported';
  constructor(readonly missing: string, message?: string) {
    super(message ?? `shell-process: unsupported — the instance has no \`${missing}\`, which the shell process tier needs`);
    this.name = 'ShellProcessUnsupportedError';
  }
}

/** The instance's execs share no files or processes (e.g. a fresh container per exec), so jobs cannot outlive one exec. */
export class ShellStateNotPersistentError extends ShellProcessUnsupportedError {
  constructor() {
    super('persistent state', 'shell-process: unsupported — this instance does not keep files or processes between commands, so live streaming and background processes are unavailable');
    this.name = 'ShellStateNotPersistentError';
  }
}

export interface ShellProcessOptions extends StartProcessOptions {
  /** Kill the whole process group (SIGKILL) this long after start, enforced in the box. */
  timeoutMs?: number;
  /** Remove the job directory this long after exit. Default 10 minutes. */
  retentionMs?: number;
  /** Raw log bytes per read exec. Default 16 KiB. */
  maxReadBytes?: number;
  /** Output kept per stream on the handle; older output is dropped and `truncated` set. Default 4 Mi chars. */
  maxBufferedChars?: number;
  /**
   * Hold the command until a second exec confirms the job directory is still
   * there, so an instance whose execs share no state is detected before the
   * command runs ({@link ShellStateNotPersistentError}). Costs one exec.
   */
  confirmStart?: boolean;
}

/** A process handle served by the shell tier. */
export interface ShellProcessHandle extends ProcessHandle {
  readonly runtime: 'shell';
  /** Byte offset in the job's framed log up to which output has been delivered. */
  readonly cursor: number;
}

export interface ShellLogRecord {
  stream: 'stdout' | 'stderr';
  /** Absolute offset of the record in out.log. */
  offset: number;
  /** Offset just past the record — the cursor for the next read. */
  end: number;
  data: Uint8Array;
}

export interface ShellJobRead {
  state: 'running' | 'exited' | 'missing';
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  /** Size of out.log when the job was read. */
  size: number;
  pid: number | null;
  /** Complete records in the returned window, in log order. */
  records: ShellLogRecord[];
}

function createJobId(): string {
  return `j${Date.now().toString(36)}${randomBytes(8).toString('hex')}`;
}

function replyLines(result: CommandResult, phase: string): string[] {
  const lines = (result.stdout ?? '').split('\n');
  const start = lines.findIndex((line) => line.startsWith(`${REPLY_MARKER} `));
  if (start === -1) {
    const detail = ((result.stderr ?? '') || (result.stdout ?? '')).trim().slice(-400);
    throw new Error(
      `shell-process: ${phase} got no reply (exit code ${result.exitCode ?? 'unknown'})` + (detail ? `: ${detail}` : '')
    );
  }
  return lines.slice(start);
}

/** Parses framed records `O<len>\n<bytes>` / `E<len>\n<bytes>`; a trailing partial record is left for the next read. */
export function parseFramedLog(window: Uint8Array, baseOffset: number): ShellLogRecord[] {
  const records: ShellLogRecord[] = [];
  let pos = 0;
  while (pos < window.length) {
    const tag = window[pos];
    if (tag !== 0x4f && tag !== 0x45) throw new Error(`shell-process: corrupt log record at offset ${baseOffset + pos}`);
    const newline = window.indexOf(0x0a, pos + 1);
    if (newline === -1) break;
    const length = Number(Buffer.from(window.subarray(pos + 1, newline)).toString('ascii'));
    if (!Number.isSafeInteger(length) || length < 0) throw new Error(`shell-process: corrupt log record at offset ${baseOffset + pos}`);
    const end = newline + 1 + length;
    if (end > window.length) break;
    records.push({
      stream: tag === 0x4f ? 'stdout' : 'stderr',
      offset: baseOffset + pos,
      end: baseOffset + end,
      data: window.subarray(newline + 1, end),
    });
    pos = end;
  }
  return records;
}

/**
 * Only signals the tier sent itself are reported: a shell exit status of 128+n
 * cannot tell a signal death from a command that ran `exit 143`.
 */
function signalFor(exitCode: number | null, recorded: string | null, timedOut: boolean): string | null {
  if (exitCode === null || exitCode <= 128) return null;
  if (timedOut) return 'SIGKILL';
  return recorded;
}

/** One exec: the job's state plus the log window after `cursor`, optionally long-polled in the box. */
export async function readShellJob(
  run: CommandRunner,
  jobId: string,
  options: { cursor: number; maxBytes?: number; waitMs?: number; untilOutput?: boolean }
): Promise<ShellJobRead> {
  const waitMs = Math.min(options.waitMs ?? 0, MAX_LONG_POLL_MS);
  const result = await run(singleLine(readScript({ jobId, ...options, waitMs })), { timeout: waitMs + EXEC_GRACE_MS });
  const lines = replyLines(result, 'read');
  const [, state, code, sig, to, size, pid] = lines[0].trim().split(/\s+/);
  const endIndex = lines.findIndex((line) => line.trim() === REPLY_END);
  if (endIndex === -1) throw new Error('shell-process: read reply was cut off (provider output cap?)');
  const window = Buffer.from(lines.slice(1, endIndex).join('').replace(/\s+/g, ''), 'base64');
  const exitCode = code === undefined || code === '-' ? null : Number(code);
  const timedOut = to === '1';
  const recorded = sig && sig !== '-' ? sig : null;
  return {
    state: state === 'exited' || state === 'missing' ? state : 'running',
    exitCode,
    signal: signalFor(exitCode, recorded, timedOut),
    timedOut,
    size: Number(size) || 0,
    pid: pid && pid !== '-' ? Number(pid) : null,
    records: parseFramedLog(window, options.cursor),
  };
}

async function launchShellJob(run: CommandRunner, jobId: string, command: string, options: ShellProcessOptions): Promise<number | null> {
  const result = await run(
    singleLine(launchScript({
      jobId,
      command,
      cwd: options.cwd,
      env: options.env,
      stdin: options.stdin === true,
      timeoutMs: options.timeoutMs,
      retentionMs: options.retentionMs,
      hold: options.confirmStart,
    })),
    { timeout: 60_000 }
  );
  const [, verdict, detail] = replyLines(result, 'start')[0].trim().split(/\s+/);
  if (verdict === 'unsupported') throw new ShellProcessUnsupportedError(detail ?? 'unknown');
  if (verdict !== 'ok') throw new Error(`shell-process: process did not start (${detail ?? verdict})`);
  const pid = Number(detail);
  return Number.isFinite(pid) ? pid : null;
}

class ShellJob implements ShellProcessHandle {
  readonly runtime = 'shell' as const;
  pid: number | null;
  cursor = 0;
  private stdout = '';
  private stderr = '';
  private truncated = false;
  private readonly decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
  private last?: ShellJobRead;
  private exitFired = false;
  private watching = false;

  constructor(
    private readonly run: CommandRunner,
    readonly jobId: string,
    private readonly options: ShellProcessOptions,
    pid: number | null
  ) {
    this.pid = pid;
  }

  /** One read at the current cursor; applies only records that continue it, so concurrent reads never duplicate output. */
  async pull(waitMs = 0, untilOutput = false): Promise<ShellJobRead> {
    const read = await readShellJob(this.run, this.jobId, {
      cursor: this.cursor,
      maxBytes: Math.max(MIN_READ_BYTES, this.options.maxReadBytes ?? DEFAULT_READ_BYTES),
      waitMs,
      untilOutput,
    });
    if (read.state === 'missing') throw new Error(`shell-process: job ${this.jobId} not found (expired or never started)`);
    for (const record of read.records) {
      if (record.offset !== this.cursor) continue;
      this.cursor = record.end;
      const text = this.decoders[record.stream].decode(record.data, { stream: true });
      if (!text) continue;
      if (record.stream === 'stdout') {
        this.stdout = this.keep(this.stdout + text);
        this.options.onStdout?.(text);
      } else {
        this.stderr = this.keep(this.stderr + text);
        this.options.onStderr?.(text);
      }
    }
    if (read.pid !== null) this.pid = read.pid;
    this.last = read;
    return read;
  }

  private keep(buffer: string): string {
    const limit = this.options.maxBufferedChars ?? MAX_BUFFERED_CHARS;
    if (buffer.length <= limit) return buffer;
    this.truncated = true;
    return buffer.slice(buffer.length - limit);
  }

  /** True once the job has exited and every byte of its log has been delivered. */
  private settled(read: ShellJobRead): boolean {
    if (read.state !== 'exited' || this.cursor < read.size) return false;
    // Flush a multi-byte character split at the very end of the output.
    for (const stream of ['stdout', 'stderr'] as const) {
      const tail = this.decoders[stream].decode();
      if (!tail) continue;
      if (stream === 'stdout') { this.stdout += tail; this.options.onStdout?.(tail); }
      else { this.stderr += tail; this.options.onStderr?.(tail); }
    }
    this.fireExit(read);
    return true;
  }

  private fireExit(read: ShellJobRead): void {
    if (this.exitFired) return;
    this.exitFired = true;
    this.options.onExit?.({ exitCode: read.exitCode, signal: read.signal });
  }

  /** Reads until the job's output is caught up; returns the last read. */
  async catchUp(waitMs = 0, untilOutput = false): Promise<{ read: ShellJobRead; settled: boolean }> {
    let read = await this.pull(waitMs, untilOutput);
    while (this.cursor < read.size && read.records.length > 0) read = await this.pull();
    // A record cut short by a killed pump never completes; an exited job's log is final.
    if (read.state === 'exited' && read.records.length === 0) this.cursor = Math.max(this.cursor, read.size);
    return { read, settled: this.settled(read) };
  }

  /** Delivers callbacks until exit, one long-poll exec at a time. */
  watch(): void {
    if (this.watching) return;
    this.watching = true;
    void (async () => {
      let failures = 0;
      while (!this.exitFired) {
        try {
          await this.catchUp(MAX_LONG_POLL_MS, true);
          failures = 0;
        } catch {
          failures += 1;
          if (failures >= 3) return;
          await new Promise((resolve) => setTimeout(resolve, 500 * failures));
        }
      }
    })();
  }

  snapshot(read: ShellJobRead): ProcessStatus {
    return {
      status: read.state === 'exited' && this.cursor >= read.size ? 'exited' : 'running',
      exitCode: read.exitCode,
      signal: read.signal,
      stdout: this.stdout,
      stderr: this.stderr,
      truncated: this.truncated || undefined,
    };
  }

  result(read: ShellJobRead, startedAt: number): CommandResult & { signal: string | null } {
    return {
      stdout: this.stdout,
      stderr: this.stderr,
      exitCode: read.exitCode ?? -1,
      durationMs: Date.now() - startedAt,
      signal: read.signal,
    };
  }

  async write(data: string | Uint8Array): Promise<void> {
    if (!this.options.stdin) throw new Error(`shell-process: process ${this.jobId} was not started with stdin: true`);
    const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
    for (let offset = 0; offset < bytes.length || offset === 0; offset += STDIN_CHUNK_BYTES) {
      const chunk = bytes.subarray(offset, offset + STDIN_CHUNK_BYTES).toString('base64');
      const verdict = await this.control(writeStdinScript(this.jobId, chunk), 'stdin write');
      if (verdict !== 'ok') throw new Error(`shell-process: cannot write stdin of process ${this.jobId} (${verdict})`);
      if (bytes.length === 0) break;
    }
  }

  async closeStdin(): Promise<void> {
    await this.control(closeStdinScript(this.jobId), 'stdin close');
  }

  async status(): Promise<ProcessStatus> {
    return this.snapshot((await this.catchUp()).read);
  }

  async wait(options?: { timeout?: number }): Promise<CommandResult & { signal: string | null }> {
    const startedAt = Date.now();
    const deadline = options?.timeout !== undefined ? startedAt + options.timeout : undefined;
    for (;;) {
      const remaining = deadline !== undefined ? deadline - Date.now() : MAX_LONG_POLL_MS;
      if (remaining <= 0) throw new Error(`shell-process: process ${this.jobId} did not exit within ${options?.timeout}ms`);
      const { read, settled } = await this.catchUp(Math.min(remaining, MAX_LONG_POLL_MS));
      if (settled) return this.result(read, startedAt);
    }
  }

  async kill(signal = 'SIGTERM'): Promise<void> {
    await this.control(killScript(this.jobId, signal), 'kill');
  }

  private async control(script: string, phase: string): Promise<string> {
    const result = await this.run(singleLine(script), { timeout: 60_000 });
    const verdict = replyLines(result, phase)[0].trim().split(/\s+/)[1];
    if (verdict === 'missing') throw new Error(`shell-process: job ${this.jobId} not found (expired or never started)`);
    return verdict;
  }
}

/** Starts `command` detached in the box and returns its handle. */
export async function startShellProcess(
  run: CommandRunner,
  command: string,
  options: ShellProcessOptions = {}
): Promise<ShellProcessHandle> {
  const jobId = createJobId();
  const pid = await launchShellJob(run, jobId, command, options);
  if (options.confirmStart) {
    const result = await run(singleLine(confirmScript(jobId)), { timeout: 60_000 });
    const verdict = replyLines(result, 'start confirm')[0].trim().split(/\s+/)[1];
    if (verdict === 'missing') throw new ShellStateNotPersistentError();
    if (verdict !== 'ok') throw new Error(`shell-process: process did not start (${verdict})`);
  }
  const job = new ShellJob(run, jobId, options, pid);
  if (options.onStdout || options.onStderr || options.onExit) job.watch();
  return job;
}

/**
 * Reconstructs a handle for a job another client started, from its `jobId`.
 * Output is replayed from the start of the job's log. Pass `stdin: true` to
 * write to a job that was started with stdin.
 */
export function attachShellProcess(
  run: CommandRunner,
  jobId: string,
  options: ShellProcessOptions = {}
): ShellProcessHandle {
  assertJobId(jobId);
  const job = new ShellJob(run, jobId, options, null);
  if (options.onStdout || options.onStderr || options.onExit) job.watch();
  return job;
}

/**
 * Streaming `runCommand` over the shell tier: the command runs as a job and
 * its output is delivered by cursor long-polls while it runs. Only the
 * caller's `timeout` applies (enforced in the box; exit code 124).
 */
export async function runCommandViaShell(
  run: CommandRunner,
  command: string,
  options: RunCommandOptions,
  shellOptions: Pick<ShellProcessOptions, 'confirmStart' | 'maxReadBytes'> = {}
): Promise<CommandResult> {
  const startedAt = Date.now();
  const job = (await startShellProcess(run, command, {
    ...shellOptions,
    // A command's result carries all of its output, as plain runCommand does.
    maxBufferedChars: Number.POSITIVE_INFINITY,
    cwd: options.cwd,
    env: options.env,
    timeoutMs: options.timeout,
    onStdout: options.onStdout,
    onStderr: options.onStderr,
  })) as ShellJob;
  const clientDeadline = options.timeout !== undefined ? startedAt + options.timeout + CLIENT_DEADLINE_GRACE_MS : undefined;
  let failures = 0;
  for (;;) {
    if (clientDeadline !== undefined && Date.now() > clientDeadline) {
      await job.kill('SIGKILL').catch(() => {});
      const status = job.snapshot({ state: 'exited', exitCode: TIMEOUT_EXIT_CODE, signal: 'SIGKILL', timedOut: true, size: 0, pid: job.pid, records: [] });
      return { stdout: status.stdout, stderr: status.stderr, exitCode: TIMEOUT_EXIT_CODE, durationMs: Date.now() - startedAt };
    }
    try {
      const { read, settled } = await job.catchUp(MAX_LONG_POLL_MS, true);
      failures = 0;
      if (settled) {
        const result = job.result(read, startedAt);
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: read.timedOut ? TIMEOUT_EXIT_CODE : result.exitCode,
          durationMs: result.durationMs,
        };
      }
    } catch (error) {
      failures += 1;
      if (failures >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * failures));
    }
  }
}

/**
 * The shell tier for one instance. The first launch is held until a confirm
 * exec proves the instance keeps state between commands; the verdict is
 * cached. On an instance that keeps none, streaming and `startProcess` throw
 * {@link ShellStateNotPersistentError}; buffered commands remain available.
 */
export class ShellProcessRuntime {
  private state: 'unknown' | 'persistent' | 'ephemeral' = 'unknown';

  constructor(private readonly run: CommandRunner) {}

  get supportsPersistentState(): boolean {
    return this.state !== 'ephemeral';
  }

  async startProcess(command: string, options: ShellProcessOptions = {}): Promise<ShellProcessHandle> {
    if (this.state === 'ephemeral') throw new ShellStateNotPersistentError();
    try {
      const handle = await startShellProcess(this.run, command, { ...options, confirmStart: this.state !== 'persistent' });
      this.state = 'persistent';
      return handle;
    } catch (error) {
      if (error instanceof ShellStateNotPersistentError) this.state = 'ephemeral';
      throw error;
    }
  }

  async runCommand(command: string, options: RunCommandOptions): Promise<CommandResult> {
    if (this.state !== 'ephemeral') {
      try {
        const result = await runCommandViaShell(this.run, command, options, { confirmStart: this.state !== 'persistent' });
        this.state = 'persistent';
        return result;
      } catch (error) {
        if (!(error instanceof ShellStateNotPersistentError)) throw error;
        this.state = 'ephemeral';
      }
    }
    if (options.onStdout || options.onStderr) throw new ShellStateNotPersistentError();
    return await this.run(command, options);
  }

  attachProcess(jobId: string, options: ShellProcessOptions = {}): ShellProcessHandle {
    return attachShellProcess(this.run, jobId, options);
  }
}
