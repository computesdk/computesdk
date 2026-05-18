import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NorthflankApiCallError } from '@northflank/js-client';
import {
  waitForRunningInstance,
  type NorthflankConfig,
  type ReadinessClient,
} from '../utils';

type ExecImpl = () => unknown | Promise<unknown>;

function makeClient(exec: ExecImpl): { client: ReadinessClient; attempts: () => number } {
  const counter = { n: 0 };
  const client = {
    exec: {
      execServiceCommand: async () => {
        counter.n++;
        return await exec();
      },
    },
  } as unknown as ReadinessClient;
  return { client, attempts: () => counter.n };
}

const config: NorthflankConfig = { token: 't', projectId: 'p' };
const OK = { commandResult: { exitCode: 0, status: 'Success' }, stdOut: '', stdErr: '' };

/**
 * Realistic WS exec error shape. These come through as plain `Error`
 * instances (NOT `NorthflankApiCallError`) with the status code embedded
 * in the message string — `.status` is never set.
 */
const wsErr = (status: number) =>
  new Error(`Command execution failed: WebSocket error: Unexpected server response: ${status}`);

describe('waitForRunningInstance (exec-based readiness)', () => {
  it('resolves on the first successful exec call', async () => {
    const { client, attempts } = makeClient(() => OK);
    await expect(waitForRunningInstance(client, config, 'svc', 5_000, 10)).resolves.toBeUndefined();
    expect(attempts()).toBe(1);
  });

  it('retries on transient WS 500 errors (pod not ready) and eventually resolves', async () => {
    let n = 0;
    const { client, attempts } = makeClient(() => {
      n++;
      if (n < 3) throw wsErr(500);
      return OK;
    });
    await expect(waitForRunningInstance(client, config, 'svc', 5_000, 10)).resolves.toBeUndefined();
    expect(attempts()).toBeGreaterThanOrEqual(3);
  });

  it('retries on socket-level errors (ECONNREFUSED, hang up, ECONNRESET) until exec succeeds', async () => {
    let n = 0;
    const { client } = makeClient(() => {
      n++;
      if (n < 2) throw new Error('socket hang up');
      if (n < 3) throw new Error('connect ECONNREFUSED 10.0.0.1:443');
      if (n < 4) throw new Error('read ECONNRESET');
      return OK;
    });
    await expect(waitForRunningInstance(client, config, 'svc', 5_000, 10)).resolves.toBeUndefined();
  });

  it('fast-fails on WS 404 (service was deleted mid-wait)', async () => {
    const { client, attempts } = makeClient(() => {
      throw wsErr(404);
    });
    const start = Date.now();
    await expect(
      waitForRunningInstance(client, config, 'svc-gone', 60_000, 10),
    ).rejects.toThrow(/Unexpected server response: 404/);
    expect(Date.now() - start).toBeLessThan(2_000);
    expect(attempts()).toBe(1);
  });

  it('fast-fails on WS 401 (auth)', async () => {
    const { client, attempts } = makeClient(() => {
      throw wsErr(401);
    });
    await expect(
      waitForRunningInstance(client, config, 'svc', 60_000, 10),
    ).rejects.toThrow(/Unexpected server response: 401/);
    expect(attempts()).toBe(1);
  });

  it('fast-fails on WS 403 (permission)', async () => {
    const { client, attempts } = makeClient(() => {
      throw wsErr(403);
    });
    await expect(
      waitForRunningInstance(client, config, 'svc', 60_000, 10),
    ).rejects.toThrow(/Unexpected server response: 403/);
    expect(attempts()).toBe(1);
  });

  it('fast-fails on WS 400 (malformed request)', async () => {
    const { client, attempts } = makeClient(() => {
      throw wsErr(400);
    });
    await expect(
      waitForRunningInstance(client, config, 'svc', 60_000, 10),
    ).rejects.toThrow(/Unexpected server response: 400/);
    expect(attempts()).toBe(1);
  });

  it('fast-fails on WS 422 (unprocessable entity)', async () => {
    const { client, attempts } = makeClient(() => {
      throw wsErr(422);
    });
    await expect(
      waitForRunningInstance(client, config, 'svc', 60_000, 10),
    ).rejects.toThrow(/Unexpected server response: 422/);
    expect(attempts()).toBe(1);
  });

  it('times out if exec never succeeds (all attempts return WS 500)', async () => {
    const { client, attempts } = makeClient(() => {
      throw wsErr(500);
    });
    const start = Date.now();
    await expect(
      waitForRunningInstance(client, config, 'svc-slow', 150, 10),
    ).rejects.toThrow(/Timeout waiting for service svc-slow to become exec-ready/);
    expect(Date.now() - start).toBeGreaterThanOrEqual(150);
    expect(attempts()).toBeGreaterThan(1);
  });

  it('treats a per-attempt hang as transient and retries (per-call budget)', async () => {
    // First attempt hangs longer than the per-attempt budget; subsequent
    // attempts succeed. Overall call must complete well under the outer
    // timeout AND must perform more than one attempt.
    let n = 0;
    const { client, attempts } = makeClient(async () => {
      n++;
      if (n === 1) {
        await new Promise(r => setTimeout(r, 500));
        return OK;
      }
      return OK;
    });
    const start = Date.now();
    await expect(
      // outer=5s, poll=10ms, per-attempt=50ms → 1st attempt times out, 2nd succeeds
      waitForRunningInstance(client, config, 'svc-hang', 5_000, 10, 50),
    ).resolves.toBeUndefined();
    expect(attempts()).toBeGreaterThanOrEqual(2);
    expect(Date.now() - start).toBeLessThan(2_000);
  });

  it('retries on plain Error with no recognizable status (e.g. random WS upgrade failure)', async () => {
    let n = 0;
    const { client, attempts } = makeClient(() => {
      n++;
      if (n < 3) throw new Error('Command execution failed: WebSocket error: connection closed before response');
      return OK;
    });
    await expect(waitForRunningInstance(client, config, 'svc', 5_000, 10)).resolves.toBeUndefined();
    expect(attempts()).toBeGreaterThanOrEqual(3);
  });

  /**
   * Fallback: REST-style NorthflankApiCallError errors with `.status` set
   * should still classify the same way. The exec proxy is WS, but the
   * underlying SDK may surface REST-shaped errors for some failure modes.
   */
  it('fallback: classifies NorthflankApiCallError with .status (REST-shaped)', async () => {
    const { client, attempts } = makeClient(() => {
      throw new NorthflankApiCallError({ status: 401, message: 'Unauthorized' });
    });
    await expect(
      waitForRunningInstance(client, config, 'svc', 60_000, 10),
    ).rejects.toThrow(/Unauthorized/);
    expect(attempts()).toBe(1);
  });
});

