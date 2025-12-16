/**
 * Terminal class for managing terminal sessions with WebSocket integration
 */

import type { WebSocketManager } from './websocket';
import type {
  TerminalOutputMessage,
  TerminalErrorMessage,
  TerminalDestroyedMessage,
} from './websocket';
import type { CommandExecutionResponse, CommandsListResponse, CommandDetailsResponse } from './index';
import { TerminalCommand } from './resources/terminal-command';

// ============================================================================
// Base64 Utility Functions
// ============================================================================

/**
 * Decode base64 to string (cross-platform: browser and Node.js)
 */
function decodeBase64(str: string): string {
  if (typeof window !== 'undefined' && typeof window.atob === 'function') {
    // Browser environment
    return window.atob(str);
  } else if (typeof Buffer !== 'undefined') {
    // Node.js environment
    return Buffer.from(str, 'base64').toString('utf-8');
  }
  throw new Error('No base64 decoding available');
}

/**
 * Terminal event handlers
 */
export type TerminalEventHandler = {
  output: (data: string) => void;
  error: (error: string) => void;
  destroyed: () => void;
};

/**
 * TerminalInstance - A connected terminal session with WebSocket support
 *
 * This is the object returned by sandbox.terminal.create()
 *
 * @example
 * ```typescript
 * // PTY mode - Interactive shell
 * const pty = await sandbox.terminal.create({ pty: true });
 * pty.on('output', (data) => console.log(data));
 * pty.write('ls -la\n');
 * await pty.destroy();
 *
 * // Exec mode - Command tracking
 * const exec = await sandbox.terminal.create({ pty: false });
 * const cmd = await exec.command.run('npm test');
 * console.log(cmd.exitCode);
 *
 * // Background execution with wait
 * const cmd = await exec.command.run('npm install', { background: true });
 * await cmd.wait();
 * console.log(cmd.stdout);
 * ```
 */
export class TerminalInstance {
  private _id: string;
  private _pty: boolean;
  private _status: 'running' | 'stopped' | 'active' | 'ready';
  private _channel: string | null;
  private _ws: WebSocketManager | null;
  private _encoding: 'raw' | 'base64';
  private _eventHandlers: Map<keyof TerminalEventHandler, Set<Function>> = new Map();

  /**
   * Command namespace for exec mode terminals
   */
  readonly command: TerminalCommand;

  // Handlers set by the Sandbox
  private _executeHandler?: (command: string, background?: boolean) => Promise<CommandExecutionResponse>;
  private _listCommandsHandler?: () => Promise<CommandsListResponse>;
  private _retrieveCommandHandler?: (cmdId: string) => Promise<CommandDetailsResponse>;
  private _waitCommandHandler?: (cmdId: string, timeout?: number) => Promise<CommandDetailsResponse>;
  private _destroyHandler?: () => Promise<void>;

  constructor(
    id: string,
    pty: boolean,
    status: 'running' | 'stopped' | 'active' | 'ready',
    channel: string | null,
    ws: WebSocketManager | null,
    encoding: 'raw' | 'base64' = 'raw'
  ) {
    this._id = id;
    this._pty = pty;
    // Normalize 'active' to 'running' for consistency
    this._status = status === 'active' ? 'running' : status;
    this._channel = channel;
    this._ws = ws;
    this._encoding = encoding;

    // Initialize command namespace with handlers
    this.command = new TerminalCommand(id, {
      run: async (command: string, background?: boolean) => {
        if (!this._executeHandler) {
          throw new Error('Execute handler not set');
        }
        return this._executeHandler(command, background);
      },
      list: async () => {
        if (!this._listCommandsHandler) {
          throw new Error('List commands handler not set');
        }
        return this._listCommandsHandler();
      },
      retrieve: async (cmdId: string) => {
        if (!this._retrieveCommandHandler) {
          throw new Error('Retrieve command handler not set');
        }
        return this._retrieveCommandHandler(cmdId);
      },
      wait: async (cmdId: string, timeout?: number) => {
        if (!this._waitCommandHandler) {
          throw new Error('Wait command handler not set');
        }
        return this._waitCommandHandler(cmdId, timeout);
      },
    });

    // Only subscribe to WebSocket channel for PTY mode
    if (this._pty && this._ws && this._channel) {
      this._ws.subscribe(this._channel);
      // Set up WebSocket event handlers
      this.setupWebSocketHandlers();
    }
  }

  /**
   * Set up WebSocket event handlers (PTY mode only)
   */
  private setupWebSocketHandlers(): void {
    if (!this._ws || !this._channel) {
      return; // No WebSocket in exec mode
    }

    // Handle terminal output (decode based on encoding field)
    this._ws.on('terminal:output', (msg: TerminalOutputMessage) => {
      if (msg.channel === this._channel) {
        const encoding = msg.data.encoding || this._encoding;
        const output = encoding === 'base64'
          ? decodeBase64(msg.data.output)
          : msg.data.output;
        this.emit('output', output);
      }
    });

    // Handle terminal errors
    this._ws.on('terminal:error', (msg: TerminalErrorMessage) => {
      if (msg.channel === this._channel) {
        this.emit('error', msg.data.error);
      }
    });

    // Handle terminal destroyed
    this._ws.on('terminal:destroyed', (msg: TerminalDestroyedMessage) => {
      if (msg.channel === this._channel) {
        this._status = 'stopped';
        this.emit('destroyed');
        this.cleanup();
      }
    });
  }

