/**
 * just-bash Provider - Factory-based Implementation
 *
 * Local sandboxed bash execution using the just-bash package.
 * Provides a virtual filesystem and bash shell environment
 * without requiring any external services or containers.
 *
 * Features:
 * - Pure TypeScript bash interpreter (no real processes)
 * - In-memory virtual filesystem
 * - Python support via pyodide (optional)
 * - Shell command execution with 60+ built-in commands
 * - No authentication required - runs entirely locally
 */

import { Bash } from 'just-bash';
import type { BashExecResult, BashOptions } from 'just-bash';
import { nanoid } from 'nanoid';
import { defineProvider } from '@computesdk/provider';
import type {
  CodeResult,
  CommandResult,
  SandboxInfo,
  Runtime,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
} from 'computesdk';

/**
 * just-bash-specific configuration options
 */
export interface JustBashConfig {
  /** Enable Python support via pyodide (disabled by default) */
  python?: boolean;
  /** Initial files to populate in the virtual filesystem */
  files?: BashOptions['files'];
  /** Initial environment variables */
  env?: Record<string, string>;
  /** Working directory (defaults to /home/user) */
  cwd?: string;
  /**
   * Custom filesystem implementation.
   * Defaults to InMemoryFs. Use OverlayFs for copy-on-write over a real directory,
   * ReadWriteFs for direct disk access, or MountableFs to combine multiple filesystems.
   */
  fs?: BashOptions['fs'];
  /**
   * Custom commands to register alongside built-in commands.
   * Created with `defineCommand()` from just-bash.
   */
  customCommands?: BashOptions['customCommands'];
  /** Network configuration for commands like curl */
  network?: BashOptions['network'];
}

/** Internal sandbox state */
interface JustBashSandbox {
  bash: Bash;
  id: string;
  createdAt: Date;
  config: JustBashConfig;
}

/** Active sandboxes registry */
const activeSandboxes = new Map<string, JustBashSandbox>();

/**
 * Create a just-bash provider instance using the factory pattern
 *
 * just-bash provides local sandboxed bash execution with:
 * - Virtual filesystem (in-memory)
 * - 60+ built-in commands (cat, grep, sed, awk, jq, etc.)
 * - Python support via pyodide
 * - No external dependencies or authentication required
 */
