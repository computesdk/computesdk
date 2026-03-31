/**
 * Browser Provider Types
 *
 * Types for browser providers (Browserbase, Kernel, etc.)
 * Browser providers manage cloud browser sessions, distinct from sandbox providers
 * which manage code execution environments.
 */

// ─── Session Types ───────────────────────────────────────────────────────────

/**
 * Browser session info returned from provider APIs
 */
export interface BrowserSession {
  /** Unique session identifier */
  sessionId: string;
  /** CDP or WebSocket connection URL */
  connectUrl: string;
  /** Current session status */
  status: 'created' | 'running' | 'completed' | 'failed' | 'timed_out';
  /** Session creation timestamp */
  createdAt?: Date;
  /** Provider-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Options for creating a browser session
 */
export interface CreateBrowserSessionOptions {
  /** Proxy configuration — true for provider default, or detailed config */
  proxies?: boolean | ProxyConfig[];
  /** Browser viewport dimensions */
  viewport?: { width: number; height: number };
  /** Session timeout in seconds */
  timeout?: number;
  /** Keep session alive after script disconnects */
  keepAlive?: boolean;
  /** Enable session recording (default: true) */
  recording?: boolean;
  /** Enable session logging (default: true) */
  logging?: boolean;
  /** Enable stealth/anti-detection mode */
  stealth?: boolean;
  /** Browser profile/context ID for session persistence */
  profileId?: string;
  /** Extension IDs to load */
  extensionIds?: string[];
  /** Region/datacenter preference */
  region?: string;
  /** Custom user metadata */
  userMetadata?: Record<string, string>;
}

/**
 * Proxy configuration for browser sessions
 */
export interface ProxyConfig {
  /** Proxy type */
  type: 'residential' | 'isp' | 'datacenter' | 'custom';
  /** Proxy server URL (for custom type) */
  server?: string;
  /** Proxy username */
  username?: string;
  /** Proxy password */
  password?: string;
  /** Geolocation targeting */
  geolocation?: {
    country?: string;
    state?: string;
    city?: string;
  };
  /** Domain pattern to route through this proxy */
  domainPattern?: string;
}

// ─── Profile Types ───────────────────────────────────────────────────────────

/**
 * Browser profile (persistent context — cookies, storage, etc.)
 */
export interface BrowserProfile {
  /** Unique profile identifier */
  profileId: string;
  /** Human-readable name */
  name?: string;
  /** Creation timestamp */
  createdAt?: Date;
  /** Provider-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Options for creating a browser profile
 */
export interface CreateBrowserProfileOptions {
  /** Human-readable name */
  name?: string;
  /** Custom metadata */
  metadata?: Record<string, string>;
}

// ─── Extension Types ─────────────────────────────────────────────────────────

/**
 * Browser extension
 */
export interface BrowserExtension {
  /** Unique extension identifier */
  extensionId: string;
  /** Extension name */
  name?: string;
}

/**
 * Options for uploading/creating a browser extension
 */
export interface CreateBrowserExtensionOptions {
  /** Extension file data */
  file: Uint8Array | string;
  /** Extension name */
  name?: string;
}

// ─── Pool Types ──────────────────────────────────────────────────────────────

/**
 * Browser pool — pre-warmed browser instances for instant acquisition
 */
export interface BrowserPool {
  /** Unique pool identifier */
  poolId: string;
  /** Pool name */
  name?: string;
  /** Number of idle instances ready */
  idleCount?: number;
  /** Number of active instances in use */
  activeCount?: number;
}

/**
 * Options for creating a browser pool
 */
export interface CreateBrowserPoolOptions {
  /** Pool name */
  name: string;
  /** Desired number of pre-warmed instances */
  size: number;
  /** Default session options for pool instances */
  sessionDefaults?: CreateBrowserSessionOptions;
}

// ─── Observability Types ─────────────────────────────────────────────────────

/**
 * Browser session log entry
 */
export interface BrowserLog {
  /** Timestamp */
  timestamp: Date;
  /** Log level */
  level: 'info' | 'warn' | 'error' | 'debug';
  /** Log message */
  message: string;
  /** Additional structured data */
  data?: Record<string, unknown>;
}

/**
 * Browser session recording
 */
export interface BrowserRecording {
  /** Recording identifier */
  recordingId: string;
  /** Session this recording belongs to */
  sessionId: string;
  /** Recording format */
  format: 'rrweb' | 'mp4' | string;
  /** URL to access the recording */
  url?: string;
  /** Raw recording data */
  data?: unknown;
}

// ─── Page Operation Types ────────────────────────────────────────────────────

/**
 * Screenshot options
 */
export interface ScreenshotOptions {
  /** Image format */
  format?: 'png' | 'jpeg' | 'webp';
  /** Quality (0-100, for jpeg/webp) */
  quality?: number;
  /** Capture full scrollable page */
  fullPage?: boolean;
  /** CSS selector to capture */
  selector?: string;
}

/**
 * PDF generation options
 */
export interface PdfOptions {
  /** Paper format */
  format?: 'letter' | 'legal' | 'a4' | 'a3';
  /** Print background graphics */
  printBackground?: boolean;
  /** Landscape orientation */
  landscape?: boolean;
}

// ─── Manager Interfaces ──────────────────────────────────────────────────────

/**
 * Browser session manager — core lifecycle operations
 */
export interface BrowserSessionManager<TSession = any> {
  /** Create a new browser session */
  create(options?: CreateBrowserSessionOptions): Promise<ProviderBrowserSession<TSession>>;
  /** Get an existing session by ID */
  getById(sessionId: string): Promise<ProviderBrowserSession<TSession> | null>;
  /** List active sessions */
  list(): Promise<ProviderBrowserSession<TSession>[]>;
  /** Destroy/terminate a session */
  destroy(sessionId: string): Promise<void>;
}

/**
 * Browser profile manager
 */
export interface BrowserProfileManager {
  /** Create a new profile */
  create(options?: CreateBrowserProfileOptions): Promise<BrowserProfile>;
  /** Get an existing profile */
  get(profileId: string): Promise<BrowserProfile | null>;
  /** List profiles */
  list(): Promise<BrowserProfile[]>;
  /** Delete a profile */
  delete(profileId: string): Promise<void>;
}

/**
 * Browser extension manager
 */
export interface BrowserExtensionManager {
  /** Upload/create an extension */
  create(options: CreateBrowserExtensionOptions): Promise<BrowserExtension>;
  /** Get an extension by ID */
  get(extensionId: string): Promise<BrowserExtension | null>;
  /** Delete an extension */
  delete(extensionId: string): Promise<void>;
}

/**
 * Browser pool manager (pre-warmed instances)
 */
export interface BrowserPoolManager<TSession = any> {
  /** Create a new pool */
  create(options: CreateBrowserPoolOptions): Promise<BrowserPool>;
  /** Get pool by ID */
  get(poolId: string): Promise<BrowserPool | null>;
  /** List pools */
  list(): Promise<BrowserPool[]>;
  /** Acquire a browser from the pool */
  acquire(poolId: string): Promise<ProviderBrowserSession<TSession>>;
  /** Release a browser back to the pool */
  release(poolId: string, sessionId: string): Promise<void>;
  /** Delete a pool */
  delete(poolId: string): Promise<void>;
}

/**
 * Browser log manager
 */
export interface BrowserLogManager {
  /** Get logs for a session */
  list(sessionId: string): Promise<BrowserLog[]>;
}

/**
 * Browser recording manager
 */
export interface BrowserRecordingManager {
  /** Get recording for a session */
  get(sessionId: string): Promise<BrowserRecording | null>;
}

/**
 * Browser page operations — native browser control (optional, provider-dependent)
 */
export interface BrowserPageOperations<TSession = any> {
  /** Navigate to a URL */
  navigate(session: TSession, url: string): Promise<void>;
  /** Take a screenshot */
  screenshot(session: TSession, options?: ScreenshotOptions): Promise<Uint8Array>;
  /** Generate a PDF */
  pdf?(session: TSession, options?: PdfOptions): Promise<Uint8Array>;
  /** Evaluate JavaScript in the page context */
  evaluate(session: TSession, script: string): Promise<unknown>;
  /** Get the current page HTML */
  getContent(session: TSession): Promise<string>;
}

// ─── Provider Browser Session ────────────────────────────────────────────────

/**
 * Provider browser session — wraps raw session with provider methods
 * Analogous to ProviderSandbox for sandbox providers.
 */
export interface ProviderBrowserSession<TSession = any> extends BrowserSession {
  /** Get the provider that created this session */
  getProvider(): BrowserProvider<TSession>;
  /** Get the native provider session instance */
  getInstance(): TSession;
  /** Destroy this session */
  destroy(): Promise<void>;
  /** Take a screenshot (delegates to provider page ops or throws) */
  screenshot(options?: ScreenshotOptions): Promise<Uint8Array>;
  /** Get session logs */
  getLogs(): Promise<BrowserLog[]>;
  /** Get session recording */
  getRecording(): Promise<BrowserRecording | null>;
}

// ─── Browser Provider Interface ──────────────────────────────────────────────

/**
 * Browser provider interface — creates and manages browser sessions
 *
 * This is the top-level interface for browser providers, analogous to
 * the Provider interface for sandbox providers.
 */
export interface BrowserProvider<TSession = any> {
  /** Provider name/type */
  readonly name: string;

  /** Session lifecycle management */
  readonly session: BrowserSessionManager<TSession>;

  /** Get CDP/WebSocket connection URL for a session */
  getConnectUrl(sessionId: string): Promise<string>;

  /** Optional profile management (Browserbase contexts, Kernel profiles) */
  readonly profile?: BrowserProfileManager;

  /** Optional extension management */
  readonly extension?: BrowserExtensionManager;

  /** Optional pool management (pre-warmed instances) */
  readonly pool?: BrowserPoolManager<TSession>;

  /** Optional log access */
  readonly logs?: BrowserLogManager;

  /** Optional recording access */
  readonly recording?: BrowserRecordingManager;

  /** Optional native page operations */
  readonly page?: BrowserPageOperations<TSession>;
}
