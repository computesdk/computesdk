/**
 * Secure Exec Provider - V8 Isolate-based JavaScript Execution
 *
 * Runs JavaScript in a secure V8 isolate sandbox using secure-exec.
 * Unlike other providers that execute raw shell commands, this provider
 * evaluates JavaScript code and returns structured JSON results.
 *
 * Key behavior:
 * - `runCode(code)` executes JS and returns combined stdout/stderr output
 * - `runCommand(command)` evaluates the command string as JS, serializes
 *   the return value to JSON, and returns it in stdout
 * - The sandbox is a V8 isolate with full Node.js API compatibility
 *   (fs, path, crypto, http, etc.) but no actual OS access
 */

import {
  NodeRuntime,
  createNodeDriver,
  createNodeRuntimeDriverFactory,
  createNodeV8Runtime,
  allowAll,
  createInMemoryFileSystem,
} from 'secure-exec';
import type { ExecResult, RunResult, StdioEvent, NodeRuntimeDriverFactory, SystemDriver } from 'secure-exec';
import { defineProvider } from '@computesdk/provider';
import type {
  CodeResult,
  CommandResult,
  SandboxInfo,
  Runtime,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
} from '@computesdk/provider';

/**
 * Secure-exec-specific configuration options
 */
export interface SecureExecConfig {
  /** Memory limit in bytes for the V8 isolate (default: 128MB) */
  memoryLimit?: number;
  /** CPU time limit in ms per execution (default: 30000) */
  cpuTimeLimitMs?: number;
  /** Initial environment variables available inside the isolate */
  env?: Record<string, string>;
  /** Working directory inside the sandbox (default: /home/user) */
  cwd?: string;
  /** Permissions configuration. Defaults to allowAll for ease of use. */
  permissions?: Parameters<typeof createNodeDriver>[0] extends { permissions?: infer P } ? P : never;
}

/** Internal sandbox state */
interface SecureExecSandbox {
  runtime: NodeRuntime;
  id: string;
  createdAt: Date;
  config: SecureExecConfig;
}

/** Active sandboxes registry */
const activeSandboxes = new Map<string, SecureExecSandbox>();

/**
 * Singleton runtime infrastructure. The V8 runtime, system driver, and
 * runtime driver factory are expensive to create — initialize them once
 * and share across all sandboxes. The promise is created lazily on first
 * sandbox create and never re-created.
 */
interface SharedRuntime {
  systemDriver: SystemDriver;
  runtimeDriverFactory: NodeRuntimeDriverFactory;
}

let sharedRuntimePromise: Promise<SharedRuntime> | null = null;

async function initSharedRuntime(config: SecureExecConfig): Promise<SharedRuntime> {
  const systemDriver = createNodeDriver({
    filesystem: createInMemoryFileSystem(),
    permissions: config.permissions ?? allowAll,
  });
  const v8Runtime = await createNodeV8Runtime();
  const runtimeDriverFactory = createNodeRuntimeDriverFactory({ v8Runtime });
  return { systemDriver, runtimeDriverFactory };
}

function getSharedRuntime(config: SecureExecConfig): Promise<SharedRuntime> {
  if (!sharedRuntimePromise) {
    sharedRuntimePromise = initSharedRuntime(config);
  }
  return sharedRuntimePromise;
}

function createStdioCollector() {
  let stdout = '';
  let stderr = '';
  const hook = (event: StdioEvent) => {
    if (event.channel === 'stdout') stdout += event.message;
    else stderr += event.message;
  };
  return { hook, getStdout: () => stdout, getStderr: () => stderr };
}

