/**
 * Terminal class for managing terminal sessions with WebSocket integration
 */

import type { WebSocketManager } from './websocket';
import type {
  TerminalOutputMessage,
  TerminalErrorMessage,
  TerminalDestroyedMessage,
} from './websocket';

/**
 * Terminal event handlers
 */
export type TerminalEventHandler = {
  output: (data: string) => void;
  error: (error: string) => void;
  destroyed: () => void;
};

/**
 * Terminal class for interacting with a terminal session
 *
 * @example
 * ```typescript
 * const client = new ComputeClient({ apiUrl: '...' });
 * await client.generateToken();
 *
 * const terminal = await client.createTerminal();
 * terminal.on('output', (data) => console.log(data));
 * terminal.write('ls -la\n');
 * await terminal.execute('echo "Hello"');
 * await terminal.destroy();
 * ```
 */
export class Terminal {
  private id: string;
  private status: 'running' | 'stopped';
  private channel: string;
  private ws: WebSocketManager;
  private eventHandlers: Map<keyof TerminalEventHandler, Set<Function>> = new Map();

  constructor(
    id: string,
    status: 'running' | 'stopped',
    channel: string,
    ws: WebSocketManager
  ) {
    this.id = id;
    this.status = status;
    this.channel = channel;
    this.ws = ws;

    // Subscribe to terminal channel
    this.ws.subscribe(this.channel);

    // Set up WebSocket event handlers
    this.setupWebSocketHandlers();
  }

  /**
   * Set up WebSocket event handlers
   */
  private setupWebSocketHandlers(): void {
    // Handle terminal output
    this.ws.on('terminal:output', (msg: TerminalOutputMessage) => {
      if (msg.channel === this.channel) {
        this.emit('output', msg.data.output);
      }
    });

    // Handle terminal errors
    this.ws.on('terminal:error', (msg: TerminalErrorMessage) => {
      if (msg.channel === this.channel) {
        this.emit('error', msg.data.error);
      }
    });

    // Handle terminal destroyed
    this.ws.on('terminal:destroyed', (msg: TerminalDestroyedMessage) => {
      if (msg.channel === this.channel) {
        this.status = 'stopped';
        this.emit('destroyed');
        this.cleanup();
      }
    });
  }

  /**
   * Get terminal ID
   */
  getId(): string {
    return this.id;
  }

  /**
   * Get terminal status
   */
  getStatus(): 'running' | 'stopped' {
    return this.status;
  }

  /**
   * Get terminal channel
   */
  getChannel(): string {
    return this.channel;
  }

  /**
   * Check if terminal is running
   */
  isRunning(): boolean {
    return this.status === 'running';
  }

  /**
   * Write input to the terminal
   */
  write(input: string): void {
    if (!this.isRunning()) {
      throw new Error('Terminal is not running');
    }
    this.ws.sendTerminalInput(this.id, input);
  }

  /**
   * Resize terminal window
   */
  resize(cols: number, rows: number): void {
    if (!this.isRunning()) {
      throw new Error('Terminal is not running');
    }
    this.ws.resizeTerminal(this.id, cols, rows);
  }

  /**
   * Execute a command in the terminal (uses REST API, not WebSocket)
   * This is provided by the client via a callback
   */
  private executeCommand?: (command: string) => Promise<any>;

  /**
   * Set execute command handler (called by client)
   */
  setExecuteHandler(handler: (command: string) => Promise<any>): void {
    this.executeCommand = handler;
  }

  /**
   * Execute a command and wait for result
   */
  async execute(command: string): Promise<any> {
    if (!this.executeCommand) {
      throw new Error('Execute handler not set');
    }
    return this.executeCommand(command);
  }

  /**
   * Destroy the terminal (uses REST API, not WebSocket)
   */
  private destroyTerminal?: () => Promise<void>;

  /**
   * Set destroy handler (called by client)
   */
  setDestroyHandler(handler: () => Promise<void>): void {
    this.destroyTerminal = handler;
  }

  /**
   * Destroy the terminal
   */
  async destroy(): Promise<void> {
    if (!this.destroyTerminal) {
      throw new Error('Destroy handler not set');
    }
    await this.destroyTerminal();
    this.cleanup();
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    // Unsubscribe from channel
    this.ws.unsubscribe(this.channel);

    // Clear event handlers
    this.eventHandlers.clear();
  }

  /**
   * Register event handler
   */
  on<K extends keyof TerminalEventHandler>(
    event: K,
    handler: TerminalEventHandler[K]
  ): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /**
   * Unregister event handler
   */
  off<K extends keyof TerminalEventHandler>(
    event: K,
    handler: TerminalEventHandler[K]
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
  private emit<K extends keyof TerminalEventHandler>(
    event: K,
    ...args: Parameters<TerminalEventHandler[K]>
  ): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          (handler as any)(...args);
        } catch (error) {
          console.error('Error in terminal event handler:', error);
        }
      });
    }
  }
}
