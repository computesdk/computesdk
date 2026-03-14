/**
 * Cloudflare Provider - Factory-based Implementation (Dual-Mode)
 *
 * Supports two connection modes:
 *
 * 1. **Remote mode** — User deploys a gateway Worker to their Cloudflare account
 *    via `npx @computesdk/cloudflare`, then connects from anywhere using
 *    CLOUDFLARE_SANDBOX_URL + CLOUDFLARE_SANDBOX_SECRET.
 *
 * 2. **Direct mode** — User's code runs inside a Cloudflare Worker with the
 *    Durable Object binding available. Uses the @cloudflare/sandbox SDK directly.
 *
 * The mode is selected automatically based on which config fields are provided.
 */

import { defineProvider } from '@computesdk/provider';

/**
 * Lazy-load @cloudflare/sandbox to avoid importing it in Node.js environments.
 * The SDK only works inside the Cloudflare Workers runtime (its transitive dep
 * @cloudflare/containers uses extensionless ESM imports that break in Node).
 * Remote mode never needs this import.
 */
let _getSandboxFn: ((binding: any, id: string, options?: any) => any) | null = null;
async function getSandbox(binding: any, id: string, options?: any): Promise<any> {
  if (!_getSandboxFn) {
    const mod = await import('@cloudflare/sandbox');
    _getSandboxFn = mod.getSandbox as (binding: any, id: string, options?: any) => any;
  }
  return _getSandboxFn(binding, id, options);
}

import type { Runtime, CodeResult, CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

// ─── Config ──────────────────────────────────────────────────────────────────

export interface CloudflareConfig {
  // Remote mode (from anywhere — talks to deployed gateway Worker)
  /** URL of the deployed gateway Worker (e.g. https://computesdk-sandbox.user.workers.dev) */
  sandboxUrl?: string;
  /** Shared secret for authenticating with the gateway Worker */
  sandboxSecret?: string;

  // Direct mode (inside a Cloudflare Worker — uses DO binding)
  /** Cloudflare Sandbox Durable Object binding from Workers environment */
  sandboxBinding?: any;

  // Shared options
  /** Default runtime environment */
  runtime?: Runtime;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Environment variables to pass to sandbox */
  envVars?: Record<string, string>;
  /** Options passed to getSandbox() for lifecycle control (direct mode only) */
  sandboxOptions?: {
    sleepAfter?: string | number;
    keepAlive?: boolean;
  };
}

// ─── Internal types ──────────────────────────────────────────────────────────

interface CloudflareSandbox {
  sandboxId: string;
  exposedPorts: Map<number, string>;
  // Remote mode fields
  remote: boolean;
  sandboxUrl?: string;
  sandboxSecret?: string;
  // Direct mode fields
  sandbox?: any; // The @cloudflare/sandbox instance
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isRemote(config: CloudflareConfig): boolean {
  return !!(config.sandboxUrl && config.sandboxSecret);
}

function detectRuntime(code: string): Runtime {
  if (code.includes('print(') ||
      code.includes('import ') ||
      code.includes('def ') ||
      code.includes('sys.') ||
      code.includes('json.') ||
      code.includes('__') ||
      code.includes('f"') ||
      code.includes("f'") ||
      code.includes('raise ')) {
    return 'python';
  }
  if (code.includes('console.log') ||
      code.includes('process.') ||
      code.includes('require(') ||
      code.includes('module.exports') ||
      code.includes('__dirname') ||
      code.includes('__filename')) {
    return 'node';
  }
  return 'python';
}

function runtimeToLanguage(runtime: Runtime): 'python' | 'javascript' | 'typescript' {
  switch (runtime) {
    case 'python': return 'python';
    case 'node': return 'javascript';
    case 'bun': return 'javascript';
    case 'deno': return 'typescript';
    default: return 'python';
  }
}

/**
 * Make an authenticated request to the remote gateway Worker
 */
async function workerRequest(
  cfSandbox: CloudflareSandbox,
  path: string,
  body: Record<string, any> = {}
): Promise<any> {
  const res = await fetch(`${cfSandbox.sandboxUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfSandbox.sandboxSecret}`,
    },
    body: JSON.stringify({ sandboxId: cfSandbox.sandboxId, ...body }),
  });

  let data: any;
  try {
    data = await res.json();
  } catch {
    const text = await res.text().catch(() => '(unreadable)');
    throw new Error(`Worker request failed: ${res.status} - ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    throw new Error(data.error || `Worker request failed: ${res.status}`);
  }

  return data;
}

/**
 * Escape a string for safe use inside double-quoted shell arguments.
 */
function shellEscape(s: string): string {
  return s.replace(/["$`\\!]/g, '\\$&');
}

