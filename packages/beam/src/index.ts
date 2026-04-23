/**
 * Beam Provider - Factory-based Implementation
 *
 * Containerized sandbox environments using the Beam platform.
 * Beam provides sandboxes with process management, filesystem access,
 * and port exposure capabilities.
 *
 * Features:
 * - Process execution via sandbox.exec()
 * - Code execution in Python, JavaScript
 * - Shell command execution
 * - Filesystem operations (shell-based + native listFiles)
 * - Dynamic port exposure for accessing sandbox services
 */

import { Sandbox, SandboxInstance, beamOpts, Image } from '@beamcloud/beam-js';
import { defineProvider, escapeShellArg } from '@computesdk/provider';
import type {
  CodeResult,
  CommandResult,
  SandboxInfo,
  Runtime,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
} from 'computesdk';

/** Type alias for the runCommand function passed to filesystem methods */
type RunCommandFn = (sandbox: SandboxInstance, command: string, options?: RunCommandOptions) => Promise<CommandResult>;

/**
 * Beam-specific configuration options
 */
export interface BeamConfig {
  /** Beam API token - if not provided, will fallback to BEAM_TOKEN environment variable */
  token?: string;
  /** Beam workspace ID - if not provided, will fallback to BEAM_WORKSPACE_ID environment variable */
  workspaceId?: string;
  /** Gateway URL for custom/staging environments */
  gatewayUrl?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
}

/**
 * Configure the global beamOpts singleton before each SDK call.
 * Beam uses a global config pattern rather than per-call config.
 */
function configureBeamOpts(config: BeamConfig): void {
  beamOpts.token = config.token || (typeof process !== 'undefined' && process.env?.BEAM_TOKEN) || '';
  beamOpts.workspaceId = config.workspaceId || (typeof process !== 'undefined' && process.env?.BEAM_WORKSPACE_ID) || '';
  if (config.gatewayUrl) {
    beamOpts.gatewayUrl = config.gatewayUrl;
  }
  if (config.timeout) {
    (beamOpts as any).timeout = config.timeout;
  }
}

/**
 * Shell-escape a string using single quotes (POSIX).
 */
