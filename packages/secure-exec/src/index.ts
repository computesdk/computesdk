/**
 * Secure-Exec Provider
 *
 * Local sandbox provider using secure-exec's V8 isolates.
 * Provides isolated JavaScript execution with an in-memory filesystem.
 */

import {
  NodeRuntime,
  createNodeDriver,
  createNodeRuntimeDriverFactory,
  createNodeV8Runtime,
  createInMemoryFileSystem,
  allowAllFs,
  allowAllChildProcess,
} from 'secure-exec';
import type { VirtualFileSystem, CommandExecutor } from 'secure-exec';
import { spawn } from 'node:child_process';
import { nanoid } from 'nanoid';
import { defineProvider } from '@computesdk/provider';

import type {
  CommandResult,
  SandboxInfo,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
} from '@computesdk/provider';

export interface SecureExecConfig {
  /** Memory cap for the V8 isolate in MB. Default: 128 */
  memoryLimitMb?: number;
  /** CPU time budget per exec call in ms. Default: 30_000 */
  cpuTimeLimitMs?: number;
  /** Allowlist of commands sandboxed code can spawn. Default: all allowed */
  allowedCommands?: string[];
}

export interface SecureExecInstance {
  runtime: NodeRuntime;
  fs: VirtualFileSystem;
  sandboxId: string;
}

function buildCommandExecutor(allowedCommands?: string[]): CommandExecutor {
  return {
    spawn(command, args, options) {
      if (allowedCommands && !allowedCommands.includes(command)) {
        throw new Error(`Command not in allowlist: ${command}`);
      }
      const child = spawn(command, args, {
        cwd: options.cwd === '/root' ? process.cwd() : options.cwd,
        env: { ...process.env, ...(options.env ?? {}) } as Record<string, string>,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.stdout.on('data', (chunk: Buffer) => options.onStdout?.(new Uint8Array(chunk)));
      child.stderr.on('data', (chunk: Buffer) => options.onStderr?.(new Uint8Array(chunk)));
      return {
        writeStdin: (data) => { child.stdin.write(data); },
        closeStdin: () => { child.stdin.end(); },
        kill: (signal) => { child.kill(signal); },
        wait: () =>
          new Promise<number>((resolve) => {
            child.once('close', (code) => resolve(code ?? 1));
          }),
      };
    },
  };
}

function captureStdio() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const onStdio = (event: { channel: 'stdout' | 'stderr'; message: string }) => {
    if (event.channel === 'stdout') stdout.push(event.message);
    else stderr.push(event.message);
  };
  return { stdout, stderr, onStdio };
}

export const secureExec = defineProvider<SecureExecInstance, SecureExecConfig>({
  name: 'secure-exec',
  methods: {
    sandbox: {
      create: async (config: SecureExecConfig, options?: CreateSandboxOptions) => {
        const fs = createInMemoryFileSystem();
        let v8Runtime;
        try {
          v8Runtime = await createNodeV8Runtime();
        } catch (error) {
          throw new Error(
            `secure-exec requires the V8 runtime binary (secure-exec-v8) which is currently only available for linux-x64. ` +
            `Your platform: ${process.platform}-${process.arch}. ` +
            `Original error: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        const runtime = new NodeRuntime({
          systemDriver: createNodeDriver({
            filesystem: fs,
            commandExecutor: buildCommandExecutor(config.allowedCommands),
            permissions: { ...allowAllFs, ...allowAllChildProcess },
            processConfig: { cwd: '/workspace', env: options?.envs ?? {} },
          }),
          runtimeDriverFactory: createNodeRuntimeDriverFactory({ v8Runtime }),
          memoryLimit: config.memoryLimitMb ?? 128,
          cpuTimeLimitMs: config.cpuTimeLimitMs ?? 30_000,
        });
        await fs.mkdir('/workspace');
        const sandboxId = `secureexec_${nanoid(10)}`;
        return { sandbox: { runtime, fs, sandboxId }, sandboxId };
      },

      getById: async (_config: SecureExecConfig, _sandboxId: string) => null,
      list: async (_config: SecureExecConfig) => [],
      destroy: async (_config: SecureExecConfig, _sandboxId: string) => {},

      runCommand: async (
        instance: SecureExecInstance,
        command: string,
        options?: RunCommandOptions,
      ): Promise<CommandResult> => {
        const startTime = Date.now();
        const { stdout, stderr, onStdio } = captureStdio();
        let fullCommand = command;
        if (options?.env && Object.keys(options.env).length > 0) {
          const envPrefix = Object.entries(options.env)
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
            .join(' ');
          fullCommand = `${envPrefix} ${fullCommand}`;
        }
        if (options?.cwd) fullCommand = `cd ${JSON.stringify(options.cwd)} && ${fullCommand}`;
        if (options?.background) fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
        try {
          const result = await instance.runtime.exec(
            `
            const { spawnSync } = require('child_process');
            const r = spawnSync('sh', ['-c', ${JSON.stringify(fullCommand)}], { encoding: 'utf8' });
            if (r.stdout) process.stdout.write(r.stdout);
            if (r.stderr) process.stderr.write(r.stderr);
            process.exit(r.status ?? 1);
            `,
            { onStdio },
          );
          return { stdout: stdout.join('\n'), stderr: stderr.join('\n'), exitCode: result.code, durationMs: Date.now() - startTime };
        } catch (error) {
          return { stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 127, durationMs: Date.now() - startTime };
        }
      },

      getInfo: async (instance: SecureExecInstance): Promise<SandboxInfo> => ({
        id: instance.sandboxId,
        provider: 'secure-exec',
        status: 'running',
        createdAt: new Date(),
        timeout: 0,
        metadata: { local: true },
      }),

      getUrl: async (
        _instance: SecureExecInstance,
        _options: { port: number; protocol?: string },
      ): Promise<string> => {
        throw new Error('getUrl is not supported by secure-exec provider.');
      },

      filesystem: {
        readFile: async ({ fs }: SecureExecInstance, path: string, _runCommand: unknown): Promise<string> =>
          fs.readTextFile(path),
        writeFile: async ({ fs }: SecureExecInstance, path: string, content: string, _runCommand: unknown): Promise<void> =>
          fs.writeFile(path, content),
        mkdir: async ({ fs }: SecureExecInstance, path: string, _runCommand: unknown): Promise<void> =>
          fs.mkdir(path),
        readdir: async ({ fs }: SecureExecInstance, path: string, _runCommand: unknown): Promise<FileEntry[]> => {
          const entries = await fs.readDirWithTypes(path);
          return entries.map((entry) => ({
            name: entry.name,
            type: entry.isDirectory ? ('directory' as const) : ('file' as const),
            path: `${path}/${entry.name}`.replace(/\/+/g, '/'),
            isDirectory: entry.isDirectory,
            size: 0,
            lastModified: new Date(),
          }));
        },
        exists: async ({ fs }: SecureExecInstance, path: string, _runCommand: unknown): Promise<boolean> =>
          fs.exists(path),
        remove: async ({ fs }: SecureExecInstance, path: string, _runCommand: unknown): Promise<void> => {
          try { await fs.removeFile(path); } catch { await fs.removeDir(path); }
        },
      },

      getInstance: (instance: SecureExecInstance): SecureExecInstance => instance,
    },
  },
});

export type { NodeRuntime as SecureExecRuntime } from 'secure-exec';
