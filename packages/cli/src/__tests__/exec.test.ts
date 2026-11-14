import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execCommand, execute, execTimeout } from '../exec.js';
import type { ActionsClient } from '../actions-client.js';

const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const base = `/api/v1/sandboxes/${id}`;
const job = { jobId: 'job-1', status: 'running', command: 'echo hello' };
const status = (stdout: string, stderr = '', done = false, exitCode: number | null = null) =>
  ({ stdout, stderr, status: done ? 'exited' : 'running', exitCode });
const originalExitCode = process.exitCode;
afterEach(() => { process.exitCode = originalExitCode; vi.restoreAllMocks(); vi.useRealTimers(); });

function client(post = vi.fn()) { return { post } as unknown as ActionsClient; }

describe('exec command interpretation', () => {
  it('runs a single argument as a shell program', () => {
    const command = 'printf hello && printf world';
    expect(execCommand([command])).toBe(command);
    expect(execFileSync('sh', ['-c', execCommand([command])], { encoding: 'utf8' })).toBe('helloworld');
  });
  it('preserves separate arguments, including shell metacharacters and quotes', () => {
    const arg = "it's $HOME; echo unexpected";
    const program = execCommand(['printf', '%s', arg]);
    expect(execFileSync('sh', ['-c', program], { encoding: 'utf8' })).toBe(arg);
  });
  it.each([{ timeout: '-1' }, { timeout: 'NaN' }, { timeout: '' }, { timeoutMs: '0.1' }, { timeout: '3000000' }, { timeout: '1', timeoutMs: '1' }])('rejects invalid timeout %j', (opts) => {
    expect(() => execTimeout(opts)).toThrow();
  });
  it('supports seconds, fractional seconds, legacy milliseconds and no limit', () => {
    expect(execTimeout({ timeout: '1.5' })).toBe(1500);
    expect(execTimeout({ timeoutMs: '1234' })).toBe(1234);
    expect(execTimeout({ timeout: '0' })).toBe(0);
    expect(execTimeout({})).toBeUndefined();
  });
});

describe('exec modes', () => {
  it('buffers by default and propagates the remote exit code', async () => {
    const post = vi.fn().mockResolvedValue({ commandId: 'c1', stdout: 'hello', stderr: 'warning', exitCode: 7 });
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await execute(client(post), id, { command: 'echo hello' }, { timeout: '2' });
    expect(post).toHaveBeenCalledWith(`${base}/commands`, { command: 'echo hello', timeoutMs: 2000 });
    expect(out).toHaveBeenCalledWith('hello'); expect(err).toHaveBeenCalledWith('warning');
    expect(process.exitCode).toBe(7);
  });
  it('detaches once and returns process metadata in JSON', async () => {
    const post = vi.fn().mockResolvedValue({ process: job });
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await execute(client(post), id, { command: 'npm run dev', cwd: '/app', env: { PORT: '3000' } }, { detach: true, json: true });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(`${base}/processes`, { command: 'npm run dev', cwd: '/app', env: { PORT: '3000' } });
    expect(JSON.parse(String(out.mock.calls[0][0]))).toEqual(job);
  });
  it.each([{ detach: true, stream: true }, { detach: true, timeout: '3' }])('rejects incompatible flags before starting anything', async (opts) => {
    const post = vi.fn();
    await expect(execute(client(post), id, { command: 'echo hello' }, opts)).rejects.toThrow('--detach');
    expect(post).not.toHaveBeenCalled();
  });
  it.each([{ stream: true }, { timeout: '0' }, { timeout: '600' }])('streams output incrementally for %j, without duplication', async (opts) => {
    const post = vi.fn().mockResolvedValueOnce({ process: job })
      .mockResolvedValueOnce({ process: status('hel') })
      .mockResolvedValueOnce({ process: status('hello', 'warning') })
      .mockResolvedValueOnce({ process: status('hello', 'warning', true, 9) });
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await execute(client(post), id, { command: 'echo hello' }, opts);
    expect(out.mock.calls.map(([chunk]) => chunk).join('')).toBe('hello');
    expect(err.mock.calls.map(([chunk]) => chunk).join('')).toBe('warning');
    expect(post.mock.calls.filter(([path]) => path === `${base}/processes`)).toHaveLength(1);
    expect(process.exitCode).toBe(9);
  });
  it('emits JSON Lines for streamed stdout, stderr and exit', async () => {
    const post = vi.fn().mockResolvedValueOnce({ process: job })
      .mockResolvedValueOnce({ process: status('hello', 'warning', true, 0) });
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await execute(client(post), id, { command: 'echo hello' }, { stream: true, json: true });
    expect(out.mock.calls.map(([chunk]) => JSON.parse(String(chunk)))).toEqual([
      { event: 'stdout', chunk: 'hello' }, { event: 'stderr', chunk: 'warning' }, { event: 'exit', exitCode: 0 },
    ]);
  });
  it('kills the process on timeout, aborts a stuck wait and exits 124', async () => {
    vi.useFakeTimers();
    const post = vi.fn().mockImplementation((path, _body, options) => {
      if (path === `${base}/processes`) return Promise.resolve({ process: job });
      if (path.endsWith('/kill')) return Promise.resolve({ process: status('', '', true, 143) });
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    });
    const run = execute(client(post), id, { command: 'sleep 60' }, { stream: true, timeout: '1', json: true });
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(1000); await run;
    expect(post).toHaveBeenCalledWith(`${base}/processes/job-1/kill`, { signal: 'SIGKILL' }, expect.anything());
    expect(process.exitCode).toBe(124);
    expect(out).toHaveBeenCalledWith('{"event":"exit","exitCode":124}\n');
  });
  it('signals the tracked job on Ctrl-C and removes its handlers', async () => {
    const before = process.listenerCount('SIGINT');
    let waiting!: () => void;
    const ready = new Promise<void>((resolve) => { waiting = resolve; });
    const post = vi.fn().mockImplementation((path, _body, options) => {
      if (path === `${base}/processes`) return Promise.resolve({ process: job });
      if (path.endsWith('/kill')) return Promise.resolve({});
      waiting();
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    });
    const run = execute(client(post), id, { command: 'sleep 60' }, { stream: true });
    await ready; process.emit('SIGINT'); await run;
    expect(post).toHaveBeenCalledWith(`${base}/processes/job-1/kill`, { signal: 'SIGINT' }, expect.anything());
    expect(process.exitCode).toBe(130); expect(process.listenerCount('SIGINT')).toBe(before);
  });
  it('keeps JSON error output clean and includes the job recovery command in the error', async () => {
    const post = vi.fn().mockResolvedValueOnce({ process: job }).mockRejectedValueOnce(new Error('network failed'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(execute(client(post), id, { command: 'echo hello' }, { stream: true, json: true })).rejects.toThrow('compute logs');
    expect(err).not.toHaveBeenCalled();
  });
  it('reports a failed wait without starting another process', async () => {
    const post = vi.fn().mockResolvedValueOnce({ process: job }).mockRejectedValueOnce(new Error('network failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(execute(client(post), id, { command: 'echo hello' }, { stream: true })).rejects.toThrow('network failed');
    expect(post).toHaveBeenCalledTimes(2);
    expect(console.error).not.toHaveBeenCalled();
  });
});