function shellEscape(arg: string): string {
  if (arg === '') return "''";
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Detect Node parser/compile failures while avoiding runtime SyntaxError matches.
 */
function isNodeParserFailure(output: string): boolean {
  const hasSyntaxMarker =
    output.includes('SyntaxError') ||
    output.includes('Unexpected token') ||
    output.includes('Unexpected identifier') ||
    output.includes('Unexpected end of input') ||
    output.includes('Invalid or unexpected token');

  const hasCompileContext =
    output.includes('[eval]') ||
    output.includes('makeContextifyScript') ||
    output.includes('compileScript') ||
    output.includes('wrapSafe');

  const hasRuntimeSyntaxSignature =
    output.includes('at JSON.parse') ||
    output.includes('JSON.parse (<anonymous>)') ||
    output.includes('in JSON at position');

  return hasSyntaxMarker && hasCompileContext && !hasRuntimeSyntaxSignature;
}

/**
 * Detect Python parser failures (syntax/indentation/tab) emitted by python -c.
 */
function isPythonParserFailure(output: string): boolean {
  const hasSyntaxMarker =
    output.includes('SyntaxError') ||
    output.includes('IndentationError') ||
    output.includes('TabError');

  const hasStringFileContext = output.includes('File "<string>"');
  const hasRuntimeTraceback = output.includes('Traceback (most recent call last)');

  return hasSyntaxMarker && hasStringFileContext && !hasRuntimeTraceback;
}

/**
 * Detect parser/compile failures that should throw instead of returning CodeResult.
 */
function isParserFailure(output: string, runtime: Runtime): boolean {
  if (!output.trim()) return false;

  if (runtime === 'node') {
    return isNodeParserFailure(output);
  }

  if (runtime === 'python') {
    return isPythonParserFailure(output);
  }

  return false;
}

/**
 * Create a Beam provider instance using the factory pattern
 *
 * Beam provides containerized sandbox environments with:
 * - Process management (exec, runCode)
 * - Filesystem access
 * - Dynamic port exposure
 * - Snapshot and image creation capabilities
 */
export const beam = defineProvider<SandboxInstance, BeamConfig>({
  name: 'beam',
  methods: {
    sandbox: {
      /**
       * Create a new Beam sandbox
       *
       * Uses Sandbox class from @beamcloud/beam-js to provision a container.
       */
      create: async (config: BeamConfig, options?: CreateSandboxOptions) => {
        configureBeamOpts(config);

        if (!beamOpts.token) {
          throw new Error(
            `Missing Beam token. Provide 'token' in config or set BEAM_TOKEN environment variable. Get your token from https://app.beam.cloud`
          );
        }

        if (!beamOpts.workspaceId) {
          throw new Error(
            `Missing Beam workspace ID. Provide 'workspaceId' in config or set BEAM_WORKSPACE_ID environment variable.`
          );
        }

        try {
          // Destructure known ComputeSDK fields, collect the rest for passthrough
          const {
            runtime: optRuntime,
            timeout: optTimeout,
            envs,
            name,
            metadata: _metadata,
            templateId: _templateId,
            snapshotId: _snapshotId,
            sandboxId: _sandboxId,
            namespace: _namespace,
            directory: _directory,
            overlays: _overlays,
            servers: _servers,
            ...providerOptions
          } = options || {};

          const sandboxConfig: any = {
            name: name || `computesdk-${Date.now()}`,
            keepWarmSeconds: 300,
            ...providerOptions, // Spread provider-specific options
          };

          // options.timeout takes precedence over config.timeout
          const timeout = optTimeout ?? config.timeout;
          if (timeout) {
            sandboxConfig.keepWarmSeconds = Math.ceil(timeout / 1000);
          }

          if (optRuntime === 'node') {
            sandboxConfig.image = Image.fromRegistry('node:20-slim');
          }

          if (envs) {
            sandboxConfig.envVars = Object.entries(envs).map(([name, value]) => `${name}=${value}`);
          }

          const sandbox = new Sandbox(sandboxConfig);
          const instance = await sandbox.create();
          return { sandbox: instance, sandboxId: instance.containerId };
        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('unauthorized') || error.message.includes('401')) {
              throw new Error(
                `Beam authentication failed. Please check your BEAM_TOKEN environment variable. Get your token from https://app.beam.cloud`
              );
            }
          }
          throw new Error(
            `Failed to create Beam sandbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      /**
       * Connect to an existing Beam sandbox by ID
       *
       * Uses Sandbox.connect() to reconnect to a running sandbox.
       */
      getById: async (config: BeamConfig, sandboxId: string) => {
        configureBeamOpts(config);

        if (!beamOpts.token) {
          return null;
        }

        try {
          const instance = await Sandbox.connect(sandboxId);
          return { sandbox: instance, sandboxId: instance.containerId };
        } catch {
          return null;
        }
      },

      /**
       * List all active Beam sandboxes
       *
       * Beam SDK has no sandbox list API; returns empty array.
       */
      list: async (_config: BeamConfig) => {
        return [];
      },

      /**
       * Destroy a Beam sandbox
       *
       * Connects to the sandbox and terminates it.
       */
      destroy: async (config: BeamConfig, sandboxId: string) => {
        configureBeamOpts(config);

        if (!beamOpts.token) {
          return;
        }

        try {
          const instance = await Sandbox.connect(sandboxId);
          await instance.terminate();
        } catch {
          // Sandbox might already be destroyed
        }
      },

      /**
       * Execute code in the sandbox
       *
       * Auto-detects runtime (Python vs Node.js) and executes via sandbox.exec().
       */

      /**
       * Execute a shell command in the sandbox
       *
       * Uses sandbox.exec() with shell command string.
       */
      runCommand: async (sandbox: SandboxInstance, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();
        try {
          let fullCommand = command;

          if (options?.env && Object.keys(options.env).length > 0) {
            const envPrefix = Object.entries(options.env)
              .map(([k, v]) => `${k}="${escapeShellArg(String(v))}"`)
              .join(' ');
            fullCommand = `${envPrefix} ${fullCommand}`;
          }

          if (options?.cwd) {
            fullCommand = `cd "${escapeShellArg(options.cwd)}" && ${fullCommand}`;
          }

          if (options?.background) {
            fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
          }

          // Wrap in sh -c to get shell parsing (pipes, redirects, etc.)
          const proc = await sandbox.exec(['sh', '-c', fullCommand]);
          await proc.wait();
          const [stdoutStr, stderrStr] = await Promise.all([
            proc.stdout.read(),
            proc.stderr.read(),
          ]);

          return {
            stdout: stdoutStr || '',
            stderr: stderrStr || '',
            exitCode: proc.exitCode || 0,
            durationMs: Date.now() - startTime,
          };
        } catch (error) {
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 127,
            durationMs: Date.now() - startTime,
          };
        }
      },

      /**
       * Get sandbox information
       */
      getInfo: async (sandbox: SandboxInstance): Promise<SandboxInfo> => {
        // Derive runtime from sandbox instance if available; otherwise default to 'python'
        let runtime: Runtime = 'python';
        const runtimeHint = sandbox as SandboxInstance & {
          runtime?: unknown;
          image?: unknown;
          imageName?: unknown;
        };

        if (typeof runtimeHint.runtime === 'string') {
          const lower = runtimeHint.runtime.toLowerCase();
          if (lower.includes('node')) {
            runtime = 'node';
          } else if (lower.includes('python')) {
            runtime = 'python';
          }
        } else if (typeof runtimeHint.image === 'string') {
          const imageStr = runtimeHint.image.toLowerCase();
          if (imageStr.includes('node')) {
            runtime = 'node';
          } else if (imageStr.includes('python')) {
            runtime = 'python';
          }
        } else if (typeof runtimeHint.imageName === 'string') {
          const imageNameStr = runtimeHint.imageName.toLowerCase();
          if (imageNameStr.includes('node')) {
            runtime = 'node';
          } else if (imageNameStr.includes('python')) {
            runtime = 'python';
          }
        }

        return {
          id: sandbox.containerId,
          provider: 'beam',
          runtime,
          status: 'running',
          createdAt: new Date(),
          timeout: 300000,
          metadata: {
            containerId: sandbox.containerId,
          },
        };
      },

      /**
       * Get public URL for a specific port
       *
       * Uses sandbox.exposePort() to dynamically expose a port.
       */
      getUrl: async (sandbox: SandboxInstance, options: { port: number; protocol?: string }): Promise<string> => {
        try {
          return await sandbox.exposePort(options.port);
        } catch (error) {
          throw new Error(
            `Failed to get Beam URL for port ${options.port}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      /**
       * Filesystem operations
       *
       * Most operations use shell commands via runCommand since Beam's file API
       * is local-path oriented (uploadFile/downloadFile require local filesystem paths).
       * readdir uses the native listFiles API since it returns structured data.
       */
      filesystem: {
        readFile: async (sandbox: SandboxInstance, path: string, runCommand: RunCommandFn): Promise<string> => {
          const result = await runCommand(sandbox, `cat ${shellEscape(path)}`);
          if (result.exitCode !== 0) {
            throw new Error(`Failed to read file ${path}: ${result.stderr}`);
          }
          return result.stdout;
        },

        writeFile: async (sandbox: SandboxInstance, path: string, content: string, runCommand: RunCommandFn): Promise<void> => {
          const b64 = Buffer.from(content).toString('base64');
          const result = await runCommand(sandbox, `echo '${b64}' | base64 -d > ${shellEscape(path)}`);
          if (result.exitCode !== 0) {
            throw new Error(`Failed to write file ${path}: ${result.stderr}`);
          }
        },

        mkdir: async (sandbox: SandboxInstance, path: string, runCommand: RunCommandFn): Promise<void> => {
          const result = await runCommand(sandbox, `mkdir -p ${shellEscape(path)}`);
          if (result.exitCode !== 0) {
            throw new Error(`Failed to create directory ${path}: ${result.stderr}`);
          }
        },

        readdir: async (sandbox: SandboxInstance, path: string, _runCommand: RunCommandFn): Promise<FileEntry[]> => {
          const files = await sandbox.fs.listFiles(path);
          return files.map((file: any) => ({
            name: file.name,
            type: file.isDir ? 'directory' as const : 'file' as const,
            size: Number(file.size) || 0,
            modified: file.modTime ? new Date(file.modTime * 1000) : new Date(),
          }));
        },

        exists: async (sandbox: SandboxInstance, path: string, runCommand: RunCommandFn): Promise<boolean> => {
          const result = await runCommand(sandbox, `test -f ${shellEscape(path)} || test -d ${shellEscape(path)}`);
          return result.exitCode === 0;
        },

        remove: async (sandbox: SandboxInstance, path: string, runCommand: RunCommandFn): Promise<void> => {
          const result = await runCommand(sandbox, `rm -rf ${shellEscape(path)}`);
          if (result.exitCode !== 0) {
            throw new Error(`Failed to remove ${path}: ${result.stderr}`);
          }
        },
      },

      /**
       * Get the native SandboxInstance for advanced usage
       */
      getInstance: (sandbox: SandboxInstance): SandboxInstance => {
        return sandbox;
      },
    },
  },
});

// Export Beam sandbox type for explicit typing
export type { SandboxInstance as BeamSandboxInstance } from '@beamcloud/beam-js';
