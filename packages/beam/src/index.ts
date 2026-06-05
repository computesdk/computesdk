/**
 * Beam Provider - Factory-based Implementation
 *
 * Containerized sandbox environments using the Beam platform.
 * Beam provides sandboxes with process management, filesystem access,
 * and port exposure capabilities.
 */

import { Sandbox, SandboxInstance, beamOpts, Image } from '@beamcloud/beam-js';
import { defineProvider, escapeShellArg } from '@computesdk/provider';
import type {
  CodeResult,
  CommandResult,
  SandboxInfo,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
  Runtime,
} from 'computesdk';

type RunCommandFn = (sandbox: SandboxInstance, command: string, options?: RunCommandOptions) => Promise<CommandResult>;

export interface BeamConfig {
  token?: string;
  workspaceId?: string;
  gatewayUrl?: string;
  timeout?: number;
}

function configureBeamOpts(config: BeamConfig): void {
  beamOpts.token = config.token || (typeof process !== 'undefined' && process.env?.BEAM_TOKEN) || '';
  beamOpts.workspaceId = config.workspaceId || (typeof process !== 'undefined' && process.env?.BEAM_WORKSPACE_ID) || '';
  if (config.gatewayUrl) beamOpts.gatewayUrl = config.gatewayUrl;
  if (config.timeout) (beamOpts as any).timeout = config.timeout;
}

