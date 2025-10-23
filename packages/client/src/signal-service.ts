/**
 * SignalService class for monitoring system signals with WebSocket integration
 */

import type { WebSocketManager } from './websocket';
import type { SignalMessage } from './websocket';

/**
 * Port signal data
 */
export interface PortSignalEvent {
  signal: 'port' | 'server-ready';
  port: number;
  url: string;
  type?: 'open' | 'close';
}

/**
 * Error signal data
 */
export interface ErrorSignalEvent {
  signal: 'error';
  message: string;
}

/**
 * Generic signal event (union type)
 */
export type SignalEvent = PortSignalEvent | ErrorSignalEvent;

/**
 * SignalService event handlers
 */
export type SignalServiceEventHandler = {
  port: (event: PortSignalEvent) => void;
  error: (event: ErrorSignalEvent) => void;
  signal: (event: SignalEvent) => void;
};

/**
 * SignalService class for monitoring system signals and events
 *
 * @example
 * ```typescript
 * const client = new ComputeClient({ apiUrl: '...' });
 * await client.generateToken();
 *
 * const signals = await client.startSignals();
 *
 * signals.on('port', (event) => {
 *   console.log(`Port ${event.port} ${event.type}: ${event.url}`);
 * });
 *
 * signals.on('error', (event) => {
 *   console.error(`Error: ${event.message}`);
 * });
 *
 * await signals.stop();
 * ```
 */
export class SignalService {
  private status: 'active' | 'stopped';
  private channel: string;
  private ws: WebSocketManager;
  private eventHandlers: Map<keyof SignalServiceEventHandler, Set<Function>> = new Map();
  private onStop?: () => void;

  constructor(
    status: 'active' | 'stopped',
    channel: string,
    ws: WebSocketManager,
    onStop?: () => void
  ) {
    this.status = status;
    this.channel = channel;
    this.ws = ws;
    this.onStop = onStop;

    // Subscribe to signals channel
    this.ws.subscribe(this.channel);

    // Set up WebSocket event handlers
    this.setupWebSocketHandlers();
  }

  /**
   * Set up WebSocket event handlers
   */
  private setupWebSocketHandlers(): void {
    // Handle signal events
    this.ws.on('signal', (msg: SignalMessage) => {
      if (msg.channel === this.channel) {
        const event: SignalEvent = {
          signal: msg.data.signal,
          ...(msg.data.port && { port: msg.data.port }),
          ...(msg.data.url && { url: msg.data.url }),
          ...(msg.data.message && { message: msg.data.message }),
        } as SignalEvent;

        // Emit specific signal type
        if (msg.data.signal === 'port' || msg.data.signal === 'server-ready') {
          this.emit('port', event as PortSignalEvent);
        } else if (msg.data.signal === 'error') {
          this.emit('error', event as ErrorSignalEvent);
        }

        // Emit generic signal event
        this.emit('signal', event);
      }
    });
  }

  /**
   * Get service status
   */
  getStatus(): 'active' | 'stopped' {
    return this.status;
  }

  /**
   * Get service channel
   */
  getChannel(): string {
    return this.channel;
  }

  /**
   * Check if service is active
   */
  isActive(): boolean {
    return this.status === 'active';
  }

  /**
   * Stop the signal service (uses REST API, not WebSocket)
   */
  private stopService?: () => Promise<void>;

  /**
   * Set stop handler (called by client)
   */
  setStopHandler(handler: () => Promise<void>): void {
    this.stopService = handler;
  }

  /**
   * Stop the signal service
   */
  async stop(): Promise<void> {
    if (!this.stopService) {
      throw new Error('Stop handler not set');
    }
    await this.stopService();
    this.cleanup();
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    this.status = 'stopped';

    // Unsubscribe from channel
    this.ws.unsubscribe(this.channel);

    // Clear event handlers
    this.eventHandlers.clear();

    // Call onStop callback
    if (this.onStop) {
      this.onStop();
    }
  }

  /**
   * Register event handler
   */
  on<K extends keyof SignalServiceEventHandler>(
    event: K,
    handler: SignalServiceEventHandler[K]
  ): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /**
   * Unregister event handler
   */
  off<K extends keyof SignalServiceEventHandler>(
    event: K,
    handler: SignalServiceEventHandler[K]
  ): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.eventHandlers.delete(event);
      }
    }
  }

  /**
   * Emit event to registered handlers
   */
  private emit<K extends keyof SignalServiceEventHandler>(
    event: K,
    ...args: Parameters<SignalServiceEventHandler[K]>
  ): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          (handler as any)(...args);
        } catch (error) {
          console.error('Error in signal service event handler:', error);
        }
      });
    }
  }
}