const _provider = defineProvider<SecureExecSandbox, SecureExecConfig>({
  name: 'secure-exec',
  methods: {
    sandbox: {
      create: async (config: SecureExecConfig, options?: CreateSandboxOptions) => {
        const sandboxId =
          options?.sandboxId ||
          `secure-exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        if (options?.sandboxId && activeSandboxes.has(options.sandboxId)) {
          const existing = activeSandboxes.get(options.sandboxId)!;
          return { sandbox: existing, sandboxId: existing.id };
        }

        const { systemDriver, runtimeDriverFactory } = await getSharedRuntime(config);

        const runtime = new NodeRuntime({
          systemDriver,
          runtimeDriverFactory,
          memoryLimit: config.memoryLimit ?? 128 * 1024 * 1024,
          cpuTimeLimitMs: config.cpuTimeLimitMs ?? 30000,
        });

        const sandbox: SecureExecSandbox = {
          runtime,
          id: sandboxId,
          createdAt: new Date(),
          config,
        };

        activeSandboxes.set(sandboxId, sandbox);
        return { sandbox, sandboxId };
      },

      getById: async (_config: SecureExecConfig, sandboxId: string) => {
        const sandbox = activeSandboxes.get(sandboxId);
        if (!sandbox) return null;
        return { sandbox, sandboxId };
      },

      list: async (_config: SecureExecConfig) => {
        return Array.from(activeSandboxes.entries()).map(([sandboxId, sandbox]) => ({
          sandbox,
          sandboxId,
        }));
      },

      destroy: async (_config: SecureExecConfig, sandboxId: string) => {
        const sandbox = activeSandboxes.get(sandboxId);
        if (sandbox) {
          sandbox.runtime.dispose();
          activeSandboxes.delete(sandboxId);
        }
      },

      runCode: async (
        sandbox: SecureExecSandbox,
        code: string,
        _runtime?: Runtime
      ): Promise<CodeResult> => {
        const collector = createStdioCollector();
        try {
          const result: ExecResult = await sandbox.runtime.exec(code, {
            env: sandbox.config.env,
            cwd: sandbox.config.cwd ?? '/home/user',
            onStdio: collector.hook,
          });
          const stdout = collector.getStdout();
          const stderr = collector.getStderr();
          const output = stderr
            ? `${stdout}${stdout && stderr ? '\n' : ''}${stderr}`
            : stdout;
          return { output, exitCode: result.code, language: 'javascript' };
        } catch (error) {
          const stdout = collector.getStdout();
          const stderr = collector.getStderr();
          const errMsg = error instanceof Error ? error.message : String(error);
          const output = stderr
            ? `${stdout}${stdout && stderr ? '\n' : ''}${stderr}\n${errMsg}`
            : `${stdout}${stdout ? '\n' : ''}${errMsg}`;
          return { output, exitCode: 1, language: 'javascript' };
        }
      },

      runCommand: async (
        sandbox: SecureExecSandbox,
        command: string,
        _options?: RunCommandOptions
      ): Promise<CommandResult> => {
        const startTime = Date.now();
        try {
          const result: RunResult = await sandbox.runtime.run(command);
          let jsonResult: string;
          try {
            jsonResult = JSON.stringify(result.exports);
          } catch {
            jsonResult = String(result.exports);
          }
          return {
            stdout: jsonResult,
            stderr: '',
            exitCode: result.code,
            durationMs: Date.now() - startTime,
          };
        } catch (error) {
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 1,
            durationMs: Date.now() - startTime,
          };
        }
      },

      getInfo: async (sandbox: SecureExecSandbox): Promise<SandboxInfo> => {
        return {
          id: sandbox.id,
          provider: 'secure-exec',
          runtime: 'node',
          status: 'running',
          createdAt: sandbox.createdAt,
          timeout: sandbox.config.cpuTimeLimitMs ?? 30000,
          metadata: {
            type: 'v8-isolate',
            memoryLimit: sandbox.config.memoryLimit ?? 128 * 1024 * 1024,
          },
        };
      },

      getUrl: async (
        _sandbox: SecureExecSandbox,
        options: { port: number; protocol?: string }
      ): Promise<string> => {
        throw new Error(
          `secure-exec is a V8 isolate sandbox without network listeners. Cannot expose port ${options.port}.`
        );
      },

      filesystem: {
        readFile: async (sandbox: SecureExecSandbox, path: string): Promise<string> => {
          const result = await sandbox.runtime.run(
            `require('fs').readFileSync(${JSON.stringify(path)}, 'utf8')`
          );
          return String(result.exports ?? '');
        },
        writeFile: async (sandbox: SecureExecSandbox, path: string, content: string): Promise<void> => {
          await sandbox.runtime.run(
            `require('fs').mkdirSync(require('path').dirname(${JSON.stringify(path)}), { recursive: true }); ` +
            `require('fs').writeFileSync(${JSON.stringify(path)}, ${JSON.stringify(content)})`
          );
        },
        mkdir: async (sandbox: SecureExecSandbox, path: string): Promise<void> => {
          await sandbox.runtime.run(
            `require('fs').mkdirSync(${JSON.stringify(path)}, { recursive: true })`
          );
        },
        readdir: async (sandbox: SecureExecSandbox, path: string): Promise<FileEntry[]> => {
          const result = await sandbox.runtime.run(
            `require('fs').readdirSync(${JSON.stringify(path)}, { withFileTypes: true })` +
            `.map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file' }))`
          );
          return (result.exports as FileEntry[]) ?? [];
        },
        exists: async (sandbox: SecureExecSandbox, path: string): Promise<boolean> => {
          const result = await sandbox.runtime.run(
            `require('fs').existsSync(${JSON.stringify(path)})`
          );
          return result.exports === true;
        },
        remove: async (sandbox: SecureExecSandbox, path: string): Promise<void> => {
          await sandbox.runtime.run(
            `require('fs').rmSync(${JSON.stringify(path)}, { recursive: true, force: true })`
          );
        },
      },

      getInstance: (sandbox: SecureExecSandbox): SecureExecSandbox => {
        return sandbox;
      },
    },
  },
});

export const secureExec = (config: SecureExecConfig = {}) => _provider(config);

export type { SecureExecSandbox };
