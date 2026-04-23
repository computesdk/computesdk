/**
 * Declaw Provider
 *
 * Wraps `@declaw/sdk` to expose the ComputeSDK provider interface.
 * Declaw runs Firecracker microVMs with a built-in security stack
 * (PII scanning, prompt-injection defense, TLS-intercepting egress
 * proxy, per-sandbox policies).
 */

import { Sandbox as DeclawSandbox } from '@declaw/sdk';
import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type {
  Runtime,
  CodeResult,
  CommandResult,
  SandboxInfo,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
} from '@computesdk/provider';

/**
 * Declaw-specific configuration options.
 */
export interface DeclawConfig {
  /** Declaw API key. Falls back to `DECLAW_API_KEY` env var. */
  apiKey?: string;
  /** API domain, e.g. `api.declaw.ai`. Falls back to `DECLAW_DOMAIN` env var. */
  domain?: string;
  /** Default runtime environment. */
  runtime?: Runtime;
  /** Default create-time timeout in milliseconds. */
  timeout?: number;
}

/**
 * Create a Declaw provider instance.
 *
 * @example
 * ```ts
 * import { declaw } from '@computesdk/declaw';
 * const compute = declaw({ apiKey: process.env.DECLAW_API_KEY });
 * const sandbox = await compute.sandbox.create();
 * await sandbox.runCommand('node -v');
 * await sandbox.destroy();
 * ```
 */
