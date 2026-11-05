/**
 * Sprites Provider - Factory-based Implementation
 */

import { randomUUID } from 'node:crypto';

import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type { CommandResult, InstanceInfo, CreateInstanceOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

export interface SpritesSandbox {
  id: string;
  status: string;
  [key: string]: any;
}

export interface SpritesConfig {
  /** Sprites API token - if not provided, will fallback to SPRITES_TOKEN environment variable */
  apiKey?: string;
  /** Base URL for the Sprites API */
  baseUrl?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

const FRAME_STDOUT = 0x01;
const FRAME_STDERR = 0x02;
const FRAME_EXIT = 0x03;
const CONNECT_ERRORS = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);

interface ExecFramesResult { stdout: string; stderr: string; exitCode: number | null }

/**
 * POST /exec with `script` on bash's stdin. The response body is type-prefixed
 * frames without lengths (0x01 stdout, 0x02 stderr, 0x03 <exit byte>), one per
 * HTTP chunk, so each read is taken to start a frame unless its first byte
 * isn't a frame type, in which case it continues the previous frame (a large
 * chunk split across reads). env and cwd go through the API's native fields.
 */
async function execFrames(
  sandbox: SpritesSandbox,
  script: string,
  options: RunCommandOptions | undefined,
  callbacks: { onStdout?: (data: string) => void; onStderr?: (data: string) => void } = {},
): Promise<ExecFramesResult> {
  const url = new URL(`${sandbox._baseUrl}/sprites/${encodeURIComponent(sandbox.name)}/exec`);
  url.searchParams.append('cmd', 'bash');
  url.searchParams.set('stdin', 'true');
  if (options?.cwd) url.searchParams.set('dir', options.cwd);
  for (const [key, value] of Object.entries(options?.env ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid environment variable name: ${key}`);
    url.searchParams.append('env', `${key}=${value}`);
  }

  // Backstop in case the in-box watchdog can't end the response.
  const controller = new AbortController();
  const abortTimer = options?.timeout ? setTimeout(() => controller.abort(), options.timeout + 15000) : undefined;
  let res: Response;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${sandbox._token}`, 'Content-Type': 'application/octet-stream' },
        body: script,
        signal: controller.signal,
      });
      break;
    } catch (error) {
      if (controller.signal.aborted) {
        clearTimeout(abortTimer);
        return { stdout: '', stderr: '', exitCode: 124 };
      }
      // Exec isn't idempotent, so only retry when the request never reached the server.
      const code = (error as { cause?: { code?: string } })?.cause?.code;
      if (attempt < 4 && code && CONNECT_ERRORS.has(code)) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        continue;
      }
      clearTimeout(abortTimer);
      throw new Error(`Sprites exec request failed: ${error instanceof Error ? error.message : String(error)}${code ? ` (${code})` : ''}`);
    }
  }
  if (!res.ok) { clearTimeout(abortTimer); throw new Error(`Sprites exec failed (${res.status}): ${await res.text()}`); }
  if (!res.body) throw new Error('Sprites exec response has no body');

  const decoders = { [FRAME_STDOUT]: new TextDecoder(), [FRAME_STDERR]: new TextDecoder() };
  const out = { [FRAME_STDOUT]: '', [FRAME_STDERR]: '' };
  let stream: typeof FRAME_STDOUT | typeof FRAME_STDERR = FRAME_STDOUT;
  let exitCode: number | null = null;
  const emit = (data: Uint8Array) => {
    if (!data.length) return;
    const text = decoders[stream].decode(data, { stream: true });
    if (!text) return;
    out[stream] += text;
    (stream === FRAME_STDOUT ? callbacks.onStdout : callbacks.onStderr)?.(text);
  };

  const reader = res.body.getReader();
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (!controller.signal.aborted) throw error;
        exitCode = 124;
        break;
      }
      const { value, done } = chunk;
      if (done) break;
      if (!value?.length) continue;
      const type = value[0];
      if (type === FRAME_EXIT && value.length === 2) { exitCode = value[1]; continue; }
      if (type === FRAME_STDOUT || type === FRAME_STDERR) {
        stream = type;
        let payload = value.subarray(1);
        // An exit frame coalesced onto the end of the last output chunk.
        if (payload.length >= 2 && payload[payload.length - 2] === FRAME_EXIT) {
          exitCode = payload[payload.length - 1];
          payload = payload.subarray(0, payload.length - 2);
        }
        emit(payload);
      } else {
        emit(value);
      }
    }
  } finally {
    clearTimeout(abortTimer);
    await reader.cancel().catch(() => undefined);
  }
  for (const id of [FRAME_STDOUT, FRAME_STDERR] as const) {
    stream = id;
    const tail = decoders[id].decode();
    if (tail) { out[id] += tail; (id === FRAME_STDOUT ? callbacks.onStdout : callbacks.onStderr)?.(tail); }
  }
  return { stdout: out[FRAME_STDOUT], stderr: out[FRAME_STDERR], exitCode };
}

