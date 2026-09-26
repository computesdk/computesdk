/**
 * Provider Factory - Creates providers from method definitions
 * 
 * Eliminates boilerplate by auto-generating Provider/Sandbox classes
 * from simple method definitions with automatic feature detection.
 */

// Import all types from local types
import type {
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
  SandboxFileSystem,
  Provider,
  ProviderSandboxManager,
  ProviderTemplateManager,
  ProviderSnapshotManager,
  ProviderSandbox,
  SandboxInfo,
  CommandResult,
  CreateSnapshotOptions,
  ListSnapshotsOptions,
  CreateTemplateOptions,
  ListTemplatesOptions,
  StartProcessOptions,
  ProcessStatus,
  ProcessHandle,
} from './types/index.js';
import {
  daemonSeedScriptCommand,
  parseSeedInvocationOutput,
  type SeedCommandInput,
  type SeedInput,
  type SeedInvocationResult,
} from 'daemond';

type DaemonStreamState = {
  token: string;
  rawSseUrl: string;
};

const DEFAULT_DAEMON_SSE_PORT = 38989;

function createDaemonRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * Parses a seed-launcher invocation, turning a failed or empty launcher run
 * into a `daemond:`-prefixed capability error — e.g. a sandbox that lacks a JS
 * runtime and could not bootstrap one exits 127 with the reason on stderr —
 * instead of the opaque "expected JSON output". Callers can match on the
 * `daemond:` prefix to degrade to plain `runCommand`.
 */
function parseDaemonSeedResult(result: CommandResult, phase: string): SeedInvocationResult {
  const stdout = (result.stdout ?? '').trim();
  const stderrTail = (result.stderr ?? '').trim().slice(-400);
  if (!stdout) {
    throw new Error(
      `daemond: ${phase} produced no JSON output (exit code ${result.exitCode ?? 'unknown'})` +
        (stderrTail ? `: ${stderrTail}` : '')
    );
  }
  try {
    return parseSeedInvocationOutput(result.stdout);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `daemond: ${phase} failed: ${detail}` +
        (stderrTail ? ` (stderr: ${stderrTail})` : '')
    );
  }
}

function emitMissingOutput(
  emitted: string,
  finalOutput: string,
  emit: (data: string) => void
): void {
  if (!finalOutput) return;
  if (!emitted) {
    emit(finalOutput);
    return;
  }
  if (finalOutput.startsWith(emitted)) {
    const missing = finalOutput.slice(emitted.length);
    if (missing) emit(missing);
    return;
  }
  if (finalOutput.includes(emitted)) {
    return;
  }
  if (emitted.includes(finalOutput)) {
    return;
  }
  if (!emitted.includes(finalOutput)) {
    emit(finalOutput);
  }
}

/**
 * Emits the incremental diff between a previously seen buffer and the newest
 * snapshot. Normally the snapshot only grows, so the diff is a suffix — but a
 * truncated buffer drops the head, in which case we emit the new buffer minus
 * the longest overlap still shared with what was already delivered.
 */
function emitProcessDiff(
  seen: { value: string },
  next: string,
  emit?: (chunk: string) => void
): void {
  const previous = seen.value;
  seen.value = next;
  if (!emit || !next) return;
  if (next.startsWith(previous)) {
    const diff = next.slice(previous.length);
    if (diff) emit(diff);
    return;
  }
  const maxOverlap = Math.min(previous.length, next.length);
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    if (previous.endsWith(next.slice(0, overlap))) {
      const diff = next.slice(overlap);
      if (diff) emit(diff);
      return;
    }
  }
  emit(next);
}

function parseSseDataLines(raw: string): string[] {
  const chunks = raw.split(/\n\n+/);
  const out: string[] = [];
  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (line.startsWith('data:')) {
        out.push(line.slice(5).trim());
      }
    }
  }
  return out;
}

function pickString(source: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

function pickNullableNumber(source: Record<string, unknown> | undefined, keys: string[]): number | null | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number') return value;
    if (value === null) return null;
  }
  return undefined;
}

