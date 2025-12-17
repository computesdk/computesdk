import { EventEmitter } from 'events';
import * as net from 'net';
import type {
  ConnectionState,
  EventListener,
  PubSubClientConfig,
  SandboxEvent,
} from './types';
import { EventsPubSubError } from './errors';
import {
  DEFAULT_PUBSUB_HOST,
  DEFAULT_PUBSUB_PORT,
  DEFAULT_RECONNECT_DELAY,
} from './constants';

/** Maximum buffer size (1MB) to prevent unbounded memory growth */
const MAX_BUFFER_SIZE = 1024 * 1024;

/**
 * TCP Pub/Sub client for real-time event streaming (Node.js only)
 *
 * Uses Redis protocol format for communication with the gateway pub/sub server.
 */
export class EventsPubSubClient extends EventEmitter {
  private host: string;
  private port: number;
  private accessToken: string;
  private sandboxId: string;
  private autoReconnect: boolean;
  private reconnectDelay: number;

  private socket: net.Socket | null = null;
  private state: ConnectionState = 'disconnected';
  private buffer = '';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionPromise: Promise<void> | null = null;

  constructor(config: PubSubClientConfig) {
    super();
    this.host =
      config.host || process.env.COMPUTESDK_PUBSUB_HOST || DEFAULT_PUBSUB_HOST;

    // Validate and parse port
    const envPort = process.env.COMPUTESDK_PUBSUB_PORT
      ? parseInt(process.env.COMPUTESDK_PUBSUB_PORT, 10)
      : null;
    const configPort = config.port;

    let resolvedPort: number;
    if (typeof configPort === 'number' && configPort > 0 && configPort <= 65535) {
      resolvedPort = configPort;
    } else if (typeof envPort === 'number' && envPort > 0 && envPort <= 65535) {
      resolvedPort = envPort;
    } else {
      resolvedPort = DEFAULT_PUBSUB_PORT;
    }
    this.port = resolvedPort;

    this.accessToken = config.accessToken;
    this.sandboxId = config.sandboxId;
    this.autoReconnect = config.autoReconnect ?? true;
    this.reconnectDelay = config.reconnectDelay || DEFAULT_RECONNECT_DELAY;
  }

  /**
   * Connect to the pub/sub server and subscribe to events
   */
  async connect(): Promise<void> {
    // Already connected
    if (this.state === 'connected') {
      return;
    }

    // Connection in progress - wait for it
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.state = 'connecting';

    this.connectionPromise = new Promise<void>((resolve, reject) => {
      this.socket = net.createConnection(
        { host: this.host, port: this.port },
        () => {
          this.sendCommand(`SUBSCRIBE ${this.sandboxId} ${this.accessToken}`);
        }
      );

      this.socket.setEncoding('utf8');

      this.socket.on('data', (data: string) => {
        this.handleData(data, resolve, reject);
      });

      this.socket.on('error', (error) => {
        this.state = 'error';
        this.connectionPromise = null;
        this.emit('error', error);
        reject(new EventsPubSubError(`Connection error: ${error.message}`));
      });

      this.socket.on('close', () => {
        const wasConnected = this.state === 'connected';
        this.state = 'disconnected';
        this.socket = null;
        this.connectionPromise = null;

        if (wasConnected) {
          this.emit('disconnect');
          this.scheduleReconnect();
        }
      });
    });

    try {
      await this.connectionPromise;
    } finally {
      this.connectionPromise = null;
    }
  }

  /**
   * Disconnect from the pub/sub server
   */
  async disconnect(): Promise<void> {
    this.autoReconnect = false;
    this.clearReconnectTimer();

    if (this.socket) {
      this.sendCommand('UNSUBSCRIBE');
      this.socket.destroy();
      this.socket = null;
    }

    this.state = 'disconnected';
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Send a ping to keep the connection alive
   */
  async ping(): Promise<void> {
    if (this.state !== 'connected') {
      throw new EventsPubSubError('Not connected');
    }

    this.sendCommand('PING');
  }

  /**
   * Add event listener with proper typing
   */
  on(event: 'event', listener: EventListener): this;
  on(event: 'connect', listener: () => void): this;
  on(event: 'disconnect', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  private sendCommand(command: string): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(`${command}\r\n`);
    }
  }

  private handleData(
    data: string,
    resolveConnect?: (value: void) => void,
    rejectConnect?: (reason: Error) => void
  ): void {
    this.buffer += data;

    // Prevent unbounded buffer growth (DoS protection)
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      const error = new EventsPubSubError('Buffer overflow - connection terminated');
      this.emit('error', error);
      this.socket?.destroy();
      this.buffer = '';
      rejectConnect?.(error);
      return;
    }

    // Process complete lines
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\r\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 2);
      this.processLine(line, resolveConnect, rejectConnect);
    }
  }

  private processLine(
    line: string,
    resolveConnect?: (value: void) => void,
    rejectConnect?: (reason: Error) => void
  ): void {
    // Handle Redis protocol responses
    if (line.startsWith('+OK')) {
      // Subscription successful
      if (this.state === 'connecting') {
        this.state = 'connected';
        this.emit('connect');
        resolveConnect?.();
      }
      return;
    }

    if (line.startsWith('-ERR')) {
      const errorMessage = line.slice(5);
      const error = new EventsPubSubError(errorMessage);
      this.emit('error', error);
      if (this.state === 'connecting') {
        rejectConnect?.(error);
      }
      return;
    }

    if (line.startsWith('+PONG')) {
      // Ping response, ignore
      return;
    }

    // Handle pub/sub message (Redis array format)
    // *3\r\n$7\r\nmessage\r\n$<channel-len>\r\n<channel>\r\n$<msg-len>\r\n<message>
    if (line.startsWith('*')) {
      // Start of array, we'll parse the message when we have complete data
      return;
    }

    if (line.startsWith('$')) {
      // Bulk string length indicator, skip
      return;
    }

    // Try to parse as JSON event
    if (line.startsWith('{')) {
      try {
        const event = JSON.parse(line) as SandboxEvent;
        this.emit('event', event);
      } catch {
        // Not valid JSON, might be part of protocol
      }
    }
  }

  private scheduleReconnect(): void {
    if (!this.autoReconnect || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch {
        // Reconnect failed, will retry
        this.scheduleReconnect();
      }
    }, this.reconnectDelay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

/**
 * Create a pub/sub client with sensible defaults (Node.js only)
 */
export function createPubSubClient(
  config: PubSubClientConfig
): EventsPubSubClient {
  return new EventsPubSubClient(config);
}