const _provider = defineProvider<JustBashSandbox, JustBashConfig>({
  name: 'just-bash',
  methods: {
    sandbox: {
      /**
       * Create a new just-bash sandbox
       */
      create: async (config: JustBashConfig, options?: CreateSandboxOptions) => {
        const sandboxId = `just-bash-${nanoid(10)}`;

        const bash = new Bash({
          files: config.files,
          env: {
            ...config.env,
            ...options?.envs,
          },
          cwd: config.cwd || '/home/user',
          python: config.python ?? (options?.runtime === 'python'),
          fs: config.fs,
          customCommands: config.customCommands,
          network: config.network,
        });

        const sandbox: JustBashSandbox = {
          bash,
          id: sandboxId,
          createdAt: new Date(),
          config,
        };

        activeSandboxes.set(sandboxId, sandbox);
        return { sandbox, sandboxId };
      },

      /**
       * Get an existing just-bash sandbox by ID
       */
      getById: async (_config: JustBashConfig, sandboxId: string) => {
        const sandbox = activeSandboxes.get(sandboxId);
        if (!sandbox) return null;
        return { sandbox, sandboxId };
      },

      /**
       * List all active just-bash sandboxes
       */
      list: async (_config: JustBashConfig) => {
        return Array.from(activeSandboxes.entries()).map(([sandboxId, sandbox]) => ({
          sandbox,
          sandboxId,
        }));
      },

      /**
       * Destroy a just-bash sandbox
       */
      destroy: async (_config: JustBashConfig, sandboxId: string) => {
        activeSandboxes.delete(sandboxId);
      },

      /**
       * Execute code in the sandbox
       *
       * For Python: executes via the built-in python3 command (pyodide)
       * For Node/JS: wraps code in a bash script that evaluates it
       */

      /**
       * Execute a shell command in the sandbox
       */
      runCommand: async (sandbox: JustBashSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();
        try {
          const execOptions: { env?: Record<string, string>; cwd?: string } = {};

          if (options?.env && Object.keys(options.env).length > 0) {
            execOptions.env = options.env;
          }

          if (options?.cwd) {
            execOptions.cwd = options.cwd;
          }

          const result = await sandbox.bash.exec(
            command,
            Object.keys(execOptions).length > 0 ? execOptions : undefined
          );

          return {
            stdout: result.stdout || '',
            stderr: result.stderr || '',
            exitCode: result.exitCode,
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
      getInfo: async (sandbox: JustBashSandbox): Promise<SandboxInfo> => {
        return {
          id: sandbox.id,
          provider: 'just-bash',
          runtime: sandbox.config.python ? 'python' : 'node',
          status: 'running',
          createdAt: sandbox.createdAt,
          timeout: 0, // No timeout - local execution
          metadata: {
            type: 'local',
            cwd: sandbox.bash.getCwd(),
          },
        };
      },

      /**
       * Get URL for a port - not supported for local execution
       */
      getUrl: async (_sandbox: JustBashSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        throw new Error(
          `just-bash is a local sandbox without network capabilities. Cannot expose port ${options.port}.`
        );
      },

      /**
       * Filesystem operations using the just-bash virtual filesystem
       */
      filesystem: {
        readFile: async (sandbox: JustBashSandbox, path: string, _runCommand): Promise<string> => {
          return sandbox.bash.readFile(path);
        },

        writeFile: async (sandbox: JustBashSandbox, path: string, content: string, _runCommand): Promise<void> => {
          // Ensure parent directory exists
          const parentDir = path.substring(0, path.lastIndexOf('/')) || '/';
          if (parentDir !== '/') {
            await sandbox.bash.exec(`mkdir -p ${parentDir}`);
          }
          await sandbox.bash.writeFile(path, content);
        },

        mkdir: async (sandbox: JustBashSandbox, path: string, _runCommand): Promise<void> => {
          const result = await sandbox.bash.exec(`mkdir -p ${path}`);
          if (result.exitCode !== 0) {
            throw new Error(`Failed to create directory ${path}: ${result.stderr}`);
          }
        },

        readdir: async (sandbox: JustBashSandbox, path: string, _runCommand): Promise<FileEntry[]> => {
          const result = await sandbox.bash.exec(`ls -la ${path}`);
          if (result.exitCode !== 0) {
            throw new Error(`Failed to list directory ${path}: ${result.stderr}`);
          }

          const entries: FileEntry[] = [];
          const lines = result.stdout.trim().split('\n');

          for (const line of lines) {
            // Skip total line and empty lines
            if (!line || line.startsWith('total')) continue;

            const parts = line.split(/\s+/);
            if (parts.length < 9) continue;

            const permissions = parts[0];
            const name = parts.slice(8).join(' ');

            // Skip . and ..
            if (name === '.' || name === '..') continue;

            entries.push({
              name,
              type: permissions.startsWith('d') ? 'directory' as const : 'file' as const,
              size: parseInt(parts[4], 10) || 0,
              modified: new Date(),
            });
          }

          return entries;
        },

        exists: async (sandbox: JustBashSandbox, path: string, _runCommand): Promise<boolean> => {
          const result = await sandbox.bash.exec(`test -f ${path} || test -d ${path}`);
          return result.exitCode === 0;
        },

        remove: async (sandbox: JustBashSandbox, path: string, _runCommand): Promise<void> => {
          const result = await sandbox.bash.exec(`rm -rf ${path}`);
          if (result.exitCode !== 0) {
            throw new Error(`Failed to remove ${path}: ${result.stderr}`);
          }
        },
      },

      /**
       * Get the native JustBashSandbox instance for advanced usage
       */
      getInstance: (sandbox: JustBashSandbox): JustBashSandbox => {
        return sandbox;
      },
    },
  },
});

export const justBash = (config: JustBashConfig = {}) => _provider(config);

// Export types
export type { JustBashSandbox };
