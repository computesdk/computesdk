/**
 * Browser Provider Factory - Creates browser providers from method definitions
 *
 * Eliminates boilerplate by auto-generating BrowserProvider/Session classes
 * from simple method definitions with automatic feature detection.
 * Mirrors the sandbox provider factory pattern.
 */

import type {
  BrowserProvider,
  BrowserSessionManager,
  BrowserProfileManager,
  BrowserExtensionManager,
  BrowserPoolManager,
  BrowserLogManager,
  BrowserRecordingManager,
  BrowserPageOperations,
  ProviderBrowserSession,
  BrowserSession,
  BrowserProfile,
  BrowserExtension,
  BrowserPool,
  BrowserLog,
  BrowserRecording,
  CreateBrowserSessionOptions,
  CreateBrowserProfileOptions,
  CreateBrowserExtensionOptions,
  CreateBrowserPoolOptions,
  ScreenshotOptions,
  PdfOptions,
} from './types/browser.js';

// ─── Method Definitions ──────────────────────────────────────────────────────

/**
 * Session method implementations that provider authors supply
 */
export interface BrowserSessionMethods<TSession = any, TConfig = any> {
  create: (config: TConfig, options?: CreateBrowserSessionOptions) => Promise<{ session: TSession; sessionId: string; connectUrl: string; status?: BrowserSession['status'] }>;
  getById: (config: TConfig, sessionId: string) => Promise<{ session: TSession; sessionId: string; connectUrl: string; status?: BrowserSession['status'] } | null>;
  list: (config: TConfig) => Promise<Array<{ session: TSession; sessionId: string; connectUrl: string; status?: BrowserSession['status'] }>>;
  destroy: (config: TConfig, sessionId: string) => Promise<void>;
  getConnectUrl: (config: TConfig, sessionId: string) => Promise<string>;
}

/**
 * Profile method implementations
 */
export interface BrowserProfileMethods<TConfig = any> {
  create: (config: TConfig, options?: CreateBrowserProfileOptions) => Promise<BrowserProfile>;
  get: (config: TConfig, profileId: string) => Promise<BrowserProfile | null>;
  list: (config: TConfig) => Promise<BrowserProfile[]>;
  delete: (config: TConfig, profileId: string) => Promise<void>;
}

/**
 * Extension method implementations
 */
export interface BrowserExtensionMethods<TConfig = any> {
  create: (config: TConfig, options: CreateBrowserExtensionOptions) => Promise<BrowserExtension>;
  get: (config: TConfig, extensionId: string) => Promise<BrowserExtension | null>;
  delete: (config: TConfig, extensionId: string) => Promise<void>;
}

/**
 * Pool method implementations
 */
export interface BrowserPoolMethods<TSession = any, TConfig = any> {
  create: (config: TConfig, options: CreateBrowserPoolOptions) => Promise<BrowserPool>;
  get: (config: TConfig, poolId: string) => Promise<BrowserPool | null>;
  list: (config: TConfig) => Promise<BrowserPool[]>;
  acquire: (config: TConfig, poolId: string) => Promise<{ session: TSession; sessionId: string; connectUrl: string }>;
  release: (config: TConfig, poolId: string, sessionId: string) => Promise<void>;
  delete: (config: TConfig, poolId: string) => Promise<void>;
}

/**
 * Log method implementations
 */
export interface BrowserLogMethods<TConfig = any> {
  list: (config: TConfig, sessionId: string) => Promise<BrowserLog[]>;
}

/**
 * Recording method implementations
 */
export interface BrowserRecordingMethods<TConfig = any> {
  get: (config: TConfig, sessionId: string) => Promise<BrowserRecording | null>;
}

/**
 * Page operation method implementations
 */
export interface BrowserPageMethods<TSession = any> {
  navigate: (session: TSession, url: string) => Promise<void>;
  screenshot: (session: TSession, options?: ScreenshotOptions) => Promise<Uint8Array>;
  pdf?: (session: TSession, options?: PdfOptions) => Promise<Uint8Array>;
  evaluate: (session: TSession, script: string) => Promise<unknown>;
  getContent: (session: TSession) => Promise<string>;
}

