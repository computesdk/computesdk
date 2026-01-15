/**
 * Overlay - Resource namespace for filesystem overlay operations
 *
 * Overlays enable instant sandbox setup from template directories by copying
 * files directly for isolation, with heavy directories copied in the background.
 */

/**
 * Options for waiting for overlay copy completion
 */
export interface WaitForCompletionOptions {
  /** Maximum number of retry attempts (default: 60) */
  maxRetries?: number;
  /** Initial delay between retries in milliseconds (default: 500) */
  initialDelayMs?: number;
  /** Maximum delay between retries in milliseconds (default: 5000) */
  maxDelayMs?: number;
  /** Backoff multiplier for exponential backoff (default: 1.5) */
  backoffFactor?: number;
}

/**
 * Options for creating an overlay
 */
export interface CreateOverlayOptions {
  /** Absolute path to source directory (template) */
  source: string;
  /** Relative path in sandbox where overlay will be mounted */
  target: string;
  /** Glob patterns to ignore (e.g., ["node_modules", "*.log"]) */
  ignore?: string[];
  /** If true, wait for background copy to complete before returning (default: false) */
  waitForCompletion?: boolean | WaitForCompletionOptions;
}

/**
 * Copy status for overlay background operations
 */
export type OverlayCopyStatus = 'pending' | 'in_progress' | 'complete' | 'failed';

/**
 * Statistics about an overlay
 */
export interface OverlayStats {
  /** Number of copied files */
  copiedFiles: number;
  /** Number of copied directories (heavy dirs copied in background) */
  copiedDirs: number;
  /** Paths that were skipped (e.g., .git, ignored patterns) */
  skipped: string[];
}

/**
 * Overlay information (client-side normalized type)
 */
export interface OverlayInfo {
  /** Unique overlay identifier */
  id: string;
  /** Absolute path to source directory */
  source: string;
  /** Relative path in sandbox */
  target: string;
  /** When the overlay was created */
  createdAt: string;
  /** Statistics about the overlay */
  stats: OverlayStats;
  /** Copy status for background operations */
  copyStatus: OverlayCopyStatus;
  /** Error message if copy failed */
  copyError?: string;
}

/**
 * API response for overlay operations (snake_case from server)
 */
export interface OverlayResponse {
  id: string;
  source: string;
  target: string;
  created_at: string;
  stats: {
    copied_files: number;
    copied_dirs: number;
    skipped: string[];
  };
  copy_status: string;
  copy_error?: string;
}

/**
 * API response for listing overlays
 */
export interface OverlayListResponse {
  overlays: OverlayResponse[];
}

/**
 * Overlay resource namespace
 *
 * @example
 * ```typescript
 * // Create an overlay from a template directory
 * const overlay = await sandbox.filesystem.overlay.create({
 *   source: '/templates/nextjs',
 *   target: 'project',
 * });
 * console.log(overlay.copyStatus); // 'pending' | 'in_progress' | 'complete' | 'failed'
 *
 * // Create an overlay and wait for background copy to complete
 * const overlay = await sandbox.filesystem.overlay.create({
 *   source: '/templates/nextjs',
 *   target: 'project',
 *   waitForCompletion: true, // blocks until copy is complete
 * });
 *
 * // Wait for an existing overlay's copy to complete
 * const overlay = await sandbox.filesystem.overlay.waitForCompletion('overlay-id');
 *
 * // List all overlays
 * const overlays = await sandbox.filesystem.overlay.list();
 *
 * // Get a specific overlay (useful for polling copy status)
 * const overlay = await sandbox.filesystem.overlay.retrieve('overlay-id');
 * if (overlay.copyStatus === 'complete') {
 *   console.log('Background copy finished!');
 * }
 *
 * // Delete an overlay
 * await sandbox.filesystem.overlay.destroy('overlay-id');
 * ```
 */
export class Overlay {
  private createHandler: (options: CreateOverlayOptions) => Promise<OverlayResponse>;
  private listHandler: () => Promise<OverlayListResponse>;
  private retrieveHandler: (id: string) => Promise<OverlayResponse>;
  private destroyHandler: (id: string) => Promise<void>;

  constructor(handlers: {
    create: (options: CreateOverlayOptions) => Promise<OverlayResponse>;
    list: () => Promise<OverlayListResponse>;
    retrieve: (id: string) => Promise<OverlayResponse>;
    destroy: (id: string) => Promise<void>;
  }) {
    this.createHandler = handlers.create;
    this.listHandler = handlers.list;
    this.retrieveHandler = handlers.retrieve;
    this.destroyHandler = handlers.destroy;
  }

