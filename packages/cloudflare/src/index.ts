/**
 * Cloudflare Provider - Factory-based Implementation (Dual-Mode)
 *
 * Supports two connection modes:
 *
 * 1. **Remote mode** — User deploys the official Cloudflare Sandbox bridge
 *    Worker, then connects from anywhere using sandboxUrl + sandboxApiKey.
 *
 * 2. **Direct mode** — User's code runs inside a Cloudflare Worker with the
 *    Durable Object binding available. Uses the @cloudflare/sandbox SDK directly.
 *
 * The mode is selected automatically based on which config fields are provided.
 */

import { defineProvider } from '@computesdk/provider';

let _getSandboxFn: ((binding: any, id: string, options?: any) => any) | null = null;
async function getSandbox(binding: any, id: string, options?: any): Promise<any> {
  if (!_getSandboxFn) {
    const mod = await import('@cloudflare/sandbox');
    _getSandboxFn = mod.getSandbox as (binding: any, id: string, options?: any) => any;
  }
  return _getSandboxFn(binding, id, options);
}

import type { CodeResult, CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions, CreateTemplateOptions, TemplateInfo } from '@computesdk/provider';

export interface CloudflareConfig {
  sandboxUrl?: string;
  sandboxApiKey?: string;
  /** @deprecated Use sandboxApiKey instead. */
  sandboxSecret?: string;
  sandboxBinding?: any;
  warmPool?: {
    binding: any;
    target?: number;
    refreshInterval?: number;
    poolName?: string;
  };
  timeout?: number;
  runtime?: string;
  envVars?: Record<string, string>;
  sandboxOptions?: {
    sleepAfter?: string | number;
    keepAlive?: boolean;
  };
}

interface CloudflareSandbox {
  sandboxId: string;
  exposedPorts: Map<number, string>;
  remote: boolean;
  sandboxUrl?: string;
  sandboxApiKey?: string;
  sandboxSecret?: string;
  pendingEnvVars?: Record<string, string>;
  remoteInitialized?: boolean;
  sandbox?: any;
  internalSandboxId?: string;
}

interface WarmPoolStub {
  configure(config: { warmTarget: number; refreshInterval: number }): Promise<void>;
  getContainer(sandboxId: string): Promise<string>;
  lookupContainer(sandboxId: string): Promise<string | null>;
  reportStopped(containerId: string): Promise<void>;
}

interface DirectSandboxLease {
  sandbox: any;
  internalSandboxId?: string;
}

function isRemote(config: CloudflareConfig): boolean {
  return !!(config.sandboxUrl && getSandboxApiKey(config));
}

function getSandboxApiKey(config: CloudflareConfig): string | undefined {
  return config.sandboxApiKey || config.sandboxSecret;
}

function createSandboxId(): string {
  return `cf-sandbox-${crypto.randomUUID()}`;
}

function isBridgeSandboxId(sandboxId: string): boolean {
  return /^[a-z2-7]{1,128}$/.test(sandboxId);
}

async function createBridgeSandboxId(config: CloudflareConfig): Promise<string> {
  const sandboxApiKey = getSandboxApiKey(config)!;
  const data = await bridgeJSONRequest(
    { sandboxId: '', remote: true, sandboxUrl: config.sandboxUrl, sandboxApiKey, sandboxSecret: sandboxApiKey, exposedPorts: new Map() },
    'POST',
    '/v1/sandbox'
  );

  if (!data.id || typeof data.id !== 'string') {
    throw new Error('Bridge sandbox create failed: missing sandbox id');
  }

  return data.id;
}

function getWarmPool(config: CloudflareConfig): WarmPoolStub | null {
  if (!config.warmPool?.binding) return null;

  const poolName = config.warmPool.poolName || 'global-pool';
  return config.warmPool.binding.get(
    config.warmPool.binding.idFromName(poolName)
  ) as WarmPoolStub;
}

async function configureWarmPool(config: CloudflareConfig, pool: WarmPoolStub): Promise<void> {
  await pool.configure({
    warmTarget: config.warmPool?.target ?? 0,
    refreshInterval: config.warmPool?.refreshInterval ?? 10000,
  });
}