/**
 * Full browser provider configuration for defineBrowserProvider()
 */
export interface BrowserProviderConfig<TSession = any, TConfig = any> {
  name: string;
  methods: {
    session: BrowserSessionMethods<TSession, TConfig>;
    profile?: BrowserProfileMethods<TConfig>;
    extension?: BrowserExtensionMethods<TConfig>;
    pool?: BrowserPoolMethods<TSession, TConfig>;
    logs?: BrowserLogMethods<TConfig>;
    recording?: BrowserRecordingMethods<TConfig>;
    page?: BrowserPageMethods<TSession>;
  };
}

// ─── Generated Classes ───────────────────────────────────────────────────────

/**
 * Generated browser session — implements ProviderBrowserSession
 */
class GeneratedBrowserSession<TSession = any> implements ProviderBrowserSession<TSession> {
  readonly sessionId: string;
  readonly connectUrl: string;
  readonly status: BrowserSession['status'];
  readonly createdAt?: Date;
  readonly metadata?: Record<string, unknown>;

  constructor(
    private session: TSession,
    sessionId: string,
    connectUrl: string,
    status: BrowserSession['status'] | undefined,
    private providerInstance: BrowserProvider<TSession>,
    private config: any,
    private sessionMethods: BrowserSessionMethods<TSession>,
    private logMethods?: BrowserLogMethods,
    private recordingMethods?: BrowserRecordingMethods,
    private pageMethods?: BrowserPageMethods<TSession>,
  ) {
    this.sessionId = sessionId;
    this.connectUrl = connectUrl;
    this.status = status ?? 'running';
  }

  getInstance(): TSession {
    return this.session;
  }

  getProvider(): BrowserProvider<TSession> {
    return this.providerInstance;
  }

  async destroy(): Promise<void> {
    await this.sessionMethods.destroy(this.config, this.sessionId);
  }

  async screenshot(options?: ScreenshotOptions): Promise<Uint8Array> {
    if (!this.pageMethods) {
      throw new Error(
        `Provider '${this.providerInstance.name}' does not support native page operations. ` +
        `Use the connectUrl to control the browser via Playwright/Puppeteer instead.`
      );
    }
    return this.pageMethods.screenshot(this.session, options);
  }

  async getLogs(): Promise<BrowserLog[]> {
    if (!this.logMethods) {
      throw new Error(`Provider '${this.providerInstance.name}' does not support log retrieval.`);
    }
    return this.logMethods.list(this.config, this.sessionId);
  }

  async getRecording(): Promise<BrowserRecording | null> {
    if (!this.recordingMethods) {
      throw new Error(`Provider '${this.providerInstance.name}' does not support recordings.`);
    }
    return this.recordingMethods.get(this.config, this.sessionId);
  }
}

/**
 * Generated session manager
 */
class GeneratedSessionManager<TSession, TConfig> implements BrowserSessionManager<TSession> {
  constructor(
    private config: TConfig,
    private methods: BrowserSessionMethods<TSession, TConfig>,
    private providerInstance: BrowserProvider<TSession>,
    private logMethods?: BrowserLogMethods<TConfig>,
    private recordingMethods?: BrowserRecordingMethods<TConfig>,
    private pageMethods?: BrowserPageMethods<TSession>,
  ) {}

  async create(options?: CreateBrowserSessionOptions): Promise<ProviderBrowserSession<TSession>> {
    const result = await this.methods.create(this.config, options);
    return new GeneratedBrowserSession(
      result.session, result.sessionId, result.connectUrl, result.status,
      this.providerInstance, this.config, this.methods,
      this.logMethods, this.recordingMethods, this.pageMethods,
    );
  }