function normalizeDaemonStreamEvent(payload: unknown): {
  type?: string;
  requestId?: string;
  jobId?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  signal?: string | null;
} {
  if (!payload || typeof payload !== 'object') return {};
  const record = payload as Record<string, unknown>;
  const data = (record.data && typeof record.data === 'object')
    ? (record.data as Record<string, unknown>)
    : undefined;
  const type = pickString(record, ['type', 'event']);
  const requestId = pickString(record, ['requestId']) ?? pickString(data, ['requestId']);
  const jobId = pickString(record, ['jobId']) ?? pickString(data, ['jobId']);
  const stdout = pickString(record, ['stdout', 'output', 'chunk']) ?? pickString(data, ['stdout', 'output', 'chunk']);
  const stderr = pickString(record, ['stderr']) ?? pickString(data, ['stderr']);
  const exitCode = pickNullableNumber(record, ['exitCode']) ?? pickNullableNumber(data, ['exitCode']);
  const signal = pickString(record, ['signal']) ?? pickString(data, ['signal']);
  return { type, requestId, jobId, stdout, stderr, exitCode, signal };
}

async function streamDaemonEvents(
  sseUrl: string,
  filter: { requestId?: { current?: string }; jobId?: string },
  callbacks: {
    onStdout?: (data: string) => void;
    onStderr?: (data: string) => void;
    onExit?: (exitCode: number | null, signal: string | null) => void;
    markStdout: (chunk?: string) => void;
    markStderr: (chunk?: string) => void;
  },
  signal: AbortSignal
): Promise<void> {
  const response = await fetch(sseUrl, { signal });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to open daemon event stream: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const dataLines = parseSseDataLines(frame);
      for (const dataLine of dataLines) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(dataLine);
        } catch {
          continue;
        }
        const event = normalizeDaemonStreamEvent(parsed);
        if (filter.requestId?.current && event.requestId !== filter.requestId.current) {
          continue;
        }
        if (filter.jobId && event.jobId !== filter.jobId) {
          continue;
        }
        if (event.type === 'command.exit') {
          callbacks.onExit?.(event.exitCode ?? null, event.signal ?? null);
          return;
        }
        if ((event.type === 'command.stdout' || !event.type) && event.stdout && callbacks.onStdout) {
          callbacks.markStdout(event.stdout);
          callbacks.onStdout(event.stdout);
        }
        const stderrChunk = event.stderr ?? (event.type === 'command.stderr' ? event.stdout : undefined);
        if ((event.type === 'command.stderr' || !event.type) && stderrChunk && callbacks.onStderr) {
          callbacks.markStderr(stderrChunk);
          callbacks.onStderr(stderrChunk);
        }
      }
    }
  }
}

/**
 * Flat sandbox method implementations - all operations in one place
 */
export interface SandboxMethods<TSandbox = any, TConfig = any> {
  // Collection operations (map to compute.sandbox.*)
  create: (config: TConfig, options?: CreateSandboxOptions) => Promise<{ sandbox: TSandbox; sandboxId: string }>;
  getById: (config: TConfig, sandboxId: string) => Promise<{ sandbox: TSandbox; sandboxId: string } | null>;
  list: (config: TConfig) => Promise<Array<{ sandbox: TSandbox; sandboxId: string }>>;
  destroy: (config: TConfig, sandboxId: string) => Promise<void>;

  // Instance operations
  runCommand: (sandbox: TSandbox, command: string, options?: RunCommandOptions) => Promise<CommandResult>;

  /**
   * Optional native streaming implementation, used instead of the daemond SSE
   * bridge when the caller passes `onStdout`/`onStderr`.
   *
   * The bridge reaches the daemon over an HTTP port inside the sandbox, so it
   * only works where that port is routable from the caller. A provider whose
   * own API streams a process's output — Tensorlake's `followStdout`, for
   * instance — should stream through it rather than expose a port, and this is
   * where that implementation goes. Callbacks must fire while the command runs;
   * a provider that can only deliver output at exit should leave this unset.
   */
  streamCommand?: (sandbox: TSandbox, command: string, options: RunCommandOptions) => Promise<CommandResult>;
  getInfo: (sandbox: TSandbox) => Promise<SandboxInfo>;
  getUrl: (sandbox: TSandbox, options: { port: number; protocol?: string }) => Promise<string>;

