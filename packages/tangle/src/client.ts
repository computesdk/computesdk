import { Sandbox, NetworkError, TimeoutError } from '@tangle-network/sandbox';
import { http2Fetch, openConnections } from './http2';

export { openConnections };
export const defaultBaseUrl = process.env.TANGLE_SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools';

export class TangleClient extends Sandbox {
  private readonly authorization = new Headers({ authorization: 'Bearer ' + this.getApiKey() }).get('authorization')!;

  override async fetch(path: string, options: RequestInit = {}, fetchOptions?: { timeoutMs?: number }): Promise<Response> {
    const timeoutMs = fetchOptions?.timeoutMs ?? 30_000;
    try {
      const response = await http2Fetch(new URL(this.getBaseUrl() + path), options, {
        timeoutMs, authorization: this.authorization,
      });
      response.headers.set('x-tangle-request-path', path);
      if (options.method) response.headers.set('x-tangle-request-method', options.method);
      return response;
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      if (error instanceof TimeoutError) throw error;
      throw new NetworkError('Failed to connect to Tangle Sandbox API', error instanceof Error ? error : undefined);
    }
  }
}
