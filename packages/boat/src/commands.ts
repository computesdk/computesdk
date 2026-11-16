import { runCommand as runBoatCommand } from '@boatdev/sdk';
import { escapeShellArg } from '@computesdk/provider';
import type { CommandResult, RunCommandOptions } from 'computesdk';
import type { BoatSandbox } from './index';


function commandText(command: string, options?: RunCommandOptions): string {
  let text = command;
  if (options?.env && Object.keys(options.env).length > 0) {
    const env = Object.entries(options.env).map(([key, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid environment variable name: ${key}`);
      return `"${escapeShellArg(`${key}=${value}`)}"`;
    }).join(' ');
    // Absolute path: env resolves its command with the caller's PATH, which may have no shell.
    text = `env ${env} /bin/sh -c "${escapeShellArg(command)}"`;
  }
  // Exit on a failed cd so no statement of a multi-statement command runs elsewhere.
  return options?.cwd ? `cd -- "${escapeShellArg(options.cwd)}" || exit\n${text}` : text;
}

/** Stream every foreground command to avoid synchronous output limits. */
export async function run(sandbox: BoatSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> {
  const start = Date.now();
  const text = commandText(command, options);
  if (options?.timeout !== undefined && (!Number.isFinite(options.timeout) || options.timeout < 0)) {
    throw new Error('Boat command timeout must be non-negative milliseconds; 0 means unlimited.');
  }
  if (options?.background) {
    await sandbox.api.command({ sandboxId: sandbox.id, commandRequest: { command: text, detached: true } });
    return { stdout: '', stderr: '', exitCode: 0, durationMs: Date.now() - start };
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let processId: number | undefined;
  let timedOut = false;
  let stdout = '';
  let stderr = '';
  const result = (exitCode: number) => ({ stdout, stderr, exitCode, durationMs: Date.now() - start });
  try {
    for await (const frame of runBoatCommand(sandbox.api, sandbox.id, text, { signal: controller.signal })) {
      if (frame.type === 'started') {
        if (typeof frame.processId !== 'number') throw new Error('Boat did not return a process ID.');
        processId = frame.processId;
        if (options?.timeout) {
          const deadline = Date.now() + options.timeout;
          const expire = () => {
            const remaining = deadline - Date.now();
            if (remaining <= 0) { timedOut = true; controller.abort(); }
            else timer = setTimeout(expire, Math.min(remaining, 2_147_483_647));
          };
          expire();
        }
      }
      if (frame.type === 'stdout') { stdout += frame.data ?? ''; options?.onStdout?.(frame.data ?? ''); }
      if (frame.type === 'stderr') { stderr += frame.data ?? ''; options?.onStderr?.(frame.data ?? ''); }
      if (frame.type === 'error') throw new Error(frame.message || frame.error || 'Boat command stream failed.');
      if (frame.type === 'exit' && !timedOut) return result(frame.timedOut ? 124 : frame.exitCode ?? 1);
    }
    throw new Error('Boat command stream ended without an exit frame.');
  } catch (error) {
    // A deadline passing during cleanup must not turn this failure into a timeout result.
    clearTimeout(timer);
    // Detached commands survive a lost stream; do not orphan a failed or timed-out foreground job.
    if (processId !== undefined) {
      try { await sandbox.api.stopCommand({ sandboxId: sandbox.id, processId }); }
      catch (cleanupError) {
        if ((cleanupError as { response?: { status?: number } })?.response?.status !== 404) {
          const reason = timedOut ? 'timeout' : `stream failure (${error instanceof Error ? error.message : String(error)})`;
          throw new Error(`Failed to stop Boat process ${processId} after ${reason}: ${String(cleanupError)}`);
        }
      }
    }
    if (timedOut) return result(124);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function checked(sandbox: BoatSandbox, command: string): Promise<string> {
  const result = await run(sandbox, command);
  if (result.exitCode !== 0) throw new Error(`Boat filesystem operation failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`);
  return result.stdout;
}