  // Optional provider-specific typed getInstance method
  getInstance?: (sandbox: TSandbox) => TSandbox;

  // Optional filesystem methods
  filesystem?: {
    readFile: (sandbox: TSandbox, path: string, runCommand: (sandbox: TSandbox, command: string, options?: RunCommandOptions) => Promise<CommandResult>) => Promise<string>;
    writeFile: (sandbox: TSandbox, path: string, content: string, runCommand: (sandbox: TSandbox, command: string, options?: RunCommandOptions) => Promise<CommandResult>) => Promise<void>;
    mkdir: (sandbox: TSandbox, path: string, runCommand: (sandbox: TSandbox, command: string, options?: RunCommandOptions) => Promise<CommandResult>) => Promise<void>;
    readdir: (sandbox: TSandbox, path: string, runCommand: (sandbox: TSandbox, command: string, options?: RunCommandOptions) => Promise<CommandResult>) => Promise<FileEntry[]>;
    exists: (sandbox: TSandbox, path: string, runCommand: (sandbox: TSandbox, command: string, options?: RunCommandOptions) => Promise<CommandResult>) => Promise<boolean>;
    remove: (sandbox: TSandbox, path: string, runCommand: (sandbox: TSandbox, command: string, options?: RunCommandOptions) => Promise<CommandResult>) => Promise<void>;
  };
}

/**
 * Template method implementations
 */
export interface TemplateMethods<TTemplate = any, TConfig = any, TCreateOptions extends CreateTemplateOptions = CreateTemplateOptions> {
  create: (config: TConfig, options: TCreateOptions) => Promise<TTemplate>;
  list: (config: TConfig, options?: ListTemplatesOptions) => Promise<TTemplate[]>;
  delete: (config: TConfig, templateId: string) => Promise<void>;
}

/**
 * Snapshot method implementations  
 */
export interface SnapshotMethods<TSnapshot = any, TConfig = any> {
  create: (config: TConfig, sandboxId: string, options?: CreateSnapshotOptions) => Promise<TSnapshot>;
  list: (config: TConfig, options?: ListSnapshotsOptions) => Promise<TSnapshot[]>;
  delete: (config: TConfig, snapshotId: string) => Promise<void>;
}

/**
 * Provider configuration for defineProvider()
 */
export interface ProviderConfig<TSandbox = any, TConfig = any, TTemplate = any, TSnapshot = any> {
  name: string;
  methods: {
    sandbox: SandboxMethods<TSandbox, TConfig>;
    template?: TemplateMethods<TTemplate, TConfig>;
    snapshot?: SnapshotMethods<TSnapshot, TConfig>;
  };
}

/**
 * Auto-generated filesystem implementation that throws "not supported" errors
 */
class UnsupportedFileSystem implements SandboxFileSystem {
  private readonly providerName: string;

  constructor(providerName: string) {
    this.providerName = providerName;
  }

  async readFile(_path: string): Promise<string> {
    throw new Error(`Filesystem operations are not supported by ${this.providerName}'s sandbox environment. ${this.providerName} sandboxes are designed for code execution only.`);
  }

  async writeFile(_path: string, _content: string): Promise<void> {
    throw new Error(`Filesystem operations are not supported by ${this.providerName}'s sandbox environment. ${this.providerName} sandboxes are designed for code execution only.`);
  }

  async mkdir(_path: string): Promise<void> {
    throw new Error(`Filesystem operations are not supported by ${this.providerName}'s sandbox environment. ${this.providerName} sandboxes are designed for code execution only.`);
  }

  async readdir(_path: string): Promise<FileEntry[]> {
    throw new Error(`Filesystem operations are not supported by ${this.providerName}'s sandbox environment. ${this.providerName} sandboxes are designed for code execution only.`);
  }

  async exists(_path: string): Promise<boolean> {
    throw new Error(`Filesystem operations are not supported by ${this.providerName}'s sandbox environment. ${this.providerName} sandboxes are designed for code execution only.`);
  }

  async remove(_path: string): Promise<void> {
    throw new Error(`Filesystem operations are not supported by ${this.providerName}'s sandbox environment. ${this.providerName} sandboxes are designed for code execution only.`);
  }
}



/**
 * Auto-generated filesystem implementation that wraps provider methods
 */