export const declaw = defineProvider<DeclawSandbox, DeclawConfig>({
  name: 'declaw',
  methods: {
    sandbox: {
      // Collection operations
      create: async (config: DeclawConfig, options?: CreateSandboxOptions) => {
        const apiKey =
          config.apiKey ||
          (typeof process !== 'undefined' && process.env?.DECLAW_API_KEY) ||
          '';
        if (!apiKey) {
          throw new Error(
            `Missing Declaw API key. Provide 'apiKey' in config or set DECLAW_API_KEY. Get a key at https://declaw.ai/`,
          );
        }
        if (!apiKey.startsWith('dcl_')) {
          throw new Error(
            `Invalid Declaw API key format. Keys should start with 'dcl_'.`,
          );
        }

        const domain =
          config.domain ||
          (typeof process !== 'undefined' && process.env?.DECLAW_DOMAIN) ||
          undefined;

        // Destructure known ComputeSDK fields so we can forward the rest as
        // Declaw-specific options (security policies, network policies, etc.)
        // without accidentally shadowing them.
        const {
          runtime: _runtime,
          timeout: requestedTimeoutMs,
          envs,
          name: _name,
          metadata,
          templateId,
          namespace: _namespace,
          directory: _directory,
          ...providerOptions
        } = options || {};

        // Declaw `timeout` is seconds; ComputeSDK passes ms.
        const ttMs = requestedTimeoutMs ?? config.timeout ?? 300_000;
        const timeoutSec = Math.max(1, Math.ceil(ttMs / 1000));

        // Declaw default template alias `base` carries a minimal Linux rootfs;
        // `node` includes Node.js 20 for ComputeSDK's `node -v` health check.
        // Callers can override via `templateId`.
        const template = templateId || 'node';

        try {
          const sandbox = await DeclawSandbox.create({
            template,
            timeout: timeoutSec,
            apiKey,
            domain,
            metadata,
            envs,
            ...providerOptions,
          });
          const sandboxId = (sandbox as any).sandboxId ?? (sandbox as any).sandbox_id;
          if (!sandboxId) {
            throw new Error('Declaw create() returned sandbox without an ID');
          }
          return { sandbox, sandboxId };
        } catch (error) {
          if (error instanceof Error) {
            const msg = error.message.toLowerCase();
            if (msg.includes('unauthorized') || msg.includes('api key') || msg.includes('401')) {
              throw new Error(
                `Declaw authentication failed. Check your DECLAW_API_KEY. Get a key at https://declaw.ai/`,
              );
            }
            if (msg.includes('402') || msg.includes('insufficient balance')) {
              throw new Error(
                `Declaw wallet balance is insufficient. Top up at https://declaw.ai/`,
              );
            }
            if (msg.includes('429') || msg.includes('concurrent') || msg.includes('rate limit')) {
              throw new Error(
                `Declaw concurrency/rate limit reached: ${error.message}`,
              );
            }
          }
          throw new Error(
            `Failed to create Declaw sandbox: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },

      getById: async (config: DeclawConfig, sandboxId: string) => {
        const apiKey = config.apiKey || process.env.DECLAW_API_KEY!;
        const domain = config.domain || process.env.DECLAW_DOMAIN;
        try {
          const sandbox = await DeclawSandbox.connect(sandboxId, { apiKey, domain });
          return { sandbox, sandboxId };
        } catch {
          return null;
        }
      },

      list: async (config: DeclawConfig) => {
        const apiKey = config.apiKey || process.env.DECLAW_API_KEY!;
        const domain = config.domain || process.env.DECLAW_DOMAIN;
        try {
          const result = await DeclawSandbox.list({ apiKey, domain });
          const infos = Array.isArray(result) ? result : result?.sandboxes ?? [];
          const out: Array<{ sandbox: DeclawSandbox; sandboxId: string }> = [];
          for (const info of infos) {
            const id = (info as any).sandboxId ?? (info as any).sandbox_id;
            if (!id) continue;
            try {
              const sandbox = await DeclawSandbox.connect(id, { apiKey, domain });
              out.push({ sandbox, sandboxId: id });
            } catch {
              // Skip rows that are already dead or no longer reachable.
            }
          }
          return out;
        } catch {
          return [];
        }
      },

      destroy: async (config: DeclawConfig, sandboxId: string) => {
        const apiKey = config.apiKey || process.env.DECLAW_API_KEY!;
        const domain = config.domain || process.env.DECLAW_DOMAIN;
        try {
          const sandbox = await DeclawSandbox.connect(sandboxId, { apiKey, domain });
          await sandbox.kill();
        } catch {
          // Idempotent: sandbox may already be gone.
        }
      },

      // Instance operations
      runCode: async (
        sandbox: DeclawSandbox,
        code: string,
        runtime?: Runtime,
      ): Promise<CodeResult> => {
        const effectiveRuntime: Runtime =
          runtime ||
          (code.includes('print(') ||
          code.includes('import ') ||
          code.includes('def ') ||
          code.includes('sys.') ||
          code.includes('json.')
            ? 'python'
            : 'node');

        const encoded = Buffer.from(code).toString('base64');
        const shell =
          effectiveRuntime === 'python'
            ? `echo "${encoded}" | base64 -d | python3`
            : `echo "${encoded}" | base64 -d | node`;

        try {
          const result = await sandbox.commands.run(shell);

          if (result.exitCode !== 0 && result.stderr) {
            if (
              result.stderr.includes('SyntaxError') ||
              result.stderr.includes('invalid syntax') ||
              result.stderr.includes('Unexpected token')
            ) {
              throw new Error(`Syntax error: ${result.stderr.trim()}`);
            }
          }
          const output = result.stderr
            ? `${result.stdout}${result.stdout && result.stderr ? '\n' : ''}${result.stderr}`
            : result.stdout;
          return { output, exitCode: result.exitCode, language: effectiveRuntime };
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('Syntax error')) {
            throw error;
          }
          throw new Error(
            `Declaw execution failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },

      runCommand: async (
        sandbox: DeclawSandbox,
        command: string,
        options?: RunCommandOptions,
      ): Promise<CommandResult> => {
        const startTime = Date.now();

        let fullCommand = command;
        if (options?.env && Object.keys(options.env).length > 0) {
          const envPrefix = Object.entries(options.env)
            .map(([k, v]) => `${k}="${escapeShellArg(v)}"`)
            .join(' ');
          fullCommand = `${envPrefix} ${fullCommand}`;
        }
        if (options?.cwd) {
          fullCommand = `cd "${escapeShellArg(options.cwd)}" && ${fullCommand}`;
        }
        if (options?.background) {
          fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
        }

        try {
          const result = await sandbox.commands.run(fullCommand);
          return {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            durationMs: Date.now() - startTime,
          };
        } catch (error) {
          const wrapped: any = (error as any)?.result;
          if (wrapped) {
            return {
              stdout: wrapped.stdout || '',
              stderr: wrapped.stderr || '',
              exitCode: wrapped.exitCode ?? 1,
              durationMs: Date.now() - startTime,
            };
          }
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 127,
            durationMs: Date.now() - startTime,
          };
        }
      },

      getInfo: async (sandbox: DeclawSandbox): Promise<SandboxInfo> => {
        const id = (sandbox as any).sandboxId ?? (sandbox as any).sandbox_id ?? 'declaw-unknown';
        return {
          id,
          provider: 'declaw',
          runtime: 'node',
          status: 'running',
          createdAt: new Date(),
          timeout: 300_000,
          metadata: { declawSandboxId: id },
        };
      },

      getUrl: async (
        sandbox: DeclawSandbox,
        options: { port: number; protocol?: string },
      ): Promise<string> => {
        try {
          const host = (sandbox as any).getHost(options.port);
          const protocol = options.protocol || 'https';
          return `${protocol}://${host}`;
        } catch (error) {
          throw new Error(
            `Failed to get Declaw host for port ${options.port}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },

      // Filesystem support maps to @declaw/sdk's Filesystem module.
      filesystem: {
        readFile: async (sandbox: DeclawSandbox, path: string): Promise<string> => {
          return await (sandbox as any).files.read(path);
        },
        writeFile: async (sandbox: DeclawSandbox, path: string, content: string): Promise<void> => {
          await (sandbox as any).files.write(path, content);
        },
        mkdir: async (sandbox: DeclawSandbox, path: string): Promise<void> => {
          await (sandbox as any).files.makeDir(path);
        },
        readdir: async (sandbox: DeclawSandbox, path: string): Promise<FileEntry[]> => {
          const entries = await (sandbox as any).files.list(path);
          return entries.map((entry: any) => ({
            name: entry.name,
            type:
              entry.isDir || entry.isDirectory || entry.type === 'directory'
                ? ('directory' as const)
                : ('file' as const),
            size: entry.size ?? 0,
            modified: new Date(entry.lastModified ?? entry.modified ?? Date.now()),
          }));
        },
        exists: async (sandbox: DeclawSandbox, path: string): Promise<boolean> => {
          return await (sandbox as any).files.exists(path);
        },
        remove: async (sandbox: DeclawSandbox, path: string): Promise<void> => {
          await (sandbox as any).files.remove(path);
        },
      },
    },
  },
});