async function getDirectSandbox(
  config: CloudflareConfig,
  sandboxId: string,
  options: Record<string, unknown> | undefined,
  allocate: boolean
): Promise<DirectSandboxLease | null> {
  const pool = getWarmPool(config);
  if (!pool) {
    return { sandbox: await getSandbox(config.sandboxBinding, sandboxId, options) };
  }

  await configureWarmPool(config, pool);
  const internalSandboxId = allocate
    ? await pool.getContainer(sandboxId)
    : await pool.lookupContainer(sandboxId);

  if (!internalSandboxId) return null;

  return {
    sandbox: await getSandbox(config.sandboxBinding, internalSandboxId, options),
    internalSandboxId,
  };
}

async function destroyDirectSandbox(config: CloudflareConfig, sandboxId: string): Promise<void> {
  const pool = getWarmPool(config);
  if (!pool) {
    const sandbox = await getSandbox(config.sandboxBinding, sandboxId);
    await sandbox.destroy();
    return;
  }

  await configureWarmPool(config, pool);
  const internalSandboxId = await pool.lookupContainer(sandboxId);
  if (!internalSandboxId) return;

  const sandbox = await getSandbox(config.sandboxBinding, internalSandboxId);
  try {
    await sandbox.destroy();
  } finally {
    await pool.reportStopped(internalSandboxId);
  }
}

function bridgeUrl(cfSandbox: CloudflareSandbox, path: string): string {
  const base = (cfSandbox.sandboxUrl || '').replace(/\/$/, '');
  return `${base}${path}`;
}

function bridgeAuth(cfSandbox: CloudflareSandbox): string {
  return cfSandbox.sandboxApiKey || cfSandbox.sandboxSecret || '';
}

