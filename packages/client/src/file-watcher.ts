/**
 * FileWatcher class for monitoring file system changes with WebSocket integration
 */

import type { WebSocketManager } from './websocket';
import type {
  FileChangedMessage,
  WatcherDestroyedMessage,
} from './websocket';

/**
 * File change event data
 */
export interface FileChangeEvent {
  event: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
  path: string;
  content?: string;
}

/**
 * FileWatcher event handlers
 */
export type FileWatcherEventHandler = {
  change: (event: FileChangeEvent) => void;
  destroyed: () => void;
};

/**
 * FileWatcher class for monitoring file system changes
 *
 * @example
 * ```typescript
 * const client = new ComputeClient({ apiUrl: '...' });
 * await client.generateToken();
 *
 * const watcher = await client.createWatcher('/home/project', {
 *   ignored: ['node_modules', '.git']
 * });
 *
 * watcher.on('change', (event) => {
 *   console.log(`File ${event.event}: ${event.path}`);
 * });
 *
 * await watcher.destroy();
 * ```
 */
export class FileWatcher {
  private id: string;
  private path: string;
  private status: 'active' | 'stopped';
  private channel: string;
  private includeContent: boolean;
  private ignored: string[];
  private ws: WebSocketManager;
  private eventHandlers: Map<keyof FileWatcherEventHandler, Set<Function>> = new Map();
  private onDestroy?: () => void;

  constructor(
    id: string,
    path: string,
    status: 'active' | 'stopped',
    channel: string,
    includeContent: boolean,
    ignored: string[],
    ws: WebSocketManager,
    onDestroy?: () => void
  ) {
    this.id = id;
    this.path = path;
    this.status = status;
    this.channel = channel;
    this.includeContent = includeContent;
    this.ignored = ignored;
    this.ws = ws;
    this.onDestroy = onDestroy;

    // Subscribe to watcher channel
    this.ws.subscribe(this.channel);

    // Set up WebSocket event handlers
    this.setupWebSocketHandlers();
  }

  /**
   * Set up WebSocket event handlers
   */
  private setupWebSocketHandlers(): void {
    // Handle file changes
    this.ws.on('file:changed', (msg: FileChangedMessage) => {
      if (msg.channel === this.channel) {
        this.emit('change', {
          event: msg.data.event,
          path: msg.data.path,
          content: msg.data.content,
        });
      }
    });

    // Handle watcher destroyed
    this.ws.on('watcher:destroyed', (msg: WatcherDestroyedMessage) => {
      if (msg.channel === this.channel) {
        this.status = 'stopped';
        this.emit('destroyed');
        this.cleanup();
      }
    });
  }

  /**
   * Get watcher ID
   */
  getId(): string {
    return this.id;
  }

  /**
   * Get watched path
   */
  getPath(): string {
    return this.path;
  }

  /**
   * Get watcher status
   */
  getStatus(): 'active' | 'stopped' {
    return this.status;
  }

  /**
   * Get watcher channel
   */
  getChannel(): string {
    return this.channel;
  }

  /**
   * Check if content is included in events
   */
  isIncludingContent(): boolean {
    return this.includeContent;
  }

  /**
   * Get ignored patterns
   */
  getIgnoredPatterns(): string[] {
    return [...this.ignored];
  }

  /**
   * Check if watcher is active
   */
  isActive(): boolean {
    return this.status === 'active';
  }

  /**
   * Destroy the watcher (uses REST API, not WebSocket)
   */
  private destroyWatcher?: () => Promise<void>;

  /**
   * Set destroy handler (called by client)
   */
  setDestroyHandler(handler: () => Promise<void>): void {
    this.destroyWatcher = handler;
  }

  /**
   * Destroy the watcher
   */
  async destroy(): Promise<void> {
    if (!this.destroyWatcher) {
      throw new Error('Destroy handler not set');
    }
    await this.destroyWatcher();
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

    // Call onDestroy callback
    if (this.onDestroy) {
      this.onDestroy();
    }
  }

  /**
   * Register event handler
   */
  on<K extends keyof FileWatcherEventHandler>(
    event: K,
    handler: FileWatcherEventHandler[K]
  ): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /**
   * Unregister event handler
   */
  off<K extends keyof FileWatcherEventHandler>(
    event: K,
    handler: FileWatcherEventHandler[K]
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
  private emit<K extends keyof FileWatcherEventHandler>(
    event: K,
    ...args: Parameters<FileWatcherEventHandler[K]>
  ): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          (handler as any)(...args);
        } catch (error) {
          console.error('Error in file watcher event handler:', error);
        }
      });
    }
  }
}
