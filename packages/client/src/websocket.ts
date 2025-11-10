/**
 * WebSocket Manager for ComputeSDK Client
 *
 * Handles real-time bidirectional communication with sandbox API
 */

import {
  encodeBinaryMessage,
  decodeBinaryMessage,
  isBinaryData,
  blobToArrayBuffer,
} from './protocol';

// ============================================================================
// WebSocket Message Types
// ============================================================================

/**
 * Base WebSocket message structure
 */
export interface WebSocketMessage<T = any> {
  type: string;
  channel?: string;
  data?: T;
}

/**
 * Channel subscription message
 */
export interface SubscribeMessage {
  type: 'subscribe';
  channel: string;
}

/**
 * Channel unsubscription message
 */
export interface UnsubscribeMessage {
  type: 'unsubscribe';
  channel: string;
}

// ============================================================================
// Outgoing Message Types (Client → Server)
// ============================================================================

/**
 * Send input to a terminal
 * Note: input is sent as-is (not encoded by client SDK)
 */
export interface TerminalInputMessage {
  type: 'terminal:input';
  data: {
    terminal_id: string;
    input: string;
  };
}

/**
 * Resize terminal window
 */
export interface TerminalResizeMessage {
  type: 'terminal:resize';
  data: {
    terminal_id: string;
    cols: number;
    rows: number;
  };
}

export type OutgoingMessage =
  | SubscribeMessage
  | UnsubscribeMessage
  | TerminalInputMessage
  | TerminalResizeMessage;

// ============================================================================
// Incoming Message Types (Server → Client)
// ============================================================================

/**
 * Terminal created notification
 */
export interface TerminalCreatedMessage {
  type: 'terminal:created';
  channel: string;
  data: {
    id: string;
    status: 'running' | 'stopped';
  };
}

/**
 * Terminal output data
 * Note: output field may be base64 encoded depending on encoding field
 */
export interface TerminalOutputMessage {
  type: 'terminal:output';
  channel: string;
  data: {
    output: string; // raw string or base64 encoded, check encoding field
    encoding?: 'raw' | 'base64'; // indicates how output is encoded
  };
}

/**
 * Terminal destroyed notification
 */
export interface TerminalDestroyedMessage {
  type: 'terminal:destroyed';
  channel: string;
  data: {
    id: string;
  };
}

/**
 * Terminal error notification
 */
export interface TerminalErrorMessage {
  type: 'terminal:error';
  channel: string;
  data: {
    error: string;
  };
}

/**
 * File watcher created notification
 */
export interface WatcherCreatedMessage {
  type: 'watcher:created';
  channel: string;
  data: {
    id: string;
    path: string;
  };
}

/**
 * File change event
 * Note: content field may be base64 encoded depending on encoding field
 */
export interface FileChangedMessage {
  type: 'file:changed';
  channel: string;
  data: {
    event: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
    path: string;
    content?: string; // raw string or base64 encoded, check encoding field
    encoding?: 'raw' | 'base64'; // indicates how content is encoded
  };
}

/**
 * File watcher destroyed notification
 */
export interface WatcherDestroyedMessage {
  type: 'watcher:destroyed';
  channel: string;
  data: {
    id: string;
  };
}

/**
 * System signal event
 */
export interface SignalMessage {
  type: 'signal';
  channel: 'signals';
  data: {
    signal: 'port' | 'error' | 'server-ready';
    port?: number;
    url?: string;
    message?: string;
  };
}

/**
 * Sandbox created notification
 */
export interface SandboxCreatedMessage {
  type: 'sandbox.created';
  data: {
    subdomain: string;
    url: string;
  };
}

/**
 * Sandbox deleted notification
 */
export interface SandboxDeletedMessage {
  type: 'sandbox.deleted';
  data: {
    subdomain: string;
  };
}

export type IncomingMessage =
  | TerminalCreatedMessage
  | TerminalOutputMessage
  | TerminalDestroyedMessage
  | TerminalErrorMessage
  | WatcherCreatedMessage
  | FileChangedMessage
  | WatcherDestroyedMessage
  | SignalMessage
  | SandboxCreatedMessage
  | SandboxDeletedMessage;

// ============================================================================
// WebSocket Manager Configuration
// ============================================================================

export type WebSocketConstructor = new (url: string) => WebSocket;

export interface WebSocketManagerConfig {
  /** WebSocket URL (will be generated from client config if not provided) */
  url: string;
  /** WebSocket implementation */
  WebSocket: WebSocketConstructor;
  /** Enable automatic reconnection on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Reconnection delay in milliseconds (default: 1000) */
  reconnectDelay?: number;
  /** Maximum reconnection attempts (default: 5, 0 = infinite) */
  maxReconnectAttempts?: number;
  /** Enable debug logging (default: false) */
  debug?: boolean;
  /** WebSocket protocol: 'binary' (default, recommended) or 'json' (for debugging) */
  protocol?: 'json' | 'binary';
}