async function bridgeRequest(
  cfSandbox: CloudflareSandbox,
  method: string,
  path: string,
  body?: BodyInit,
  headers: Record<string, string> = {}
): Promise<Response> {
  const res = await fetch(bridgeUrl(cfSandbox, path), {
    method,
    headers: {
      'Authorization': `Bearer ${bridgeAuth(cfSandbox)}`,
      ...headers,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '(unreadable)');
    throw new Error(`Bridge request failed: ${res.status} - ${text.slice(0, 200)}`);
  }

  return res;
}

async function bridgeJSONRequest(
  cfSandbox: CloudflareSandbox,
  method: string,
  path: string,
  body?: Record<string, any>
): Promise<any> {
  const res = await bridgeRequest(
    cfSandbox,
    method,
    path,
    body === undefined ? undefined : JSON.stringify(body),
    body === undefined ? {} : { 'Content-Type': 'application/json' }
  );

  const text = await res.text();
  if (!text) return {};
  return JSON.parse(text);
}

function encodeFilePath(path: string): string {
  return path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
}

function decodeBase64(data: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(data, 'base64').toString('utf8');
  const binary = atob(data);
  return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
}

function parseBridgeExecEvents(text: string): Pick<CommandResult, 'stdout' | 'stderr' | 'exitCode'> {
  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  for (const rawEvent of text.split(/\r?\n\r?\n/)) {
    const lines = rawEvent.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) continue;

    let event = 'message';
    const data: string[] = [];

    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }

    const payload = data.join('\n');
    if (event === 'stdout') stdout += decodeBase64(payload);
    else if (event === 'stderr') stderr += decodeBase64(payload);
    else if (event === 'exit') {
      const parsed = JSON.parse(payload);
      exitCode = parsed.exit_code ?? parsed.exitCode ?? 0;
    } else if (event === 'error') {
      try {
        const parsed = JSON.parse(payload);
        stderr += parsed.error || parsed.message || payload;
      } catch {
        stderr += payload;
      }
      if (exitCode === 0) exitCode = 1;
    }
  }

  return { stdout, stderr, exitCode };
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function envPrefix(envVars?: Record<string, string>): string {
  if (!envVars || Object.keys(envVars).length === 0) return '';

  return Object.entries(envVars).map(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid environment variable name: ${key}`);
    return `export ${key}=${shellQuote(value)};`;
  }).join(' ') + ' ';
}

async function bridgeExec(
  cfSandbox: CloudflareSandbox,
  command: string,
  options?: RunCommandOptions
): Promise<CommandResult> {
  const startTime = Date.now();
  const envVars = { ...cfSandbox.pendingEnvVars, ...options?.env };
  const fullCommand = `${envPrefix(envVars)}${command}`;
  const res = await bridgeRequest(
    cfSandbox,
    'POST',
    `/v1/sandbox/${encodeURIComponent(cfSandbox.sandboxId)}/exec`,
    JSON.stringify({
      argv: ['sh', '-lc', fullCommand],
      cwd: options?.cwd,
      timeout_ms: options?.timeout,
    }),
    { 'Content-Type': 'application/json' }
  );

  const parsed = parseBridgeExecEvents(await res.text());
  cfSandbox.remoteInitialized = true;
  return { ...parsed, durationMs: Date.now() - startTime };
}

function processExecution(execution: any, detectedRuntime: string): CodeResult {
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

export const cloudflare = defineProvider<CloudflareSandbox, CloudflareConfig>({
  name: 'cloudflare',
  methods: {
    sandbox: {
      create: async (config: CloudflareConfig, options?: CreateSandboxOptions) => {
        const {
          timeout: optTimeout,
          envs,
          name: _name,
          metadata: _metadata,
          templateId: _templateId,
          snapshotId: _snapshotId,
          sandboxId: optSandboxId,
          namespace: _namespace,
          directory: _directory,
          ...rest
        } = options || {};

        const envVars = { ...config.envVars, ...envs };
        const timeout = optTimeout ?? config.timeout;
        const sleepAfter = timeout ? `${Math.ceil(timeout / 1000)}s` : undefined;

        if (isRemote(config)) {
          const sandboxApiKey = getSandboxApiKey(config)!;
          if (optSandboxId && !isBridgeSandboxId(optSandboxId)) {
            throw new Error('Invalid Cloudflare bridge sandbox ID. Expected lowercase base32 characters a-z and 2-7.');
          }
          const sandboxId = optSandboxId || await createBridgeSandboxId(config);
          return {
            sandbox: {
              sandboxId,
              remote: true,
              sandboxUrl: config.sandboxUrl,
              sandboxApiKey,
              sandboxSecret: sandboxApiKey,
              pendingEnvVars: Object.keys(envVars).length > 0 ? envVars : undefined,
              remoteInitialized: false,
              exposedPorts: new Map(),
            },
            sandboxId
          };
        }

        const sandboxId = optSandboxId || createSandboxId();

        if (!config.sandboxBinding) {
          throw new Error(
            'Missing Cloudflare config. Either:\n' +
            '  1. Set sandboxUrl + sandboxApiKey for a Cloudflare Sandbox bridge Worker (remote mode)\n' +
            '  2. Provide sandboxBinding from your Workers environment (direct mode)\n' +
            'Deploy the official Cloudflare Sandbox bridge Worker to use remote mode.'
          );
        }

        try {
          const sandboxOpts = { ...config.sandboxOptions };
          if (sleepAfter) sandboxOpts.sleepAfter = sleepAfter;
          const lease = await getDirectSandbox(config, sandboxId, sandboxOpts, true);
          if (!lease) throw new Error('WarmPool did not return a sandbox assignment');
          const { sandbox, internalSandboxId } = lease;

          if (Object.keys(envVars).length > 0) await sandbox.setEnvVars(envVars);

          return {
            sandbox: { sandbox, sandboxId, internalSandboxId, remote: false, exposedPorts: new Map() },
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
        if (isRemote(config)) {
          if (!isBridgeSandboxId(sandboxId)) return null;
          const sandboxApiKey = getSandboxApiKey(config)!;
          const cfSandbox: CloudflareSandbox = {
            sandboxId, remote: true, sandboxUrl: config.sandboxUrl,
            sandboxApiKey, sandboxSecret: sandboxApiKey, remoteInitialized: true, exposedPorts: new Map(),
          };
          return { sandbox: cfSandbox, sandboxId };
        }

        if (!config.sandboxBinding) return null;

        try {
          const lease = await getDirectSandbox(config, sandboxId, config.sandboxOptions, false);
          if (!lease) return null;
          await lease.sandbox.exec('true');
          return { sandbox: { sandbox: lease.sandbox, sandboxId, internalSandboxId: lease.internalSandboxId, remote: false, exposedPorts: new Map() }, sandboxId };
        } catch { return null; }
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
            const sandboxApiKey = getSandboxApiKey(config)!;
            await bridgeJSONRequest({ sandboxId, remote: true, sandboxUrl: config.sandboxUrl, sandboxApiKey, sandboxSecret: sandboxApiKey, exposedPorts: new Map() }, 'DELETE', `/v1/sandbox/${encodeURIComponent(sandboxId)}`);
            return;
          }
          if (config.sandboxBinding) {
            await destroyDirectSandbox(config, sandboxId);
          }
        } catch { /* Sandbox might already be destroyed */ }
      },

      runCommand: async (cfSandbox: CloudflareSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();

        if (cfSandbox.remote) {
          try {
            let fullCommand = command;
            if (options?.background) fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
            return await bridgeExec(cfSandbox, fullCommand, options);
          } catch (error) {
            return { stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 127, durationMs: Date.now() - startTime };
          }
        }

        try {
          let fullCommand = command;
          if (options?.background) fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
          const execResult = await cfSandbox.sandbox.exec(fullCommand, {
            cwd: options?.cwd, env: options?.env, timeout: options?.timeout,
          });
          return { stdout: execResult.stdout || '', stderr: execResult.stderr || '', exitCode: execResult.exitCode, durationMs: Date.now() - startTime };
        } catch (error) {
          return { stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 127, durationMs: Date.now() - startTime };
        }
      },

      getInfo: async (cfSandbox: CloudflareSandbox): Promise<SandboxInfo> => {
        try {
          if (cfSandbox.remote) await bridgeExec(cfSandbox, 'true');
          else await cfSandbox.sandbox.exec('true');

          return {
            id: cfSandbox.sandboxId, provider: 'cloudflare', status: 'running',
            createdAt: new Date(), timeout: 300000,
            metadata: { cloudflareSandboxId: cfSandbox.sandboxId, mode: cfSandbox.remote ? 'remote' : 'direct' }
          };
        } catch (error) {
          return {
            id: cfSandbox.sandboxId, provider: 'cloudflare', status: 'error',
            createdAt: new Date(), timeout: 300000,
            metadata: { cloudflareSandboxId: cfSandbox.sandboxId, mode: cfSandbox.remote ? 'remote' : 'direct', error: error instanceof Error ? error.message : String(error) }
          };
        }
      },

      getUrl: async (cfSandbox: CloudflareSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        const { port, protocol = 'https' } = options;
        if (cfSandbox.exposedPorts.has(port)) return cfSandbox.exposedPorts.get(port)!;

        let preview: any;
        if (cfSandbox.remote) {
          preview = await bridgeJSONRequest(cfSandbox, 'POST', `/v1/sandbox/${encodeURIComponent(cfSandbox.sandboxId)}/tunnel/${port}`);
        } else {
          preview = await cfSandbox.sandbox.exposePort(port, {});
        }

        const url = /^https?:\/\//.test(preview.url) ? preview.url : `${protocol}://${preview.url}`;
        cfSandbox.exposedPorts.set(port, url);
        return url;
      },

      filesystem: {
        readFile: async (cfSandbox: CloudflareSandbox, path: string): Promise<string> => {
          if (cfSandbox.remote) {
            const res = await bridgeRequest(cfSandbox, 'GET', `/v1/sandbox/${encodeURIComponent(cfSandbox.sandboxId)}/file/${encodeFilePath(path)}`);
            return await res.text();
          }
          const file = await cfSandbox.sandbox.readFile(path);
          return file.content || '';
        },
        writeFile: async (cfSandbox: CloudflareSandbox, path: string, content: string): Promise<void> => {
          if (cfSandbox.remote) { await bridgeRequest(cfSandbox, 'PUT', `/v1/sandbox/${encodeURIComponent(cfSandbox.sandboxId)}/file/${encodeFilePath(path)}`, content, { 'Content-Type': 'text/plain; charset=utf-8' }); return; }
          await cfSandbox.sandbox.writeFile(path, content);
        },
        mkdir: async (cfSandbox: CloudflareSandbox, path: string): Promise<void> => {
          if (cfSandbox.remote) {
            const result = await bridgeExec(cfSandbox, `mkdir -p ${shellQuote(path)}`, { cwd: '/workspace' });
            if (result.exitCode !== 0) throw new Error(`Directory creation failed: ${result.stderr}`);
            return;
          }
          await cfSandbox.sandbox.mkdir(path, { recursive: true });
        },
        readdir: async (cfSandbox: CloudflareSandbox, path: string): Promise<FileEntry[]> => {
          let result: any;
          if (cfSandbox.remote) {
            result = await bridgeExec(cfSandbox, `ls -la ${shellQuote(path)}`, { cwd: '/workspace' });
          } else {
            result = await cfSandbox.sandbox.exec(`ls -la ${shellQuote(path)}`, { cwd: '/' });
          }
          if (result.exitCode !== 0) throw new Error(`Directory listing failed: ${result.stderr}`);
          return parseLsOutput(result.stdout);
        },
        exists: async (cfSandbox: CloudflareSandbox, path: string): Promise<boolean> => {
          if (cfSandbox.remote) {
            const result = await bridgeExec(cfSandbox, `test -e ${shellQuote(path)}`, { cwd: '/workspace' });
            return result.exitCode === 0;
          }
          const result = await cfSandbox.sandbox.exists(path);
          return result.exists;
        },
        remove: async (cfSandbox: CloudflareSandbox, path: string): Promise<void> => {
          if (cfSandbox.remote) {
            const result = await bridgeExec(cfSandbox, `rm -rf ${shellQuote(path)}`, { cwd: '/workspace' });
            if (result.exitCode !== 0) throw new Error(`File removal failed: ${result.stderr}`);
            return;
          }
          await cfSandbox.sandbox.deleteFile(path);
        }
      }
    },

    // Templates on Cloudflare are point-in-time backups of a sandbox directory,
    // captured via the Sandbox SDK backup/restore API and stored in R2.
    // Cloudflare has no build-from-spec API (images are built at deploy time via
    // Dockerfile), so only capture-from-sandbox is supported.
    template: {
      create: async (config: CloudflareConfig, options: CreateTemplateOptions): Promise<TemplateInfo> => {
        if (!options.from) {
          throw new Error(
            'Cloudflare does not support building templates from spec. ' +
            'Container images are built at deploy time from your Dockerfile. ' +
            'Use { from: sandboxId } to capture a point-in-time backup of a running sandbox.'
          );
        }

        if (isRemote(config)) {
          throw new Error(
            'Cloudflare template capture requires direct mode (sandboxBinding). ' +
            'The Sandbox backup API is not exposed through the bridge Worker.'
          );
        }

        if (!config.sandboxBinding) {
          throw new Error(
            'Cloudflare template capture requires a sandboxBinding (direct mode). ' +
            'Provide sandboxBinding from your Workers environment.'
          );
        }

        const lease = await getDirectSandbox(config, options.from, config.sandboxOptions, false);
        if (!lease) {
          throw new Error(`Cloudflare sandbox "${options.from}" not found.`);
        }

        const dir = options.contextDir || '/workspace';
        try {
          const backup = await lease.sandbox.createBackup({
            dir,
            name: options.name,
          });

          return {
            id: backup.id,
            provider: 'cloudflare',
            name: options.name,
            createdAt: new Date(),
            status: 'active',
            metadata: {
              ...options.metadata,
              source: 'capture',
              sandboxId: options.from,
              dir: backup.dir ?? dir,
            },
          };
        } catch (error) {
          throw new Error(
            `Failed to create Cloudflare template: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      list: async (_config: CloudflareConfig): Promise<TemplateInfo[]> => {
        // Cloudflare backups live as objects in the user's R2 bucket, not in a
        // queryable sandbox API. Enumerate them via the R2 binding directly.
        return [];
      },

      delete: async (_config: CloudflareConfig, _templateId: string): Promise<void> => {
        // Backups are stored in the user's R2 bucket under backups/{id}/. Deletion
        // is performed through the R2 binding (BACKUP_BUCKET.delete), which is not
        // available from the provider config, so this is a no-op.
      },
    },
  }
});