  /**
   * Create a new overlay from a template directory
   *
   * The overlay copies files from the source directory into the target path
   * for better isolation. Heavy directories (node_modules, .venv, etc.) are
   * copied in the background. Use the `ignore` option to exclude files/directories.
   *
   * @param options - Overlay creation options
   * @param options.source - Absolute path to source directory
   * @param options.target - Relative path in sandbox
   * @param options.ignore - Glob patterns to ignore (e.g., ["node_modules", "*.log"])
   * @param options.waitForCompletion - If true or options object, wait for background copy to complete
   * @returns Overlay info with copy status
   */
  async create(options: CreateOverlayOptions): Promise<OverlayInfo> {
    const response = await this.createHandler(options);
    const overlay = this.toOverlayInfo(response);

    // If waitForCompletion is requested, poll until complete
    if (options.waitForCompletion) {
      const waitOptions =
        typeof options.waitForCompletion === 'object' ? options.waitForCompletion : undefined;
      return this.waitForCompletion(overlay.id, waitOptions);
    }

    return overlay;
  }

  /**
   * List all overlays for the current sandbox
   * @returns Array of overlay info
   */
  async list(): Promise<OverlayInfo[]> {
    const response = await this.listHandler();
    return response.overlays.map((o) => this.toOverlayInfo(o));
  }

  /**
   * Retrieve a specific overlay by ID
   *
   * Useful for polling the copy status of an overlay.
   *
   * @param id - Overlay ID
   * @returns Overlay info
   */
  async retrieve(id: string): Promise<OverlayInfo> {
    const response = await this.retrieveHandler(id);
    return this.toOverlayInfo(response);
  }

  /**
   * Destroy (delete) an overlay
   * @param id - Overlay ID
   */
  async destroy(id: string): Promise<void> {
    return this.destroyHandler(id);
  }

  /**
   * Wait for an overlay's background copy to complete
   *
   * Polls the overlay status with exponential backoff until the copy
   * is complete or fails. Throws an error if the copy fails or times out.
   *
   * @param id - Overlay ID
   * @param options - Polling options
   * @returns Overlay info with final copy status
   * @throws Error if copy fails or times out
   */
  async waitForCompletion(id: string, options: WaitForCompletionOptions = {}): Promise<OverlayInfo> {
    const maxRetries = options.maxRetries ?? 60;
    const initialDelayMs = options.initialDelayMs ?? 500;
    const maxDelayMs = options.maxDelayMs ?? 5000;
    const backoffFactor = options.backoffFactor ?? 1.5;

    let currentDelay = initialDelayMs;

    for (let i = 0; i < maxRetries; i++) {
      const overlay = await this.retrieve(id);

      if (overlay.copyStatus === 'complete') {
        return overlay;
      }

      if (overlay.copyStatus === 'failed') {
        throw new Error(
          `Overlay copy failed: ${overlay.copyError || 'Unknown error'}\n` +
            `Overlay ID: ${id}`
        );
      }

      // Still pending or in_progress, wait and retry
      if (i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, currentDelay));
        currentDelay = Math.min(currentDelay * backoffFactor, maxDelayMs);
      }
    }

    // Timed out
    const finalOverlay = await this.retrieve(id);
    throw new Error(
      `Overlay copy timed out after ${maxRetries} attempts.\n` +
        `Overlay ID: ${id}\n` +
        `Current status: ${finalOverlay.copyStatus}\n\n` +
        `Try increasing maxRetries or check if the source directory is very large.`
    );
  }

  /**
   * Convert API response to OverlayInfo
   */
  private toOverlayInfo(response: OverlayResponse): OverlayInfo {
    return {
      id: response.id,
      source: response.source,
      target: response.target,
      createdAt: response.created_at,
      stats: {
        copiedFiles: response.stats.copied_files,
        copiedDirs: response.stats.copied_dirs,
        skipped: response.stats.skipped,
      },
      copyStatus: this.validateCopyStatus(response.copy_status),
      copyError: response.copy_error,
    };
  }

  /**
   * Validate and return copy status, defaulting to 'pending' for unknown values
   */
  private validateCopyStatus(status: string): OverlayCopyStatus {
    const validStatuses: OverlayCopyStatus[] = ['pending', 'in_progress', 'complete', 'failed'];
    if (validStatuses.includes(status as OverlayCopyStatus)) {
      return status as OverlayCopyStatus;
    }
    // Default to 'pending' for unknown status values (future-proofing)
    return 'pending';
  }
}