// ============================================================================
// Event Handler Types
// ============================================================================

export type MessageHandler<T = any> = (message: T) => void;
export type ErrorHandler = (error: Event) => void;
export type ConnectionHandler = () => void;

// ============================================================================
// WebSocket Manager
// ============================================================================

/**
 * WebSocket Manager for handling real-time communication
 *
 * @example
 * ```typescript
 * import { ComputeClient } from '@computesdk/client'
 *
 * const client = new ComputeClient({ sandboxUrl: 'https://sandbox-123.preview.computesdk.com' });
 * await client.generateToken();
 *
 * // Create WebSocket manager
 * const ws = client.createWebSocketManager();
 *
 * // Listen for connection
 * ws.on('open', () => {
 *   console.log('Connected!');
 * });
 *
 * // Subscribe to terminal output
 * ws.subscribe('terminal:term_abc123');
 * ws.on('terminal:output', (msg) => {
 *   console.log('Terminal output:', msg.data.output);
 * });
 *
 * // Send terminal input
 * ws.sendTerminalInput('term_abc123', 'ls -la\n');
 *
 * // Subscribe to file changes
 * ws.subscribe('watcher:watcher_xyz789');
 * ws.on('file:changed', (msg) => {
 *   console.log('File changed:', msg.data.path, msg.data.event);
 * });
 *
 * // Subscribe to signals
 * ws.subscribe('signals');
 * ws.on('signal', (msg) => {
 *   console.log('Signal:', msg.data);
 * });
 * ```
 */
export class WebSocketManager {
  private config: Required<WebSocketManagerConfig>;
  private ws: WebSocket | null = null;
  private eventHandlers: Map<string, Set<MessageHandler>> = new Map();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private subscribedChannels: Set<string> = new Set();
  private isManualClose = false;

