/**
 * Signal - Resource namespace for signal service operations
 */

import type { SignalService } from '../signal-service';
import type { SignalServiceResponse, PortSignalResponse, GenericSignalResponse } from '../index';

/**
 * Signal service status info
 */
export interface SignalStatusInfo {
  status: 'active' | 'stopped';
  channel: string;
  wsUrl: string;
}

/**
 * Signal resource namespace
 *
 * @example
 * ```typescript
 * // Start the signal service
 * const signals = await sandbox.signal.start();
 * signals.on('port', (event) => {
 *   console.log(`Port ${event.port} opened: ${event.url}`);
 * });
 *
 * // Get signal service status
 * const status = await sandbox.signal.status();
 *
 * // Emit signals
 * await sandbox.signal.emitPort(3000, 'open', 'http://localhost:3000');
 * await sandbox.signal.emitError('Something went wrong');
 *
 * // Stop the signal service
 * await sandbox.signal.stop();
 * ```
 */
export class Signal {
  private startHandler: () => Promise<SignalService>;
  private statusHandler: () => Promise<SignalServiceResponse>;
  private stopHandler: () => Promise<void>;
  private emitPortHandler: (
    port: number,
    type: 'open' | 'close',
    url: string
  ) => Promise<PortSignalResponse>;
  private emitErrorHandler: (message: string) => Promise<GenericSignalResponse>;
  private emitServerReadyHandler: (
    port: number,
    url: string
  ) => Promise<PortSignalResponse>;

  constructor(handlers: {
    start: () => Promise<SignalService>;
    status: () => Promise<SignalServiceResponse>;
    stop: () => Promise<void>;
    emitPort: (
      port: number,
      type: 'open' | 'close',
      url: string
    ) => Promise<PortSignalResponse>;
    emitError: (message: string) => Promise<GenericSignalResponse>;
    emitServerReady: (port: number, url: string) => Promise<PortSignalResponse>;
  }) {
    this.startHandler = handlers.start;
    this.statusHandler = handlers.status;
    this.stopHandler = handlers.stop;
    this.emitPortHandler = handlers.emitPort;
    this.emitErrorHandler = handlers.emitError;
    this.emitServerReadyHandler = handlers.emitServerReady;
  }

  /**
   * Start the signal service
   * @returns SignalService instance with event handling
   */
  async start(): Promise<SignalService> {
    return this.startHandler();
  }

  /**
   * Get the signal service status
   * @returns Signal service status info
   */
  async status(): Promise<SignalStatusInfo> {
    const response = await this.statusHandler();
    return {
      status: response.data.status,
      channel: response.data.channel,
      wsUrl: response.data.ws_url,
    };
  }

  /**
   * Stop the signal service
   */
  async stop(): Promise<void> {
    return this.stopHandler();
  }

  /**
   * Emit a port signal
   * @param port - Port number
   * @param type - Signal type ('open' or 'close')
   * @param url - URL associated with the port
   */
  async emitPort(
    port: number,
    type: 'open' | 'close',
    url: string
  ): Promise<void> {
    await this.emitPortHandler(port, type, url);
  }

  /**
   * Emit an error signal
   * @param message - Error message
   */
  async emitError(message: string): Promise<void> {
    await this.emitErrorHandler(message);
  }

  /**
   * Emit a server ready signal
   * @param port - Port number
   * @param url - Server URL
   */
  async emitServerReady(port: number, url: string): Promise<void> {
    await this.emitServerReadyHandler(port, url);
  }
}