/**
 * Process code execution results into a CodeResult (shared by remote and direct modes)
 */
function processExecution(execution: any, detectedRuntime: Runtime): CodeResult {
  const stdoutParts: string[] = [];
  const stderrParts: string[] = [];

  if (execution.logs) {
    if (execution.logs.stdout) stdoutParts.push(...execution.logs.stdout);
    if (execution.logs.stderr) stderrParts.push(...execution.logs.stderr);
  }
  if (execution.results && Array.isArray(execution.results)) {
    for (const res of execution.results) {
      if (res.text) stdoutParts.push(res.text);
    }
  }
  if (execution.error) {
    const errorMsg = execution.error.message || execution.error.name || 'Execution error';
    if (errorMsg.includes('SyntaxError') || errorMsg.includes('invalid syntax')) {
      throw new Error(`Syntax error: ${errorMsg}`);
    }
    stderrParts.push(errorMsg);
  }

  const stdout = stdoutParts.join('\n');
  const stderr = stderrParts.join('\n');

  return {
    output: stderr ? `${stdout}${stdout && stderr ? '\n' : ''}${stderr}` : stdout,
    exitCode: execution.error ? 1 : 0,
    language: detectedRuntime
  };
}

/**
 * Parse ls -la output into FileEntry objects (used by both modes for readdir)
 */
function parseLsOutput(stdout: string): FileEntry[] {
  const lines = stdout.split('\n').filter((line: string) => line.trim() && !line.startsWith('total'));

  return lines.map((line: string) => {
    const parts = line.trim().split(/\s+/);
    const permissions = parts[0] || '';
    const size = parseInt(parts[4]) || 0;
    const dateStr = (parts[5] || '') + ' ' + (parts[6] || '');
    const date = dateStr.trim() ? new Date(dateStr) : new Date();
    const name = parts.slice(8).join(' ') || parts[parts.length - 1] || 'unknown';

    return {
      name,
      type: permissions.startsWith('d') ? 'directory' as const : 'file' as const,
      size,
      modified: isNaN(date.getTime()) ? new Date() : date
    };
  });
}

// ─── Provider ────────────────────────────────────────────────────────────────