  constructor(config: WebSocketManagerConfig) {
    this.config = {
      url: config.url,
      WebSocket: config.WebSocket,
      autoReconnect: config.autoReconnect ?? true,
      reconnectDelay: config.reconnectDelay ?? 1000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 5,
      debug: config.debug ?? false,
      protocol: config.protocol ?? 'binary',
    };
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  /**
   * Connect to WebSocket server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.isManualClose = false;
        this.log('Connecting to WebSocket URL:', this.config.url);
        this.ws = new this.config.WebSocket(this.config.url);

        this.ws.onopen = () => {
          this.log('Connected to WebSocket server');
          this.reconnectAttempts = 0;

          // Resubscribe to channels after reconnection
          if (this.subscribedChannels.size > 0) {
            this.log('Resubscribing to channels:', Array.from(this.subscribedChannels));
            this.subscribedChannels.forEach((channel) => {
              this.sendRaw({ type: 'subscribe', channel });
            });
          }

          this.emit('open');
          resolve();
        };

        this.ws.onmessage = async (event) => {
          try {
            let message: IncomingMessage;

            // Check if message is binary
            if (this.config.protocol === 'binary' && isBinaryData(event.data)) {
              // Handle binary message
              let buffer: ArrayBuffer;
              if (event.data instanceof Blob) {
                buffer = await blobToArrayBuffer(event.data);
              } else {
                buffer = event.data;
              }
              message = decodeBinaryMessage(buffer) as IncomingMessage;
              this.log('Received binary message:', message);
            } else {
              // Handle JSON message
              message = JSON.parse(event.data) as IncomingMessage;
              this.log('Received JSON message:', message);
            }

            this.handleMessage(message);
          } catch (error) {
            this.log('Failed to parse message:', error);
          }
        };

        this.ws.onerror = (error) => {
          this.log('WebSocket error:', error);
          this.emit('error', error);
          reject(error);
        };

        this.ws.onclose = () => {
          this.log('WebSocket connection closed');
          this.emit('close');

          // Attempt reconnection if enabled and not manually closed
          if (this.config.autoReconnect && !this.isManualClose) {
            this.attemptReconnect();
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.isManualClose = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Attempt to reconnect to WebSocket server
   */
  private attemptReconnect(): void {
    if (
      this.config.maxReconnectAttempts > 0 &&
      this.reconnectAttempts >= this.config.maxReconnectAttempts
    ) {
      this.log('Max reconnection attempts reached');
      this.emit('reconnect-failed');
      return;
    }

    this.reconnectAttempts++;
    this.log(`Reconnecting... (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((error) => {
        this.log('Reconnection failed:', error);
      });
    }, this.config.reconnectDelay);
  }

  // ============================================================================
  // Channel Subscription
  // ============================================================================

  /**
   * Subscribe to a channel
   * @param channel - Channel name (e.g., 'terminal:term_abc123', 'watcher:watcher_xyz789', 'signals')
   */
  subscribe(channel: string): void {
    this.subscribedChannels.add(channel);
    this.sendRaw({ type: 'subscribe', channel });
    this.log('Subscribed to channel:', channel);
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(channel: string): void {
    this.subscribedChannels.delete(channel);
    this.sendRaw({ type: 'unsubscribe', channel });
    this.log('Unsubscribed from channel:', channel);
  }

  /**
   * Get list of subscribed channels
   */
  getSubscribedChannels(): string[] {
    return Array.from(this.subscribedChannels);
  }

  // ============================================================================
  // Message Sending
  // ============================================================================

  /**
   * Send raw message to server
   */
  private sendRaw(message: OutgoingMessage): void {
    if (!this.isConnected()) {
      throw new Error('WebSocket is not connected');
    }

    if (this.config.protocol === 'binary') {
      // Send as binary message
      const buffer = encodeBinaryMessage(message);
      this.ws!.send(buffer);
      this.log('Sent binary message:', message);
    } else {
      // Send as JSON message
      this.ws!.send(JSON.stringify(message));
      this.log('Sent JSON message:', message);
    }
  }

  /**
   * Send input to a terminal (sent as-is, not encoded)
   */
  sendTerminalInput(terminalId: string, input: string): void {
    this.sendRaw({
      type: 'terminal:input',
      data: { terminal_id: terminalId, input },
    });
  }

  /**
   * Resize terminal window
   */
  resizeTerminal(terminalId: string, cols: number, rows: number): void {
    this.sendRaw({
      type: 'terminal:resize',
      data: { terminal_id: terminalId, cols, rows },
    });
  }

  // ============================================================================
  // Event Handling
  // ============================================================================

  /**
   * Register event handler
   */
  on(event: 'open', handler: ConnectionHandler): void;
  on(event: 'close', handler: ConnectionHandler): void;
  on(event: 'error', handler: ErrorHandler): void;
  on(event: 'reconnect-failed', handler: ConnectionHandler): void;
  on(event: 'terminal:created', handler: MessageHandler<TerminalCreatedMessage>): void;
  on(event: 'terminal:output', handler: MessageHandler<TerminalOutputMessage>): void;
  on(event: 'terminal:destroyed', handler: MessageHandler<TerminalDestroyedMessage>): void;
  on(event: 'terminal:error', handler: MessageHandler<TerminalErrorMessage>): void;
  on(event: 'watcher:created', handler: MessageHandler<WatcherCreatedMessage>): void;
  on(event: 'file:changed', handler: MessageHandler<FileChangedMessage>): void;
  on(event: 'watcher:destroyed', handler: MessageHandler<WatcherDestroyedMessage>): void;
  on(event: 'signal', handler: MessageHandler<SignalMessage>): void;
  on(event: 'sandbox.created', handler: MessageHandler<SandboxCreatedMessage>): void;
  on(event: 'sandbox.deleted', handler: MessageHandler<SandboxDeletedMessage>): void;
  on(event: string, handler: MessageHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /**
   * Unregister event handler
   */
  off(event: string, handler: MessageHandler): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.eventHandlers.delete(event);
      }
    }
  }

  /**
   * Unregister all event handlers for an event
   */
  offAll(event: string): void {
    this.eventHandlers.delete(event);
  }

  /**
   * Emit event to registered handlers
   */
  private emit(event: string, data?: any): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(data);
        } catch (error) {
          this.log('Error in event handler:', error);
        }
      });
    }
  }

  /**
   * Handle incoming message
   */
  private handleMessage(message: IncomingMessage): void {
    // Emit message type event
    this.emit(message.type, message);

    // Also emit on channel if present
    if ('channel' in message && message.channel) {
      this.emit(message.channel, message);
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Log debug message if debug mode is enabled
   */
  private log(...args: any[]): void {
    if (this.config.debug) {
      console.log('[WebSocketManager]', ...args);
    }
  }

  /**
   * Get current connection state
   */
  getState(): 'connecting' | 'open' | 'closing' | 'closed' {
    if (!this.ws) return 'closed';
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return 'connecting';
      case WebSocket.OPEN:
        return 'open';
      case WebSocket.CLOSING:
        return 'closing';
      case WebSocket.CLOSED:
        return 'closed';
      default:
        return 'closed';
    }
  }

  /**
   * Get reconnection attempt count
   */
  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }
}
