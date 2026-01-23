/**
 * Ready - Resource namespace for gateway readiness
 */

import type { ReadyResponse } from '../index';

/**
 * Ready info returned by readiness endpoint
 */
export interface ReadyInfo {
  ready: boolean;
  servers: ReadyResponse['servers'];
  overlays: ReadyResponse['overlays'];
}

/**
 * Ready resource namespace
 *
 * @example
 * ```typescript
 * const status = await sandbox.ready.get();
 * console.log(status.ready);
 * console.log(status.servers);
 * ```
 */
export class Ready {
  private getHandler: () => Promise<ReadyResponse>;

  constructor(handlers: { get: () => Promise<ReadyResponse> }) {
    this.getHandler = handlers.get;
  }

  /**
   * Get readiness status for autostarted servers and overlays
   */
  async get(): Promise<ReadyInfo> {
    const response = await this.getHandler();
    return {
      ready: response.ready,
      servers: response.servers ?? [],
      overlays: response.overlays ?? [],
    };
  }
}