  /**
   * Terminal ID
   */
  get id(): string {
    return this._id;
  }

  /**
   * Get terminal ID (deprecated, use .id property)
   * @deprecated Use .id property instead
   */
  getId(): string {
    return this._id;
  }

  /**
   * Terminal status
   */
  get status(): 'running' | 'stopped' | 'active' | 'ready' {
    return this._status;
  }

  /**
   * Get terminal status (deprecated, use .status property)
   * @deprecated Use .status property instead
   */
  getStatus(): 'running' | 'stopped' | 'active' | 'ready' {
    return this._status;
  }

  /**
   * Terminal channel (null for exec mode)
   */
  get channel(): string | null {
    return this._channel;
  }

  /**
   * Get terminal channel (deprecated, use .channel property)
   * @deprecated Use .channel property instead
   */
  getChannel(): string | null {
    return this._channel;
  }

  /**
   * Whether this is a PTY terminal
   */
  get pty(): boolean {
    return this._pty;
  }

  /**
   * Get terminal PTY mode (deprecated, use .pty property)
   * @deprecated Use .pty property instead
   */
  isPTY(): boolean {
    return this._pty;
  }

  /**
   * Check if terminal is running
   */
  isRunning(): boolean {
    return this._status === 'running';
  }

  /**
   * Write input to the terminal (PTY mode only)
   */
  write(input: string): void {
    if (!this._pty) {
      throw new Error('write() is only available for PTY terminals. Use commands.run() for exec mode terminals.');
    }
    if (!this._ws) {
      throw new Error('WebSocket not available');
    }
    if (!this.isRunning()) {
      console.warn('[Terminal] Warning: Terminal status is not "running", but attempting to write anyway. Status:', this._status);
    }
    this._ws.sendTerminalInput(this._id, input);
  }

  /**
   * Resize terminal window (PTY mode only)
   */
  resize(cols: number, rows: number): void {
    if (!this._pty) {
      throw new Error('resize() is only available for PTY terminals');
    }
    if (!this._ws) {
      throw new Error('WebSocket not available');
    }
    if (!this.isRunning()) {
      throw new Error('Terminal is not running');
    }
    this._ws.resizeTerminal(this._id, cols, rows);
  }

  /**
   * Set execute command handler (called by Sandbox)
   * @internal
   */
  setExecuteHandler(handler: (command: string, background?: boolean) => Promise<CommandExecutionResponse>): void {
    this._executeHandler = handler;
  }

  /**
   * Set list commands handler (called by Sandbox)
   * @internal
   */
  setListCommandsHandler(handler: () => Promise<CommandsListResponse>): void {
    this._listCommandsHandler = handler;
  }

  /**
   * Set retrieve command handler (called by Sandbox)
   * @internal
   */
  setRetrieveCommandHandler(handler: (cmdId: string) => Promise<CommandDetailsResponse>): void {
    this._retrieveCommandHandler = handler;
  }

  /**
   * Set wait command handler (called by Sandbox)
   * @internal
   */
  setWaitCommandHandler(handler: (cmdId: string, timeout?: number) => Promise<CommandDetailsResponse>): void {
    this._waitCommandHandler = handler;
  }

  /**
   * Set destroy handler (called by Sandbox)
   * @internal
   */
  setDestroyHandler(handler: () => Promise<void>): void {
    this._destroyHandler = handler;
  }

  /**
   * Execute a command in the terminal (deprecated, use command.run())
   * @deprecated Use terminal.command.run() instead
   */
  async execute(command: string, options?: { background?: boolean }): Promise<CommandExecutionResponse> {
    if (!this._executeHandler) {
      throw new Error('Execute handler not set');
    }
    return this._executeHandler(command, options?.background);
  }

  /**
   * Destroy the terminal
   */
  async destroy(): Promise<void> {
    if (!this._destroyHandler) {
      throw new Error('Destroy handler not set');
    }
    await this._destroyHandler();
    this.cleanup();
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    // Unsubscribe from channel (PTY mode only)
    if (this._ws && this._channel) {
      this._ws.unsubscribe(this._channel);
    }

    // Clear event handlers
    this._eventHandlers.clear();
  }

  /**
   * Register event handler
   */
  on<K extends keyof TerminalEventHandler>(
    event: K,
    handler: TerminalEventHandler[K]
  ): void {
    if (!this._eventHandlers.has(event)) {
      this._eventHandlers.set(event, new Set());
    }
    this._eventHandlers.get(event)!.add(handler);
  }

  /**
   * Unregister event handler
   */
  off<K extends keyof TerminalEventHandler>(
    event: K,
    handler: TerminalEventHandler[K]
  ): void {
    const handlers = this._eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this._eventHandlers.delete(event);
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
    const handlers = this._eventHandlers.get(event);
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