/**
 * Cleanup-on-failed-create: when readiness times out after `create.service.deployment`
 * succeeds, the provider should issue `delete.service` before rethrowing so we
 * don't leak an orphaned service.
 */
describe('northflank() create cleanup on failed readiness', () => {
  const deleteSpy = vi.fn(async () => ({}));
  const createSpy = vi.fn(async () => ({ data: { id: 'svc-orphan' } }));
  const execSpy = vi.fn(async () => {
    // Realistic WS error: plain Error with status in message.
    throw new Error('Command execution failed: WebSocket error: Unexpected server response: 500');
  });

  beforeEach(() => {
    deleteSpy.mockClear();
    createSpy.mockClear();
    execSpy.mockClear();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('calls delete.service when exec-readiness times out, then rethrows', async () => {
    vi.doMock('@northflank/js-client', () => {
      class ApiClientInMemoryContextProvider {
        addContext() {}
        useContext() {}
      }
      class NorthflankApiCallError extends Error {
        status: number;
        constructor(status: number, msg: string) {
          super(msg);
          this.status = status;
        }
      }
      class ApiClient {
        exec = { execServiceCommand: execSpy };
        create = { service: { deployment: createSpy } };
        delete = { service: deleteSpy };
      }
      return { ApiClient, ApiClientInMemoryContextProvider, NorthflankApiCallError };
    });

    const { northflank } = await import('../index');
    const provider = northflank({ token: 't', projectId: 'p', timeout: 80 });

    await expect(provider.sandbox.create()).rejects.toThrow(
      /Timeout waiting for service svc-orphan to become exec-ready/,
    );

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(execSpy.mock.calls.length).toBeGreaterThan(0);
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: expect.objectContaining({ projectId: 'p', serviceId: 'svc-orphan' }),
      }),
    );
  });
});