/** The caller's command in a subshell with stdin from /dev/null, so it can't read the rest of the script bash is fed on stdin. */
function subshell(command: string): string {
  return `(\n${command}\n) </dev/null`;
}

/**
 * `subshell` under a deadline: job control puts the command in its own process
 * group and a watchdog SIGKILLs that whole group at the deadline, so nothing
 * the command spawned outlives it (exit 137).
 */
function withDeadline(command: string, timeoutMs?: number): string {
  if (!timeoutMs || timeoutMs <= 0) return subshell(command);
  const secs = (timeoutMs / 1000).toFixed(3);
  return `( set -m; ${subshell(command)} & __sp_pid=$!; ` +
    `( sleep ${secs}; kill -KILL -- -$__sp_pid 2>/dev/null ) </dev/null >/dev/null 2>&1 & __sp_wd=$!; ` +
    `wait $__sp_pid; __sp_rc=$?; kill -KILL -- -$__sp_wd 2>/dev/null; exit $__sp_rc )`;
}

export const sprites = defineProvider<SpritesSandbox, SpritesConfig>({
  name: 'sprites',
  methods: {
    instances: {
      create: async (config: SpritesConfig, options?: CreateInstanceOptions) => {
        const token = config.apiKey || (typeof process !== 'undefined' && process.env?.SPRITES_TOKEN) || '';
        const baseUrl = config.baseUrl || 'https://api.sprites.dev/v1';

        if (!token) throw new Error(`Missing Sprites API token. Provide 'apiKey' in config or set SPRITES_TOKEN environment variable.`);

        try {
          const {
            timeout: _timeout, envs, name, metadata,
            templateId: _templateId, snapshotId: _snapshotId,
            sandboxId: optSandboxId, namespace: _namespace, directory: _directory,
            ...providerOptions
          } = options || {};

          const body: Record<string, any> = {
            // Date.now() alone collides for concurrent creates (burst
            // benchmarks), so a uuid suffix keeps every default unique.
            name: name || optSandboxId || `sprite-${Date.now()}-${randomUUID().slice(0, 8)}`,
            url_settings: { auth: 'public' },
            ...providerOptions,
          };

          if (envs && Object.keys(envs).length > 0) body.env_vars = envs;
          if (metadata && typeof metadata === 'object') body.metadata = metadata;

          // Creation is rate-limited per account (payg: 10/min); a 429 body
          // carries retry_after_seconds, so retry within a bounded window
          // instead of surfacing a transient throttle as a create failure.
          const retryDeadline = Date.now() + 180_000;
          let res: Response;
          for (;;) {
            res = await fetch(`${baseUrl}/sprites`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
            if (res.status !== 429 || Date.now() >= retryDeadline) break;
            let waitMs = 10_000;
            try {
              const errBody = await res.clone().json() as { retry_after_seconds?: number };
              if (typeof errBody.retry_after_seconds === 'number') {
                waitMs = Math.min((errBody.retry_after_seconds + 1) * 1000, 65_000);
              }
            } catch { /* non-JSON 429 body — use the default wait */ }
            await new Promise((resolve) => setTimeout(resolve, waitMs));
          }

          if (!res.ok) { const text = await res.text(); throw new Error(`Sprites API error (${res.status}): ${text}`); }

          const data = await res.json() as SpritesSandbox;
          data._token = token;
          data._baseUrl = baseUrl;

          return { instance: data, instanceId: data.name };
        } catch (error) {
          if (error instanceof Error && error.message.includes('Sprites API error')) throw error;
          throw new Error(`Failed to create Sprites sandbox: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      getById: async (config: SpritesConfig, sandboxId: string) => {
        const token = config.apiKey || (typeof process !== 'undefined' && process.env?.SPRITES_TOKEN) || '';
        const baseUrl = config.baseUrl || 'https://api.sprites.dev/v1';
        try {
          const res = await fetch(`${baseUrl}/sprites/${encodeURIComponent(sandboxId)}`, { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } });
          if (!res.ok) return null;
          const data = await res.json() as SpritesSandbox;
          data._token = token; data._baseUrl = baseUrl;
          return { instance: data, instanceId: data.name };
        } catch { return null; }
      },

      list: async (config: SpritesConfig) => {
        const token = config.apiKey || (typeof process !== 'undefined' && process.env?.SPRITES_TOKEN) || '';
        const baseUrl = config.baseUrl || 'https://api.sprites.dev/v1';
        try {
          const all: SpritesSandbox[] = [];
          let continuation: string | undefined;
          do {
            const url = new URL(`${baseUrl}/sprites`);
            url.searchParams.set('max_results', '500');
            if (continuation) url.searchParams.set('continuation_token', continuation);
            const res = await fetch(url.toString(), { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) break;
            const data = await res.json() as SpritesSandbox[] | { sprites?: SpritesSandbox[]; has_more?: boolean; next_continuation_token?: string };
            if (Array.isArray(data)) { all.push(...data); break; }
            all.push(...(data.sprites ?? []));
            continuation = data.has_more ? data.next_continuation_token : undefined;
          } while (continuation);
          return all.map((sprite: SpritesSandbox) => { sprite._token = token; sprite._baseUrl = baseUrl; return { instance: sprite, instanceId: sprite.name }; });
        } catch { return []; }
      },

      destroy: async (config: SpritesConfig, sandboxId: string) => {
        const token = config.apiKey || (typeof process !== 'undefined' && process.env?.SPRITES_TOKEN) || '';
        const baseUrl = config.baseUrl || 'https://api.sprites.dev/v1';
        try { await fetch(`${baseUrl}/sprites/${encodeURIComponent(sandboxId)}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } }); } catch { /* ignore */ }
      },

      runCommand: async (sandbox: SpritesSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();
        const id = `${Date.now()}_${randomUUID().slice(0, 8)}`;
        const delimiter = `__COMPUTESDK_EXIT_${id}__`;
        const errDelimiter = `__COMPUTESDK_STDERR_${id}__`;
        const errFile = `/tmp/.computesdk-stderr-${id}`;

        // Frames are one per HTTP chunk and a proxy may merge them, so the
        // exit code and stderr travel in-band behind delimiters on stdout
        // rather than relying on frame boundaries.
        const script = `${subshell(command)} 2>${escapeShellArg(errFile)}; __sp_ec=$?; echo "${delimiter}$__sp_ec"; echo "${errDelimiter}"; cat ${escapeShellArg(errFile)} 2>/dev/null; rm -f ${escapeShellArg(errFile)}\n`;

        try {
          const raw = await execFrames(sandbox, script, options);
          const delimIdx = raw.stdout.lastIndexOf(delimiter);
          if (delimIdx === -1) {
            return { stdout: raw.stdout, stderr: raw.stderr, exitCode: raw.exitCode ?? 1, durationMs: Date.now() - startTime };
          }
          const stdout = raw.stdout.substring(0, delimIdx);
          const after = raw.stdout.substring(delimIdx + delimiter.length);
          const nlIdx = after.indexOf('\n');
          const exitCode = parseInt((nlIdx === -1 ? after : after.substring(0, nlIdx)).trim(), 10) || 0;
          let stderr = '';
          if (nlIdx !== -1) {
            const rest = after.substring(nlIdx + 1);
            const errIdx = rest.indexOf(`${errDelimiter}\n`);
            if (errIdx !== -1) stderr = rest.substring(errIdx + errDelimiter.length + 1);
          }
          return { stdout, stderr: raw.stderr + stderr, exitCode, durationMs: Date.now() - startTime };
        } catch (error) {
          return { stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 127, durationMs: Date.now() - startTime };
        }
      },

      // The exec response streams stdout and stderr as separate frames while
      // the command runs, so callbacks get live, separated output natively.
      streamCommand: async (sandbox: SpritesSandbox, command: string, options: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();
        const result = await execFrames(sandbox, `${withDeadline(command, options.timeout)}\n`, options, { onStdout: options.onStdout, onStderr: options.onStderr });
        if (result.exitCode === null) throw new Error('Sprites exec response did not include an exit frame');
        return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, durationMs: Date.now() - startTime };
      },

      getInfo: async (sandbox: SpritesSandbox): Promise<InstanceInfo> => {
        const token = sandbox._token;
        const baseUrl = sandbox._baseUrl;
        const name = sandbox.name;
        try {
          const res = await fetch(`${baseUrl}/sprites/${encodeURIComponent(name)}`, { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } });
          if (!res.ok) throw new Error(`Sprites API error (${res.status})`);
          const data = await res.json() as Record<string, any>;
          return {
            id: data.id || name, provider: 'sprites',
            status: data.status === 'running' ? 'running' : data.status === 'warm' ? 'running' : 'stopped',
            createdAt: new Date(data.created_at), timeout: 300000,
            metadata: { name: data.name, organization: data.organization, url: data.url, urlSettings: data.url_settings, lastStartedAt: data.last_started_at, lastActiveAt: data.last_active_at },
          };
        } catch (error) {
          throw new Error(`Failed to get Sprites info: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      getUrl: async (sandbox: SpritesSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        if (sandbox.url) {
          const protocol = options.protocol || 'https';
          return `${protocol}://${sandbox.url.replace(/^https?:\/\//, '')}`;
        }
        const token = sandbox._token;
        const baseUrl = sandbox._baseUrl;
        const name = sandbox.name;
        const res = await fetch(`${baseUrl}/sprites/${encodeURIComponent(name)}`, { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error(`Failed to get Sprites URL: API error (${res.status})`);
        const data = await res.json() as Record<string, any>;
        const protocol = options.protocol || 'https';
        return `${protocol}://${(data.url || '').replace(/^https?:\/\//, '')}`;
      },

      filesystem: {
        readFile: async (sandbox: SpritesSandbox, filePath: string): Promise<string> => {
          const url = new URL(`${sandbox._baseUrl}/sprites/${encodeURIComponent(sandbox.name)}/fs/read`);
          url.searchParams.set('path', filePath); url.searchParams.set('workingDir', '/');
          const res = await fetch(url.toString(), { method: 'GET', headers: { 'Authorization': `Bearer ${sandbox._token}` } });
          if (!res.ok) throw new Error(`Failed to read file: API error (${res.status})`);
          return res.text();
        },
        writeFile: async (sandbox: SpritesSandbox, filePath: string, content: string): Promise<void> => {
          const url = new URL(`${sandbox._baseUrl}/sprites/${encodeURIComponent(sandbox.name)}/fs/write`);
          url.searchParams.set('path', filePath); url.searchParams.set('workingDir', '/'); url.searchParams.set('mkdir', 'true');
          const res = await fetch(url.toString(), { method: 'PUT', headers: { 'Authorization': `Bearer ${sandbox._token}`, 'Content-Type': 'application/octet-stream' }, body: content });
          if (!res.ok) throw new Error(`Failed to write file: API error (${res.status})`);
        },
        mkdir: async (sandbox: SpritesSandbox, dirPath: string): Promise<void> => {
          const url = new URL(`${sandbox._baseUrl}/sprites/${encodeURIComponent(sandbox.name)}/fs/write`);
          url.searchParams.set('path', `${dirPath}/.keep`); url.searchParams.set('workingDir', '/'); url.searchParams.set('mkdir', 'true');
          const res = await fetch(url.toString(), { method: 'PUT', headers: { 'Authorization': `Bearer ${sandbox._token}`, 'Content-Type': 'application/octet-stream' }, body: '' });
          if (!res.ok) throw new Error(`Failed to create directory: API error (${res.status})`);
        },
        readdir: async (sandbox: SpritesSandbox, dirPath: string): Promise<FileEntry[]> => {
          const url = new URL(`${sandbox._baseUrl}/sprites/${encodeURIComponent(sandbox.name)}/fs/list`);
          url.searchParams.set('path', dirPath); url.searchParams.set('workingDir', '/');
          const res = await fetch(url.toString(), { method: 'GET', headers: { 'Authorization': `Bearer ${sandbox._token}` } });
          if (!res.ok) throw new Error(`Failed to list directory: API error (${res.status})`);
          const data = await res.json() as { entries: any[]; count: number };
          return (data.entries || []).map((entry: any) => ({ name: entry.name, type: entry.isDir || entry.type === 'directory' ? 'directory' as const : 'file' as const, size: entry.size || 0, modified: new Date(entry.modified || entry.modTime || Date.now()) }));
        },
        exists: async (sandbox: SpritesSandbox, filePath: string): Promise<boolean> => {
          const fileUrl = new URL(`${sandbox._baseUrl}/sprites/${encodeURIComponent(sandbox.name)}/fs/read`);
          fileUrl.searchParams.set('path', filePath); fileUrl.searchParams.set('workingDir', '/');
          const fileRes = await fetch(fileUrl.toString(), { method: 'GET', headers: { 'Authorization': `Bearer ${sandbox._token}` } });
          if (fileRes.ok) return true;
          const dirUrl = new URL(`${sandbox._baseUrl}/sprites/${encodeURIComponent(sandbox.name)}/fs/list`);
          dirUrl.searchParams.set('path', filePath); dirUrl.searchParams.set('workingDir', '/');
          const dirRes = await fetch(dirUrl.toString(), { method: 'GET', headers: { 'Authorization': `Bearer ${sandbox._token}` } });
          return dirRes.ok;
        },
        remove: async (sandbox: SpritesSandbox, filePath: string): Promise<void> => {
          const url = new URL(`${sandbox._baseUrl}/sprites/${encodeURIComponent(sandbox.name)}/fs/delete`);
          url.searchParams.set('path', filePath); url.searchParams.set('workingDir', '/');
          const res = await fetch(url.toString(), { method: 'DELETE', headers: { 'Authorization': `Bearer ${sandbox._token}` } });
          if (!res.ok) throw new Error(`Failed to delete file: API error (${res.status})`);
        }
      },

      getInstance: (sandbox: SpritesSandbox): SpritesSandbox => sandbox,
    }
  }
});
