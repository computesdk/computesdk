/**
 * just-bash Provider - Factory-based Implementation
 *
 * Local sandboxed bash execution using the just-bash package.
 */

import { Bash } from 'just-bash';
import type { BashOptions } from 'just-bash';
import { nanoid } from 'nanoid';
import { defineProvider } from '@computesdk/provider';
import type {
  CommandResult,
  SandboxInfo,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
} from 'computesdk';

export interface JustBashConfig {
  python?: boolean;
  files?: BashOptions['files'];
  env?: Record<string, string>;
  cwd?: string;
  fs?: BashOptions['fs'];
  customCommands?: BashOptions['customCommands'];
  network?: BashOptions['network'];
}

interface JustBashSandbox {
  bash: Bash;
  id: string;
  createdAt: Date;
  config: JustBashConfig;
}

const activeSandboxes = new Map<string, JustBashSandbox>();

const _provider = defineProvider<JustBashSandbox, JustBashConfig>({
  name: 'just-bash',
  methods: {
    sandbox: {
      create: async (config: JustBashConfig, options?: CreateSandboxOptions) => {
        const sandboxId = `just-bash-${nanoid(10)}`;
        const usePython = config.python ?? ((options as any)?.runtime === 'python');
        const bash = new Bash({
          files: config.files,
          env: { ...config.env, ...options?.envs },
          cwd: config.cwd || '/home/user',
          python: usePython,
          fs: config.fs,
          customCommands: config.customCommands,
          network: config.network,
        });
        const sandbox: JustBashSandbox = { bash, id: sandboxId, createdAt: new Date(), config: { ...config, python: usePython } };
        activeSandboxes.set(sandboxId, sandbox);
        return { sandbox, sandboxId };
      },

      getById: async (_config: JustBashConfig, sandboxId: string) => {
        const sandbox = activeSandboxes.get(sandboxId);
        if (!sandbox) return null;
        return { sandbox, sandboxId };
      },

      list: async (_config: JustBashConfig) =>
        Array.from(activeSandboxes.entries()).map(([sandboxId, sandbox]) => ({ sandbox, sandboxId })),

      destroy: async (_config: JustBashConfig, sandboxId: string) => {
        activeSandboxes.delete(sandboxId);
      },

      runCommand: async (sandbox: JustBashSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();
        try {
          const execOptions: { env?: Record<string, string>; cwd?: string } = {};
          if (options?.env && Object.keys(options.env).length > 0) execOptions.env = options.env;
          if (options?.cwd) execOptions.cwd = options.cwd;
          const result = await sandbox.bash.exec(command, Object.keys(execOptions).length > 0 ? execOptions : undefined);
          return { stdout: result.stdout || '', stderr: result.stderr || '', exitCode: result.exitCode, durationMs: Date.now() - startTime };
        } catch (error) {
          return { stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 127, durationMs: Date.now() - startTime };
        }
      },

      getInfo: async (sandbox: JustBashSandbox): Promise<SandboxInfo> => ({
        id: sandbox.id,
        provider: 'just-bash',
        status: 'running',
        createdAt: sandbox.createdAt,
        timeout: 0,
        metadata: { type: 'local', cwd: sandbox.bash.getCwd(), python: sandbox.config.python },
      }),

      getUrl: async (_sandbox: JustBashSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        throw new Error(`just-bash is a local sandbox without network capabilities. Cannot expose port ${options.port}.`);
      },

      filesystem: {
        readFile: async (sandbox: JustBashSandbox, path: string, _runCommand): Promise<string> =>
          sandbox.bash.readFile(path),
        writeFile: async (sandbox: JustBashSandbox, path: string, content: string, _runCommand): Promise<void> => {
          const parentDir = path.substring(0, path.lastIndexOf('/')) || '/';
          if (parentDir !== '/') await sandbox.bash.exec(`mkdir -p ${parentDir}`);
          await sandbox.bash.writeFile(path, content);
        },
        mkdir: async (sandbox: JustBashSandbox, path: string, _runCommand): Promise<void> => {
          const result = await sandbox.bash.exec(`mkdir -p ${path}`);
          if (result.exitCode !== 0) throw new Error(`Failed to create directory ${path}: ${result.stderr}`);
        },
        readdir: async (sandbox: JustBashSandbox, path: string, _runCommand): Promise<FileEntry[]> => {
          const result = await sandbox.bash.exec(`ls -la ${path}`);
          if (result.exitCode !== 0) throw new Error(`Failed to list directory ${path}: ${result.stderr}`);
          const entries: FileEntry[] = [];
          for (const line of result.stdout.trim().split('\n')) {
            if (!line || line.startsWith('total')) continue;
            const parts = line.split(/\s+/);
            if (parts.length < 9) continue;
            const name = parts.slice(8).join(' ');
            if (name === '.' || name === '..') continue;
            entries.push({ name, type: parts[0].startsWith('d') ? 'directory' as const : 'file' as const, size: parseInt(parts[4], 10) || 0, modified: new Date() });
          }
          return entries;
        },
        exists: async (sandbox: JustBashSandbox, path: string, _runCommand): Promise<boolean> => {
          const result = await sandbox.bash.exec(`test -f ${path} || test -d ${path}`);
          return result.exitCode === 0;
        },
        remove: async (sandbox: JustBashSandbox, path: string, _runCommand): Promise<void> => {
          const result = await sandbox.bash.exec(`rm -rf ${path}`);
          if (result.exitCode !== 0) throw new Error(`Failed to remove ${path}: ${result.stderr}`);
        },
      },

      getInstance: (sandbox: JustBashSandbox): JustBashSandbox => sandbox,
    },
  },
});

export const justBash = (config: JustBashConfig = {}) => _provider(config);
export type { JustBashSandbox };