export const cloudflare = defineProvider<CloudflareSandbox, CloudflareConfig>({
  name: 'cloudflare',
  methods: {
    sandbox: {
      // ─── Collection operations ───────────────────────────────────────

      create: async (config: CloudflareConfig, options?: CreateSandboxOptions) => {
        // Destructure known ComputeSDK fields, collect the rest for passthrough
        const {
          runtime: _runtime,
          timeout: optTimeout,
          envs,
          name: _name,
          metadata: _metadata,
          templateId: _templateId,
          snapshotId: _snapshotId,
          sandboxId: optSandboxId,
          namespace: _namespace,
          directory: _directory,
          overlays: _overlays,
          servers: _servers,
          ports: _ports,
          ...rest
        } = options || {};

        const sandboxId = optSandboxId || `cf-sandbox-${Date.now()}`;
        const envVars = { ...config.envVars, ...envs };
        // options.timeout takes precedence over config.timeout
        const timeout = optTimeout ?? config.timeout;

        // Remote mode
        if (isRemote(config)) {
          await workerRequest(
            { sandboxId, remote: true, sandboxUrl: config.sandboxUrl, sandboxSecret: config.sandboxSecret, exposedPorts: new Map() },
            '/v1/sandbox/create',
            {
              envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
              ...(timeout ? { timeout } : {}),
              ...rest, // Pass through provider-specific options
            }
          );

          return {
            sandbox: {
              sandboxId,
              remote: true,
              sandboxUrl: config.sandboxUrl,
              sandboxSecret: config.sandboxSecret,
              exposedPorts: new Map(),
            },
            sandboxId
          };
        }

        // Direct mode
        if (!config.sandboxBinding) {
          throw new Error(
            'Missing Cloudflare config. Either:\n' +
            '  1. Set CLOUDFLARE_SANDBOX_URL + CLOUDFLARE_SANDBOX_SECRET (remote mode)\n' +
            '  2. Provide sandboxBinding from your Workers environment (direct mode)\n' +
            'Run `npx @computesdk/cloudflare` to deploy a gateway Worker.'
          );
        }

        try {
          const sandbox = await getSandbox(config.sandboxBinding, sandboxId, config.sandboxOptions);

          if (Object.keys(envVars).length > 0) {
            await sandbox.setEnvVars(envVars);
          }

          return {
            sandbox: {
              sandbox,
              sandboxId,
              remote: false,
              exposedPorts: new Map(),
            },
            sandboxId
          };
        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('unauthorized') || error.message.includes('binding')) {
              throw new Error(
                'Cloudflare Sandbox binding failed. Ensure your Durable Object binding is properly configured in wrangler.toml. ' +
                'See https://developers.cloudflare.com/sandbox/get-started/ for setup instructions.'
              );
            }
            if (error.message.includes('quota') || error.message.includes('limit')) {
              throw new Error('Cloudflare resource limits exceeded. Check your usage at https://dash.cloudflare.com/');
            }
          }
          throw new Error(`Failed to create Cloudflare sandbox: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      getById: async (config: CloudflareConfig, sandboxId: string) => {
        // Remote mode
        if (isRemote(config)) {
          try {
            const cfSandbox: CloudflareSandbox = {
              sandboxId,
              remote: true,
              sandboxUrl: config.sandboxUrl,
              sandboxSecret: config.sandboxSecret,
              exposedPorts: new Map(),
            };
            // Verify sandbox is alive
            await workerRequest(cfSandbox, '/v1/sandbox/exec', { command: 'true' });
            return { sandbox: cfSandbox, sandboxId };
          } catch {
            return null;
          }
        }

        // Direct mode
        if (!config.sandboxBinding) return null;

        try {
          const sandbox = await getSandbox(config.sandboxBinding, sandboxId, config.sandboxOptions);
          await sandbox.exec('true');
          return {
            sandbox: { sandbox, sandboxId, remote: false, exposedPorts: new Map() },
            sandboxId
          };
        } catch {
          return null;
        }
      },

      list: async (_config: CloudflareConfig) => {
        throw new Error(
          'Cloudflare provider does not support listing sandboxes. ' +
          'Durable Objects do not have a native list API. ' +
          'Use getById to reconnect to specific sandboxes by ID.'
        );
      },

      destroy: async (config: CloudflareConfig, sandboxId: string) => {
        try {
          if (isRemote(config)) {
            await workerRequest(
              { sandboxId, remote: true, sandboxUrl: config.sandboxUrl, sandboxSecret: config.sandboxSecret, exposedPorts: new Map() },
              '/v1/sandbox/destroy'
            );
            return;
          }

          if (config.sandboxBinding) {
            const sandbox = await getSandbox(config.sandboxBinding, sandboxId);
            await sandbox.destroy();
          }
        } catch {
          // Sandbox might already be destroyed
        }
      },

      // ─── Instance operations ─────────────────────────────────────────

      runCode: async (cfSandbox: CloudflareSandbox, code: string, runtime?: Runtime): Promise<CodeResult> => {
        const detectedRuntime = runtime || detectRuntime(code);
        const language = runtimeToLanguage(detectedRuntime);

        // Remote mode
        if (cfSandbox.remote) {
          const execution = await workerRequest(cfSandbox, '/v1/sandbox/runCode', { code, language });
          return processExecution(execution, detectedRuntime);
        }

        // Direct mode
        try {
          const execution = await cfSandbox.sandbox.runCode(code, { language });
          return processExecution(execution, detectedRuntime);
        } catch (error) {
          if (error instanceof Error && error.message.includes('Syntax error')) throw error;
          throw new Error(`Cloudflare execution failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      runCommand: async (cfSandbox: CloudflareSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();

        // Remote mode
        if (cfSandbox.remote) {
          try {
            let fullCommand = command;
            if (options?.background) {
              fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
            }

            const result = await workerRequest(cfSandbox, '/v1/sandbox/exec', {
              command: fullCommand,
              cwd: options?.cwd,
              env: options?.env,
              timeout: options?.timeout,
            });

            return {
              stdout: result.stdout || '',
              stderr: result.stderr || '',
              exitCode: result.exitCode,
              durationMs: Date.now() - startTime
            };
          } catch (error) {
            return {
              stdout: '',
              stderr: error instanceof Error ? error.message : String(error),
              exitCode: 127,
              durationMs: Date.now() - startTime
            };
          }
        }

        // Direct mode
        try {
          let fullCommand = command;
          if (options?.background) {
            fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
          }

          const execResult = await cfSandbox.sandbox.exec(fullCommand, {
            cwd: options?.cwd,
            env: options?.env,
            timeout: options?.timeout,
          });

          return {
            stdout: execResult.stdout || '',
            stderr: execResult.stderr || '',
            exitCode: execResult.exitCode,
            durationMs: Date.now() - startTime
          };
        } catch (error) {
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 127,
            durationMs: Date.now() - startTime
          };
        }
      },

      getInfo: async (cfSandbox: CloudflareSandbox): Promise<SandboxInfo> => {
        try {
          if (cfSandbox.remote) {
            await workerRequest(cfSandbox, '/v1/sandbox/info');
          } else {
            await cfSandbox.sandbox.exec('true');
          }

          return {
            id: cfSandbox.sandboxId,
            provider: 'cloudflare',
            runtime: 'python',
            status: 'running',
            createdAt: new Date(),
            timeout: 300000,
            metadata: {
              cloudflareSandboxId: cfSandbox.sandboxId,
              mode: cfSandbox.remote ? 'remote' : 'direct',
            }
          };
        } catch (error) {
          return {
            id: cfSandbox.sandboxId,
            provider: 'cloudflare',
            runtime: 'python',
            status: 'error',
            createdAt: new Date(),
            timeout: 300000,
            metadata: {
              cloudflareSandboxId: cfSandbox.sandboxId,
              mode: cfSandbox.remote ? 'remote' : 'direct',
              error: error instanceof Error ? error.message : String(error)
            }
          };
        }
      },

      getUrl: async (cfSandbox: CloudflareSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        const { port, protocol = 'https' } = options;

        if (cfSandbox.exposedPorts.has(port)) {
          return cfSandbox.exposedPorts.get(port)!;
        }

        let preview: any;
        if (cfSandbox.remote) {
          preview = await workerRequest(cfSandbox, '/v1/sandbox/exposePort', { port, options: {} });
        } else {
          preview = await cfSandbox.sandbox.exposePort(port, {});
        }

        const url = `${protocol}://${preview.url}`;
        cfSandbox.exposedPorts.set(port, url);
        return url;
      },

      // ─── Filesystem ────────────────────────────────────────────────

      filesystem: {
        readFile: async (cfSandbox: CloudflareSandbox, path: string): Promise<string> => {
          if (cfSandbox.remote) {
            const file = await workerRequest(cfSandbox, '/v1/sandbox/readFile', { path });
            return file.content || '';
          }
          const file = await cfSandbox.sandbox.readFile(path);
          return file.content || '';
        },

        writeFile: async (cfSandbox: CloudflareSandbox, path: string, content: string): Promise<void> => {
          if (cfSandbox.remote) {
            await workerRequest(cfSandbox, '/v1/sandbox/writeFile', { path, content });
            return;
          }
          await cfSandbox.sandbox.writeFile(path, content);
        },

        mkdir: async (cfSandbox: CloudflareSandbox, path: string): Promise<void> => {
          if (cfSandbox.remote) {
            await workerRequest(cfSandbox, '/v1/sandbox/mkdir', { path });
            return;
          }
          await cfSandbox.sandbox.mkdir(path, { recursive: true });
        },

        readdir: async (cfSandbox: CloudflareSandbox, path: string): Promise<FileEntry[]> => {
          // Both modes use ls -la since there's no native readdir
          let result: any;
          if (cfSandbox.remote) {
            result = await workerRequest(cfSandbox, '/v1/sandbox/exec', {
              command: `ls -la "${shellEscape(path)}"`,
              cwd: '/',
            });
          } else {
            result = await cfSandbox.sandbox.exec(`ls -la "${shellEscape(path)}"`, { cwd: '/' });
          }

          if (result.exitCode !== 0) {
            throw new Error(`Directory listing failed: ${result.stderr}`);
          }

          return parseLsOutput(result.stdout);
        },

        exists: async (cfSandbox: CloudflareSandbox, path: string): Promise<boolean> => {
          if (cfSandbox.remote) {
            const result = await workerRequest(cfSandbox, '/v1/sandbox/exists', { path });
            return result.exists;
          }
          const result = await cfSandbox.sandbox.exists(path);
          return result.exists;
        },

        remove: async (cfSandbox: CloudflareSandbox, path: string): Promise<void> => {
          if (cfSandbox.remote) {
            await workerRequest(cfSandbox, '/v1/sandbox/deleteFile', { path });
            return;
          }
          await cfSandbox.sandbox.deleteFile(path);
        }
      }
    }
  }
});
