/**
 * Overlay - Resource namespace for filesystem overlay operations
 *
 * Overlays enable instant sandbox setup from template directories by copying
 * files directly for isolation, with heavy directories copied in the background.
 */

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
   * @returns Overlay info with copy status
   */
  async create(options: CreateOverlayOptions): Promise<OverlayInfo> {
    const response = await this.createHandler(options);
    return this.toOverlayInfo(response);
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