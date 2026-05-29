import { describe, it, expect, vi } from 'vitest';
import { withExecRetry } from '../utils';

const OK = { commandResult: { exitCode: 0, status: 'Success' }, stdOut: '', stdErr: '' };
const opts = (over: Partial<Parameters<typeof withExecRetry>[1]> = {}) => ({
  serviceId: 'svc',
  timeoutMs: 5_000,
  pollIntervalMs: 10,
  ...over,
});

describe('withExecRetry', () => {
  it('fast-fails on WS 404 (1 attempt, throws immediately)', async () => {
    const attempt = vi.fn().mockRejectedValue(new Error('Unexpected server response: 404'));
    await expect(withExecRetry(attempt, opts())).rejects.toThrow(/404/);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('fast-fails on WS 401', async () => {
    const attempt = vi.fn().mockRejectedValue(new Error('Unexpected server response: 401'));
    await expect(withExecRetry(attempt, opts())).rejects.toThrow(/401/);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('fast-fails on WS 403', async () => {
    const attempt = vi.fn().mockRejectedValue(new Error('Unexpected server response: 403'));
    await expect(withExecRetry(attempt, opts())).rejects.toThrow(/403/);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('fast-fails on WS 400 (permanent client)', async () => {
    const attempt = vi.fn().mockRejectedValue(new Error('Unexpected server response: 400'));
    await expect(withExecRetry(attempt, opts())).rejects.toThrow(/400/);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('fast-fails on WS 422 (unprocessable)', async () => {
    const attempt = vi.fn().mockRejectedValue(new Error('Unexpected server response: 422'));
    await expect(withExecRetry(attempt, opts())).rejects.toThrow(/422/);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('fast-fails on file-not-found error from the SDK', async () => {
    const attempt = vi
      .fn()
      .mockRejectedValue(new Error("Remote path '/x' does not exists but is required for downloads."));
    await expect(withExecRetry(attempt, opts())).rejects.toThrow(/does not exists/);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('retries transient 500s then succeeds on the 3rd attempt', async () => {
    let n = 0;
    const attempt = vi.fn().mockImplementation(async () => {
      n++;
      if (n < 3) throw new Error('Unexpected server response: 500');
      return OK;
    });
    const result = await withExecRetry(attempt, opts());
    expect(result).toBe(OK);
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('exhausts budget when transient errors persist', async () => {
    const attempt = vi.fn().mockRejectedValue(new Error('Unexpected server response: 500'));
    const start = Date.now();
    await expect(
      withExecRetry(attempt, { serviceId: 's', timeoutMs: 200, pollIntervalMs: 50 }),
    ).rejects.toThrow(/Timeout running exec on service s/);
    expect(Date.now() - start).toBeGreaterThanOrEqual(200);
    expect(attempt.mock.calls.length).toBeGreaterThan(1);
  });

  it('immediate success calls attempt exactly once', async () => {
    const attempt = vi.fn().mockResolvedValue(OK);
    const result = await withExecRetry(attempt, opts());
    expect(result).toBe(OK);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