  async getById(sessionId: string): Promise<ProviderBrowserSession<TSession> | null> {
    const result = await this.methods.getById(this.config, sessionId);
    if (!result) return null;
    return new GeneratedBrowserSession(
      result.session, result.sessionId, result.connectUrl, result.status,
      this.providerInstance, this.config, this.methods,
      this.logMethods, this.recordingMethods, this.pageMethods,
    );
  }

  async list(): Promise<ProviderBrowserSession<TSession>[]> {
    const results = await this.methods.list(this.config);
    return results.map(r => new GeneratedBrowserSession(
      r.session, r.sessionId, r.connectUrl, r.status,
      this.providerInstance, this.config, this.methods,
      this.logMethods, this.recordingMethods, this.pageMethods,
    ));
  }

  async destroy(sessionId: string): Promise<void> {
    await this.methods.destroy(this.config, sessionId);
  }
}

/**
 * Generated profile manager
 */
class GeneratedProfileManager<TConfig> implements BrowserProfileManager {
  constructor(private config: TConfig, private methods: BrowserProfileMethods<TConfig>) {}

  async create(options?: CreateBrowserProfileOptions): Promise<BrowserProfile> {
    return this.methods.create(this.config, options);
  }
  async get(profileId: string): Promise<BrowserProfile | null> {
    return this.methods.get(this.config, profileId);
  }
  async list(): Promise<BrowserProfile[]> {
    return this.methods.list(this.config);
  }
  async delete(profileId: string): Promise<void> {
    return this.methods.delete(this.config, profileId);
  }
}

/**
 * Generated extension manager
 */
class GeneratedExtensionManager<TConfig> implements BrowserExtensionManager {
  constructor(private config: TConfig, private methods: BrowserExtensionMethods<TConfig>) {}

  async create(options: CreateBrowserExtensionOptions): Promise<BrowserExtension> {
    return this.methods.create(this.config, options);
  }
  async get(extensionId: string): Promise<BrowserExtension | null> {
    return this.methods.get(this.config, extensionId);
  }
  async delete(extensionId: string): Promise<void> {
    return this.methods.delete(this.config, extensionId);
  }
}

/**
 * Generated pool manager
 */
class GeneratedPoolManager<TSession, TConfig> implements BrowserPoolManager<TSession> {
  constructor(
    private config: TConfig,
    private methods: BrowserPoolMethods<TSession, TConfig>,
    private providerInstance: BrowserProvider<TSession>,
    private sessionMethods: BrowserSessionMethods<TSession, TConfig>,
    private logMethods?: BrowserLogMethods<TConfig>,
    private recordingMethods?: BrowserRecordingMethods<TConfig>,
    private pageMethods?: BrowserPageMethods<TSession>,
  ) {}

  async create(options: CreateBrowserPoolOptions): Promise<BrowserPool> {
    return this.methods.create(this.config, options);
  }
  async get(poolId: string): Promise<BrowserPool | null> {
    return this.methods.get(this.config, poolId);
  }
  async list(): Promise<BrowserPool[]> {
    return this.methods.list(this.config);
  }
  async acquire(poolId: string): Promise<ProviderBrowserSession<TSession>> {
    const result = await this.methods.acquire(this.config, poolId);
    return new GeneratedBrowserSession(
      result.session, result.sessionId, result.connectUrl, 'running',
      this.providerInstance, this.config, this.sessionMethods,
      this.logMethods, this.recordingMethods, this.pageMethods,
    );
  }
  async release(poolId: string, sessionId: string): Promise<void> {
    return this.methods.release(this.config, poolId, sessionId);
  }
  async delete(poolId: string): Promise<void> {
    return this.methods.delete(this.config, poolId);
  }
}

/**
 * Generated page operations
 */
class GeneratedPageOperations<TSession> implements BrowserPageOperations<TSession> {
  pdf?: (session: TSession, options?: PdfOptions) => Promise<Uint8Array>;