class SupportedFileSystem<TSandbox> implements SandboxFileSystem {
  constructor(
    private sandbox: TSandbox,
    private methods: NonNullable<SandboxMethods<TSandbox>['filesystem']>,
    private allMethods: SandboxMethods<TSandbox>
  ) {}

  async readFile(path: string): Promise<string> {
    return this.methods.readFile(this.sandbox, path, this.allMethods.runCommand);
  }

  async writeFile(path: string, content: string): Promise<void> {
    return this.methods.writeFile(this.sandbox, path, content, this.allMethods.runCommand);
  }

  async mkdir(path: string): Promise<void> {
    return this.methods.mkdir(this.sandbox, path, this.allMethods.runCommand);
  }

  async readdir(path: string): Promise<FileEntry[]> {
    return this.methods.readdir(this.sandbox, path, this.allMethods.runCommand);
  }

  async exists(path: string): Promise<boolean> {
    return this.methods.exists(this.sandbox, path, this.allMethods.runCommand);
  }

  async remove(path: string): Promise<void> {
    return this.methods.remove(this.sandbox, path, this.allMethods.runCommand);
  }
}





/**
 * Generated sandbox class - implements the ProviderSandbox interface
 */
class GeneratedSandbox<TSandbox = any> implements ProviderSandbox<TSandbox> {
  readonly sandboxId: string;
  readonly provider: string;
  readonly filesystem: SandboxFileSystem;
  private daemonStreamState?: DaemonStreamState;
  constructor(
    private sandbox: TSandbox,
    sandboxId: string,
    providerName: string,
    private methods: SandboxMethods<TSandbox>,
    private config: any,
    private destroyMethod: (config: any, sandboxId: string) => Promise<void>,
    private providerInstance: Provider
  ) {
    this.sandboxId = sandboxId;
    this.provider = providerName;

    // Auto-detect filesystem support
    if (methods.filesystem) {
      this.filesystem = new SupportedFileSystem(sandbox, methods.filesystem, methods);
    } else {
      this.filesystem = new UnsupportedFileSystem(providerName);
    }
  }

  getInstance(): TSandbox {
    // Use provider-specific typed getInstance if available
    if (this.methods.getInstance) {
      return this.methods.getInstance(this.sandbox);
    }
    // Fallback to returning the sandbox directly
    return this.sandbox;
  }

