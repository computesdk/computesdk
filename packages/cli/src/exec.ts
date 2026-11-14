import { ActionsCliError, type ActionsClient } from './actions-client.js';
import { output, type CommonOpts } from './actions.js';
import type { CommandResult, SandboxProcess, SandboxProcessStatus } from '@computesdk/platform';

/** A single argument is a shell program; multiple arguments preserve argv. */
export function execCommand(args: string[]): string {
  return args.length === 1 ? args[0] : args.map((arg) => `'${arg.replace(/'/g, `'\\''`)}'`).join(' ');
}

export interface ExecOpts extends CommonOpts {
  cwd?: string;
  env?: string[];
  timeout?: string;
  timeoutMs?: string;
  detach?: boolean;
  stream?: boolean;
}

// The buffered command endpoint has a 300s route lifetime and reserves 10s.
const BUFFERED_MAX_MS = 290_000;

export function execTimeout(opts: ExecOpts): number | undefined {
  if (opts.detach && (opts.stream || opts.timeout !== undefined || opts.timeoutMs !== undefined)) {
    throw new ActionsCliError('invalid_argument', '--detach cannot be combined with --stream or a command timeout.');
  }
  if (opts.timeout !== undefined && opts.timeoutMs !== undefined) {
    throw new ActionsCliError('invalid_argument', 'Use --timeout (seconds) or --timeout-ms, not both.');
  }
  const raw = opts.timeout ?? opts.timeoutMs;
  if (raw === undefined) return undefined;
  const ms = Number(raw) * (opts.timeout !== undefined ? 1000 : 1);
  if (raw.trim() === '' || !Number.isSafeInteger(ms) || ms < 0 || ms > 2_147_483_647) {
    throw new ActionsCliError('invalid_argument', 'Timeout must be a non-negative duration up to 2147483647 ms (0 means no command time limit).');
  }
  return ms;
}

/** Execute against an existing sandbox; no provisioning or automatic retries. */
export async function execute(
  c: ActionsClient,
  sandboxId: string,
  body: { command: string; cwd?: string; env?: Record<string, string> },
  opts: ExecOpts,
): Promise<void> {
  const timeoutMs = execTimeout(opts);
  if (!opts.detach && !opts.stream && timeoutMs !== 0 && (timeoutMs === undefined || timeoutMs <= BUFFERED_MAX_MS)) {
    const res = await c.post<{ commandId: string } & CommandResult>(
      `/api/v1/sandboxes/${sandboxId}/commands`,
      { ...body, ...(timeoutMs !== undefined ? { timeoutMs } : {}) },
    );
    output(opts, res, (r) => {
      process.stdout.write(r.stdout);
      if (r.stderr) process.stderr.write(r.stderr);
      if (!r.stdout) console.log(`exit ${r.exitCode} (${r.durationMs}ms)`);
    });
    if (res.exitCode !== 0) process.exitCode = res.exitCode;
    return;
  }
  const { process: job } = await c.post<{ process: SandboxProcess }>(
    `/api/v1/sandboxes/${sandboxId}/processes`, body,
  );
  if (opts.detach) {
    output(opts, job, (p) => {
      console.log(p.jobId);
      console.error(`Follow: compute logs ${sandboxId} ${p.jobId} --follow`);
    });
    return;
  }
  // Use bounded waits and cumulative output so jobs can outlive a single
  // HTTP request, without replaying output or starting another process.
  await streamJob(c, sandboxId, job.jobId, timeoutMs ?? BUFFERED_MAX_MS, opts);
}

async function streamJob(c: ActionsClient, sandboxId: string, jobId: string, timeoutMs: number, opts: ExecOpts): Promise<void> {
  const base = `/api/v1/sandboxes/${sandboxId}/processes/${jobId}`;
  const controller = new AbortController();
  let stopCode: number | undefined;
  let stopping: Promise<void> | undefined;
  let killError: string | undefined;
  const stop = (code: number, signal: string) => {
    if (stopping) return;
    stopCode = code;
    stopping = c.post(`${base}/kill`, { signal }, { signal: AbortSignal.timeout(10_000) })
      .then(() => undefined)
      .catch(() => {
        killError = `Could not stop job ${jobId}; run compute instances kill ${sandboxId} ${jobId}.`;
        if (!opts.json) console.error(killError);
      })
      .finally(() => controller.abort());
  };
  const onInterrupt = () => stop(130, 'SIGINT');
  const onTerminate = () => stop(143, 'SIGTERM');
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  const deadline = timeoutMs === 0 ? undefined : Date.now() + timeoutMs;
  const timer = timeoutMs === 0 ? undefined : setTimeout(() => stop(124, 'SIGKILL'), timeoutMs);
  let stdoutOffset = 0;
  let stderrOffset = 0;
  try {
    while (stopCode === undefined) {
      const remaining = deadline === undefined ? 1000 : deadline - Date.now();
      if (remaining <= 0) { stop(124, 'SIGKILL'); break; }
      const { process: status } = await c.post<{ process: SandboxProcessStatus }>(
        `${base}/wait`, { timeoutMs: Math.min(1000, remaining) },
        { signal: controller.signal },
      );
      const emit = (event: string, data: Record<string, unknown>) => {
        if (opts.json) process.stdout.write(JSON.stringify({ event, ...data }) + '\n');
        else if (event === 'stdout') process.stdout.write(String(data.chunk));
        else if (event === 'stderr') process.stderr.write(String(data.chunk));
      };
      if (status.stdout.length > stdoutOffset) emit('stdout', { chunk: status.stdout.slice(stdoutOffset) });
      if (status.stderr.length > stderrOffset) emit('stderr', { chunk: status.stderr.slice(stderrOffset) });
      stdoutOffset = status.stdout.length;
      stderrOffset = status.stderr.length;
      if (status.status === 'exited') {
        const code = status.exitCode ?? 128;
        emit('exit', { exitCode: code });
        if (code !== 0) process.exitCode = code;
        return;
      }
    }
  } catch (error) {
    if (stopCode === undefined) {
      // The process may still be running. Do not replay the start request.
      const recovery = `Job ${jobId} remains available: compute logs ${sandboxId} ${jobId} --follow`;
      if (error instanceof Error) {
        error.message += `. ${recovery}`;
        throw error;
      }
      throw new Error(`${String(error)}. ${recovery}`);
    }
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    await stopping;
    if (stopCode !== undefined) {
      process.exitCode = stopCode;
      if (opts.json) process.stdout.write(JSON.stringify({ event: 'exit', exitCode: stopCode, ...(killError ? { error: killError } : {}) }) + '\n');
    }
  }
}
