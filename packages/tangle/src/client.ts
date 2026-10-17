import { Sandbox, NetworkError, TimeoutError } from '@tangle-network/sandbox';
import { http2Fetch, openConnections } from './http2';

export { openConnections };
export const defaultBaseUrl = process.env.TANGLE_SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools';

export class TangleClient extends Sandbox {
  override async fetch(path: string, options: RequestInit = {}, fetchOptions?: { timeoutMs?: number }): Promise<Response> {
    const timeoutMs = fetchOptions?.timeoutMs ?? 30_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref();
    const deadline = controller.signal;
    const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    try {
      return await http2Fetch(new URL(this.getBaseUrl() + path), { ...options, signal }, {
        apiKey: this.getApiKey(), path,
      });
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      if (deadline.aborted) throw new TimeoutError(timeoutMs);
      throw new NetworkError('Failed to connect to Tangle Sandbox API', error instanceof Error ? error : undefined);
    } finally {
      clearTimeout(timer);
    }
  }
}