  private async resolveDaemonSseUrl(
    rawUrl: string,
    expectedToken: string
  ): Promise<string> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error('Invalid daemon SSE URL returned by command invocation.');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Unsupported daemon SSE URL protocol: ${parsed.protocol}`);
    }

    const urlToken = parsed.searchParams.get('token');
    if (!urlToken || urlToken !== expectedToken) {
      throw new Error('Daemon SSE URL token mismatch.');
    }

    const parsedPort = parsed.port ? Number(parsed.port) : NaN;
    if (!Number.isFinite(parsedPort) || parsedPort <= 0) {
      throw new Error('Daemon SSE URL must include a valid port.');
    }

    const providerBaseUrl = await this.methods.getUrl(this.sandbox, { port: parsedPort });
    const providerUrl = new URL(providerBaseUrl);

    parsed = new URL(providerUrl.toString());
    parsed.pathname = '/events';
    parsed.search = `?token=${encodeURIComponent(expectedToken)}`;
    parsed.hash = '';

    return parsed.toString();
  }

  async runCommand(
    command: string,
    options?: RunCommandOptions
  ): Promise<CommandResult> {
    if (options?.onStdout || options?.onStderr) {
      if (options.background) {
        throw new Error('runCommand with streaming callbacks does not support background mode.');
      }

      // A provider that streams over its own API needs neither the daemon nor a
      // routable port for it, so it is asked first.
      if (this.methods.streamCommand) {
        return await this.methods.streamCommand(this.sandbox, command, options);
      }

      const forwardedOptions: RunCommandOptions = { ...options };
      delete forwardedOptions.onStdout;
      delete forwardedOptions.onStderr;

      await this.ensureDaemon(options, forwardedOptions);

      const daemonPayload: SeedCommandInput = {
        command: 'sh',
        args: ['-lc', command],
        cwd: options.cwd,
        env: options.env,
        timeoutMs: options.timeout,
        requestId: createDaemonRequestId(),
      };

      const daemonCommand = daemonSeedScriptCommand(
        { ssePort: DEFAULT_DAEMON_SSE_PORT },
        daemonPayload
      );

      const requestIdFilter: { current?: string } = { current: daemonPayload.requestId };
      let streamStdout = '';
      let streamStderr = '';

      const streamController = new AbortController();
      let streamPromise: Promise<void> | undefined;
      let streamFinalized = false;
      const finalizeStream = async () => {
        if (streamFinalized) return;
        streamFinalized = true;
        streamController.abort();
        if (streamPromise) {
          await streamPromise;
        }
      };

      if ((options.onStdout || options.onStderr) && this.daemonStreamState?.rawSseUrl) {
        streamPromise = this.resolveDaemonSseUrl(
          this.daemonStreamState.rawSseUrl,
          this.daemonStreamState.token
        )
          .then((sseUrl) => streamDaemonEvents(
            sseUrl,
            { requestId: requestIdFilter },
            {
              onStdout: options.onStdout,
              onStderr: options.onStderr,
              markStdout: (chunk?: string) => {
                if (chunk) streamStdout += chunk;
              },
              markStderr: (chunk?: string) => {
                if (chunk) streamStderr += chunk;
              },
            },
            streamController.signal
          ))
          .then(() => undefined)
          .catch(() => undefined);
      }
      try {
        const daemonResult = await this.methods.runCommand(this.sandbox, daemonCommand, forwardedOptions);
        const invocation = parseDaemonSeedResult(daemonResult, 'daemon command');
        this.daemonStreamState = {
          token: invocation.token,
          rawSseUrl: invocation.daemon.sseUrl,
        };

        await finalizeStream();

        if (options.onStdout) {
          emitMissingOutput(streamStdout, invocation.command.stdout, options.onStdout);
        }
        if (options.onStderr) {
          emitMissingOutput(streamStderr, invocation.command.stderr, options.onStderr);
        }

        return {
          stdout: invocation.command.stdout,
          stderr: invocation.command.stderr,
          exitCode: invocation.command.exitCode ?? -1,
          durationMs: daemonResult.durationMs,
        };
      } finally {
        await finalizeStream();
      }
    }

    // Pass command and options directly to provider - no preprocessing
    // Provider is responsible for handling cwd, env, background, etc.
    return await this.methods.runCommand(this.sandbox, command, options);
  }

  /**
   * Boots (or reuses) the in-sandbox daemon so daemon jobs can be addressed.
   * `options` carries the caller's cwd/env/timeout for the bootstrap probe;
   * `forwardedOptions` is passed to the provider's own runCommand.
   */
  private async ensureDaemon(
    options: { cwd?: string; env?: Record<string, string>; timeout?: number },
    forwardedOptions: RunCommandOptions
  ): Promise<DaemonStreamState> {
    if (!this.daemonStreamState) {
      const bootstrapPayload: SeedCommandInput = {
        command: 'sh',
        args: ['-lc', 'true'],
        cwd: options.cwd,
        env: options.env,
        timeoutMs: options.timeout,
        requestId: createDaemonRequestId(),
      };
      const bootstrapCommand = daemonSeedScriptCommand(
        { ssePort: DEFAULT_DAEMON_SSE_PORT },
        bootstrapPayload
      );
      const bootstrapResult = await this.methods.runCommand(this.sandbox, bootstrapCommand, forwardedOptions);
      const bootstrapInvocation = parseDaemonSeedResult(bootstrapResult, 'daemon bootstrap');
      this.daemonStreamState = {
        token: bootstrapInvocation.token,
        rawSseUrl: bootstrapInvocation.daemon.sseUrl,
      };
    }
    return this.daemonStreamState;
  }

  /**
   * Runs a single daemon job-control request (exec/stdin/closeStdin/status/
   * wait/kill) through the provider's runCommand and parses the result.
   */
  private async daemonJobRequest(
    payload: SeedInput,
    phase: string,
    opts?: {
      argvEncoding?: 'quoted' | 'base64';
      timeout?: number;
      cwd?: string;
      env?: Record<string, string>;
    }
  ): Promise<{ invocation: SeedInvocationResult; result: CommandResult }> {
    const command = daemonSeedScriptCommand(
      { ssePort: DEFAULT_DAEMON_SSE_PORT },
      payload,
      opts?.argvEncoding ? { argvEncoding: opts.argvEncoding } : undefined
    );
    const runOptions: RunCommandOptions = {};
    if (opts?.cwd) runOptions.cwd = opts.cwd;
    if (opts?.env) runOptions.env = opts.env;
    if (opts?.timeout) runOptions.timeout = opts.timeout;
    const result = await this.methods.runCommand(this.sandbox, command, runOptions);
    const invocation = parseDaemonSeedResult(result, phase);
    this.daemonStreamState = {
      token: invocation.token,
      rawSseUrl: invocation.daemon.sseUrl,
    };
    return { invocation, result };
  }

  async startProcess(
    command: string,
    options: StartProcessOptions = {}
  ): Promise<ProcessHandle> {
    const forwardedOptions: RunCommandOptions = {};
    if (options.cwd) forwardedOptions.cwd = options.cwd;
    if (options.env) forwardedOptions.env = options.env;

    await this.ensureDaemon(options, forwardedOptions);

    const { invocation } = await this.daemonJobRequest(
      {
        command: 'sh',
        args: ['-lc', command],
        cwd: options.cwd,
        env: options.env,
        detach: true,
        stdin: options.stdin === true,
        requestId: createDaemonRequestId(),
      } satisfies SeedCommandInput,
      'daemon start',
      { cwd: options.cwd, env: options.env }
    );

    const jobId = invocation.command.jobId;
    if (!jobId) {
      throw new Error('daemond: process did not start');
    }
    const pid = invocation.command.pid ?? null;

    let exitFired = false;
    const fireExit = (exitCode: number | null, signal: string | null): void => {
      if (exitFired) return;
      exitFired = true;
      options.onExit?.({ exitCode, signal });
    };

    const toStatus = (snapshot: typeof invocation.command): ProcessStatus => ({
      status: snapshot.status === 'exited' ? 'exited' : 'running',
      exitCode: snapshot.exitCode ?? null,
      signal: snapshot.signal ?? null,
      stdout: snapshot.stdout ?? '',
      stderr: snapshot.stderr ?? '',
      truncated: snapshot.truncated,
    });

    const getStatus = async (): Promise<ProcessStatus> => {
      const { invocation: statusInvocation } = await this.daemonJobRequest(
        { status: jobId },
        'process status',
        { cwd: options.cwd, env: options.env }
      );
      return toStatus(statusInvocation.command);
    };

    if (options.onStdout || options.onStderr || options.onExit) {
      this.watchProcessOutput(jobId, options, getStatus, fireExit);
    }

    const self = this;
    return {
      pid,
      jobId,
      async write(data: string | Uint8Array): Promise<void> {
        const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
        await self.daemonJobRequest(
          { stdin: jobId, data: bytes.toString('base64'), encoding: 'base64' },
          'stdin write',
          { argvEncoding: 'base64', cwd: options.cwd, env: options.env }
        );
      },
      async closeStdin(): Promise<void> {
        await self.daemonJobRequest(
          { closeStdin: jobId },
          'stdin close',
          { cwd: options.cwd, env: options.env }
        );
      },
      status: getStatus,
      async wait(waitOptions?: { timeout?: number }): Promise<CommandResult & { signal: string | null }> {
        const startedAt = Date.now();
        const { invocation: waitInvocation } = await self.daemonJobRequest(
          { wait: jobId, timeoutMs: waitOptions?.timeout },
          'process wait',
          {
            cwd: options.cwd,
            env: options.env,
            timeout: waitOptions?.timeout ? waitOptions.timeout + 5000 : undefined,
          }
        );
        const snapshot = waitInvocation.command;
        if (snapshot.status === 'running') {
          throw new Error(`daemond: process ${jobId} did not exit within ${waitOptions?.timeout}ms`);
        }
        fireExit(snapshot.exitCode ?? null, snapshot.signal ?? null);
        return {
          stdout: snapshot.stdout ?? '',
          stderr: snapshot.stderr ?? '',
          exitCode: snapshot.exitCode ?? -1,
          durationMs: Date.now() - startedAt,
          signal: snapshot.signal ?? null,
        };
      },
      async kill(signal: string = 'SIGTERM'): Promise<void> {
        await self.daemonJobRequest(
          { kill: jobId, signal },
          'process kill',
          { cwd: options.cwd, env: options.env }
        );
      },
    };
  }

  /**
   * Delivers a started process's output to its callbacks: SSE from the daemon
   * when the port is routable, otherwise a status-polling diff loop. Fires
   * `onExit` exactly once via the shared `fireExit`.
   */
  private watchProcessOutput(
    jobId: string,
    options: StartProcessOptions,
    getStatus: () => Promise<ProcessStatus>,
    fireExit: (exitCode: number | null, signal: string | null) => void
  ): void {
    const streamController = new AbortController();

    const startPolling = (): void => {
      const seenStdout = { value: '' };
      const seenStderr = { value: '' };
      let failures = 0;
      const interval = setInterval(async () => {
        let status: ProcessStatus;
        try {
          status = await getStatus();
          failures = 0;
        } catch {
          // The daemon (or the job) may be gone; give up after a few misses.
          failures += 1;
          if (failures >= 3) clearInterval(interval);
          return;
        }
        emitProcessDiff(seenStdout, status.stdout, options.onStdout);
        emitProcessDiff(seenStderr, status.stderr, options.onStderr);
        if (status.status === 'exited') {
          clearInterval(interval);
          fireExit(status.exitCode, status.signal);
        }
      }, options.pollIntervalMs ?? 500);
      (interval as unknown as { unref?: () => void }).unref?.();
    };

    const state = this.daemonStreamState;
    const streamPromise = state?.rawSseUrl
      ? this.resolveDaemonSseUrl(state.rawSseUrl, state.token).then((sseUrl) =>
          streamDaemonEvents(
            sseUrl,
            { jobId },
            {
              onStdout: options.onStdout,
              onStderr: options.onStderr,
              onExit: (exitCode, signal) => {
                fireExit(exitCode, signal);
                streamController.abort();
              },
              markStdout: () => {},
              markStderr: () => {},
            },
            streamController.signal
          )
        )
      : Promise.reject(new Error('daemon stream unavailable'));

    streamPromise.then(() => undefined, () => startPolling());
  }

  async getInfo(): Promise<SandboxInfo> {
    return await this.methods.getInfo(this.sandbox);
  }

  async getUrl(options: { port: number; protocol?: string }): Promise<string> {
    return await this.methods.getUrl(this.sandbox, options);
  }

  getProvider(): Provider<TSandbox> {
    return this.providerInstance;
  }

  async destroy(): Promise<void> {
    // Destroy via the provider's destroy method using our sandboxId
    await this.destroyMethod(this.config, this.sandboxId);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw makeAbortError();
  }
}

function makeAbortError(): Error {
  const error = new Error('The operation was aborted.');
  (error as any).name = 'AbortError';
  return error;
}

function abortPromise(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal?.aborted) {
      reject(makeAbortError());
      return;
    }
    signal?.addEventListener('abort', () => reject(makeAbortError()), { once: true });
  });
}

/**
 * Auto-generated Sandbox Manager implementation
 */
class GeneratedSandboxManager<TSandbox, TConfig> implements ProviderSandboxManager<TSandbox> {
  constructor(
    private config: TConfig,
    private providerName: string,
    private methods: SandboxMethods<TSandbox, TConfig>,
    private providerInstance: Provider
  ) {}

  async create(options?: CreateSandboxOptions): Promise<ProviderSandbox<TSandbox>> {
    throwIfAborted(options?.signal);

    const signal = options?.signal;
    const createPromise = this.methods.create(this.config, options);

    // If the provider promise resolves after abort, clean up the orphaned sandbox
    createPromise.then(
      (result) => {
        if (signal?.aborted) {
          this.methods.destroy(this.config, result.sandboxId).catch(() => {});
        }
      },
      () => {}
    );

    const result = await Promise.race([createPromise, abortPromise(signal)]);

    if (signal?.aborted) {
      throw makeAbortError();
    }

    return new GeneratedSandbox<TSandbox>(
      result.sandbox,
      result.sandboxId,
      this.providerName,
      this.methods,
      this.config,
      this.methods.destroy,
      this.providerInstance
    );
  }

  async getById(sandboxId: string): Promise<ProviderSandbox<TSandbox> | null> {
    const result = await this.methods.getById(this.config, sandboxId);
    if (!result) {
      return null;
    }

    return new GeneratedSandbox<TSandbox>(
      result.sandbox,
      result.sandboxId,
      this.providerName,
      this.methods,
      this.config,
      this.methods.destroy,
      this.providerInstance
    );
  }

  async list(): Promise<ProviderSandbox<TSandbox>[]> {
    const results = await this.methods.list(this.config);
    
    return results.map(result => new GeneratedSandbox<TSandbox>(
      result.sandbox,
      result.sandboxId,
      this.providerName,
      this.methods,
      this.config,
      this.methods.destroy,
      this.providerInstance
    ));
  }

  async destroy(sandboxId: string): Promise<void> {
    await this.methods.destroy(this.config, sandboxId);
  }
}

/**
 * Auto-generated Template Manager implementation
 */
class GeneratedTemplateManager<TTemplate, TConfig, TCreateOptions extends CreateTemplateOptions = CreateTemplateOptions> implements ProviderTemplateManager<TTemplate, TCreateOptions> {
  constructor(
    private config: TConfig,
    private methods: TemplateMethods<TTemplate, TConfig, TCreateOptions>
  ) {}

  async create(options: TCreateOptions): Promise<TTemplate> {
    return await this.methods.create(this.config, options);
  }

  async list(options?: ListTemplatesOptions): Promise<TTemplate[]> {
    return await this.methods.list(this.config, options);
  }

  async delete(templateId: string): Promise<void> {
    return await this.methods.delete(this.config, templateId);
  }
}

/**
 * Auto-generated Snapshot Manager implementation
 */
class GeneratedSnapshotManager<TSnapshot, TConfig> implements ProviderSnapshotManager<TSnapshot> {
  constructor(
    private config: TConfig,
    private methods: SnapshotMethods<TSnapshot, TConfig>
  ) {}

  async create(sandboxId: string, options?: CreateSnapshotOptions): Promise<TSnapshot> {
    return await this.methods.create(this.config, sandboxId, options);
  }

  async list(options?: ListSnapshotsOptions): Promise<TSnapshot[]> {
    return await this.methods.list(this.config, options);
  }

  async delete(snapshotId: string): Promise<void> {
    return await this.methods.delete(this.config, snapshotId);
  }
}

/**
 * Auto-generated Provider implementation
 */
class GeneratedProvider<TSandbox, TConfig, TTemplate, TSnapshot> implements Provider<TSandbox, TTemplate, TSnapshot> {
  readonly name: string;
  readonly sandbox: ProviderSandboxManager<TSandbox>;
  readonly template?: ProviderTemplateManager<TTemplate>;
  readonly snapshot?: ProviderSnapshotManager<TSnapshot>;

  constructor(config: TConfig, providerConfig: ProviderConfig<TSandbox, TConfig, TTemplate, TSnapshot>) {
    this.name = providerConfig.name;
    this.sandbox = new GeneratedSandboxManager(
      config,
      providerConfig.name,
      providerConfig.methods.sandbox,
      this
    );

    // Initialize optional managers if methods are provided
    if (providerConfig.methods.template) {
      this.template = new GeneratedTemplateManager(config, providerConfig.methods.template);
    }
    
    if (providerConfig.methods.snapshot) {
      this.snapshot = new GeneratedSnapshotManager(config, providerConfig.methods.snapshot);
    }
  }
}

/**
 * Create a provider from method definitions
 *
 * Auto-generates all boilerplate classes and provides feature detection
 * based on which methods are implemented.
 */
export function defineProvider<TSandbox, TConfig = any, TTemplate = any, TSnapshot = any>(
  providerConfig: ProviderConfig<TSandbox, TConfig, TTemplate, TSnapshot>
): (config: TConfig) => Provider<TSandbox, TTemplate, TSnapshot> {
  return (config: TConfig) => {
    return new GeneratedProvider(config, providerConfig);
  };
}