function shellEscape(arg: string): string {
  if (arg === '') return "''";
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

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

function isPythonParserFailure(output: string): boolean {
  const hasSyntaxMarker =
    output.includes('SyntaxError') ||
    output.includes('IndentationError') ||
    output.includes('TabError');

  const hasStringFileContext = output.includes('File "<string>"');
  const hasRuntimeTraceback = output.includes('Traceback (most recent call last)');

  return hasSyntaxMarker && hasStringFileContext && !hasRuntimeTraceback;
}

function isParserFailure(output: string, runtime: string): boolean {
  if (!output.trim()) return false;
  if (runtime === 'node') return isNodeParserFailure(output);
  if (runtime === 'python') return isPythonParserFailure(output);
  return false;
}

function sandboxCacheKey(sandboxConfig: any): string {
  const image = sandboxConfig.image?.toString?.() || '';
  const envVars = Array.isArray(sandboxConfig.envVars) ? sandboxConfig.envVars.join('\0') : '';
  return [
    sandboxConfig.name || '',
    image,
    sandboxConfig.cpu || '',
    sandboxConfig.memory || '',
    sandboxConfig.gpu || '',
    sandboxConfig.keepWarmSeconds || '',
    envVars,
  ].join('::');
}

/** Cached Sandbox objects keyed by config fingerprint, so stubs are created once and reused. */
const sandboxCache = new Map<string, Sandbox>();

export const beam = defineProvider<SandboxInstance, BeamConfig>({
  name: 'beam',
  methods: {
    sandbox: {
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
          const {
            timeout: optTimeout,
            envs,
            name,
            metadata: _metadata,
            templateId: _templateId,
            snapshotId: _snapshotId,
            sandboxId: _sandboxId,
            namespace: _namespace,
            directory: _directory,
            ...providerOptions
          } = options || {};

          const optRuntime = (options as any)?.runtime as Runtime | undefined;
          const sandboxName = name || 'computesdk-sandbox';

          const sandboxConfig: any = {
            name: sandboxName,
            keepWarmSeconds: 300,
            ...providerOptions,
          };

          const timeout = optTimeout ?? config.timeout;
          if (timeout) sandboxConfig.keepWarmSeconds = Math.ceil(timeout / 1000);

          if (optRuntime === 'node') {
            sandboxConfig.image = Image.fromRegistry('node:20-slim');
          }

          if (envs) {
            sandboxConfig.envVars = Object.entries(envs).map(([name, value]) => `${name}=${value}`);
          }

          const cacheKey = sandboxCacheKey(sandboxConfig);
          let sandbox = sandboxCache.get(cacheKey);
          if (!sandbox) {
            sandbox = new Sandbox(sandboxConfig);
            sandboxCache.set(cacheKey, sandbox);
          }

          const instance = await sandbox.create();
          return { sandbox: instance, sandboxId: instance.containerId };
        } catch (error) {
          if (error instanceof Error && (error.message.includes('unauthorized') || error.message.includes('401'))) {
            throw new Error(
              `Beam authentication failed. Please check your BEAM_TOKEN environment variable. Get your token from https://app.beam.cloud`
            );
          }
          throw new Error(
            `Failed to create Beam sandbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: BeamConfig, sandboxId: string) => {
        configureBeamOpts(config);
        if (!beamOpts.token) return null;
        try {
          const instance = await Sandbox.connect(sandboxId);
          return { sandbox: instance, sandboxId: instance.containerId };
        } catch { return null; }
      },

      list: async (_config: BeamConfig) => [],

      destroy: async (config: BeamConfig, sandboxId: string) => {
        configureBeamOpts(config);
        if (!beamOpts.token) return;
        try {
          const instance = await Sandbox.connect(sandboxId);
          await instance.terminate();
        } catch { /* Sandbox might already be destroyed */ }
      },

      runCode: async (sandbox: SandboxInstance, code: string, runtime?: Runtime): Promise<CodeResult> => {
        const effectiveRuntime = runtime || (
          code.includes('print(') ||
          code.includes('import ') ||
          code.includes('def ') ||
          code.includes('sys.') ||
          code.includes('json.') ||
          code.includes('__') ||
          code.includes('f"') ||
          code.includes("f'") ||
          code.includes('raise ')
            ? 'python'
            : 'node'
        );

        try {
          const command = effectiveRuntime === 'python'
            ? ['python3', '-c', code]
            : ['node', '-e', code];

          const proc = await sandbox.exec(command);
          await proc.wait();
          const [stdoutStr, stderrStr] = await Promise.all([proc.stdout.read(), proc.stderr.read()]);
          const output = stderrStr
            ? `${stdoutStr}${stdoutStr && stderrStr ? '\n' : ''}${stderrStr}`
            : stdoutStr;
          const combinedOutput = `${stdoutStr || ''} ${stderrStr || ''}`;

          if (proc.exitCode !== 0 && isParserFailure(combinedOutput, effectiveRuntime)) {
            throw new Error(`Syntax error: ${(stderrStr || stdoutStr || '').trim()}`);
          }

          if (proc.exitCode !== 0 && !stdoutStr && !stderrStr) {
            throw new Error(`Code execution failed with exit code ${proc.exitCode}`);
          }

          return {
            output,
            exitCode: proc.exitCode,
            language: effectiveRuntime,
          };
        } catch (error) {
          if (error instanceof Error && error.message.includes('Syntax error')) {
            throw error;
          }
          throw new Error(
            `Beam execution failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      runCommand: async (sandbox: SandboxInstance, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();
        try {
          let fullCommand = command;
          if (options?.env && Object.keys(options.env).length > 0) {
            const envPrefix = Object.entries(options.env).map(([k, v]) => `${k}="${escapeShellArg(String(v))}"`).join(' ');
            fullCommand = `${envPrefix} ${fullCommand}`;
          }
          if (options?.cwd) fullCommand = `cd "${escapeShellArg(options.cwd)}" && ${fullCommand}`;
          if (options?.background) fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;

          const proc = await sandbox.exec(['sh', '-c', fullCommand]);
          await proc.wait();
          const [stdoutStr, stderrStr] = await Promise.all([proc.stdout.read(), proc.stderr.read()]);
          return { stdout: stdoutStr || '', stderr: stderrStr || '', exitCode: proc.exitCode || 0, durationMs: Date.now() - startTime };
        } catch (error) {
          return { stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 127, durationMs: Date.now() - startTime };
        }
      },

      getInfo: async (sandbox: SandboxInstance): Promise<SandboxInfo> => {
        let runtime: Runtime = 'python';
        const runtimeHint = sandbox as SandboxInstance & { runtime?: unknown; image?: unknown; imageName?: unknown };
        if (typeof runtimeHint.runtime === 'string') {
          const lower = runtimeHint.runtime.toLowerCase();
          if (lower.includes('node')) runtime = 'node';
          else if (lower.includes('python')) runtime = 'python';
        } else if (typeof runtimeHint.image === 'string') {
          const imageStr = runtimeHint.image.toLowerCase();
          if (imageStr.includes('node')) runtime = 'node';
          else if (imageStr.includes('python')) runtime = 'python';
        } else if (typeof runtimeHint.imageName === 'string') {
          const imageNameStr = runtimeHint.imageName.toLowerCase();
          if (imageNameStr.includes('node')) runtime = 'node';
          else if (imageNameStr.includes('python')) runtime = 'python';
        }
        return {
          id: sandbox.containerId,
          provider: 'beam',
          runtime,
          status: 'running',
          createdAt: new Date(),
          timeout: 300000,
          metadata: { containerId: sandbox.containerId, runtime },
        };
      },

      getUrl: async (sandbox: SandboxInstance, options: { port: number; protocol?: string }): Promise<string> => {
        try {
          return await sandbox.exposePort(options.port);
        } catch (error) {
          throw new Error(`Failed to get Beam URL for port ${options.port}: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      filesystem: {
        readFile: async (sandbox: SandboxInstance, path: string, runCommand: RunCommandFn): Promise<string> => {
          const result = await runCommand(sandbox, `cat ${shellEscape(path)}`);
          if (result.exitCode !== 0) throw new Error(`Failed to read file ${path}: ${result.stderr}`);
          return result.stdout;
        },
        writeFile: async (sandbox: SandboxInstance, path: string, content: string, runCommand: RunCommandFn): Promise<void> => {
          const b64 = Buffer.from(content).toString('base64');
          const result = await runCommand(sandbox, `echo '${b64}' | base64 -d > ${shellEscape(path)}`);
          if (result.exitCode !== 0) throw new Error(`Failed to write file ${path}: ${result.stderr}`);
        },
        mkdir: async (sandbox: SandboxInstance, path: string, runCommand: RunCommandFn): Promise<void> => {
          const result = await runCommand(sandbox, `mkdir -p ${shellEscape(path)}`);
          if (result.exitCode !== 0) throw new Error(`Failed to create directory ${path}: ${result.stderr}`);
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
          if (result.exitCode !== 0) throw new Error(`Failed to remove ${path}: ${result.stderr}`);
        },
      },

      getInstance: (sandbox: SandboxInstance): SandboxInstance => sandbox,
    },
  },
});

export type { SandboxInstance as BeamSandboxInstance } from '@beamcloud/beam-js';