  constructor(private methods: BrowserPageMethods<TSession>) {
    if (methods.pdf) {
      const pdfMethod = methods.pdf;
      this.pdf = (session: TSession, options?: PdfOptions) => pdfMethod(session, options);
    }
  }

  async navigate(session: TSession, url: string): Promise<void> {
    return this.methods.navigate(session, url);
  }
  async screenshot(session: TSession, options?: ScreenshotOptions): Promise<Uint8Array> {
    return this.methods.screenshot(session, options);
  }
  async evaluate(session: TSession, script: string): Promise<unknown> {
    return this.methods.evaluate(session, script);
  }
  async getContent(session: TSession): Promise<string> {
    return this.methods.getContent(session);
  }
}

/**
 * Generated browser provider
 */
class GeneratedBrowserProvider<TSession, TConfig> implements BrowserProvider<TSession> {
  readonly name: string;
  readonly session: BrowserSessionManager<TSession>;
  readonly profile?: BrowserProfileManager;
  readonly extension?: BrowserExtensionManager;
  readonly pool?: BrowserPoolManager;
  readonly logs?: BrowserLogManager;
  readonly recording?: BrowserRecordingManager;
  readonly page?: BrowserPageOperations<TSession>;

  private config: TConfig;
  private sessionMethods: BrowserSessionMethods<TSession, TConfig>;

  constructor(config: TConfig, providerConfig: BrowserProviderConfig<TSession, TConfig>) {
    this.name = providerConfig.name;
    this.config = config;
    this.sessionMethods = providerConfig.methods.session;

    const logMethods = providerConfig.methods.logs;
    const recordingMethods = providerConfig.methods.recording;
    const pageMethods = providerConfig.methods.page;

    // Session manager (always present)
    this.session = new GeneratedSessionManager(
      config, providerConfig.methods.session, this,
      logMethods, recordingMethods, pageMethods,
    );

    // Optional managers — auto-detected from provided methods
    if (providerConfig.methods.profile) {
      this.profile = new GeneratedProfileManager(config, providerConfig.methods.profile);
    }
    if (providerConfig.methods.extension) {
      this.extension = new GeneratedExtensionManager(config, providerConfig.methods.extension);
    }
    if (providerConfig.methods.pool) {
      this.pool = new GeneratedPoolManager(
        config, providerConfig.methods.pool, this,
        providerConfig.methods.session, logMethods, recordingMethods, pageMethods,
      );
    }
    if (logMethods) {
      this.logs = { list: (sessionId: string) => logMethods.list(config, sessionId) };
    }
    if (recordingMethods) {
      this.recording = { get: (sessionId: string) => recordingMethods.get(config, sessionId) };
    }
    if (pageMethods) {
      this.page = new GeneratedPageOperations(pageMethods);
    }
  }

  async getConnectUrl(sessionId: string): Promise<string> {
    return this.sessionMethods.getConnectUrl(this.config, sessionId);
  }
}

// ─── Public Factory ──────────────────────────────────────────────────────────

/**
 * Create a browser provider from method definitions
 *
 * Auto-generates all boilerplate classes and provides feature detection
 * based on which methods are implemented.
 *
 * @example
 * ```ts
 * export const browserbase = defineBrowserProvider<BrowserbaseSession, BrowserbaseConfig>({
 *   name: 'browserbase',
 *   methods: {
 *     session: { create, getById, list, destroy, getConnectUrl },
 *     profile: { create, get, list, delete },
 *     logs: { list: getLogs },
 *     recording: { get: getRecording },
 *   },
 * });
 *
 * // Usage:
 * const provider = browserbase({ apiKey: 'bb_...' });
 * const session = await provider.session.create({ stealth: true });
 * console.log(session.connectUrl);
 * ```
 */
export function defineBrowserProvider<TSession, TConfig = any>(
  providerConfig: BrowserProviderConfig<TSession, TConfig>
): (config: TConfig) => BrowserProvider<TSession> {
  return (config: TConfig) => {
    return new GeneratedBrowserProvider(config, providerConfig);
  };
}
