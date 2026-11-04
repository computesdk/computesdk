/**
 * Sprites Provider - Factory-based Implementation
 */

import { randomUUID } from 'node:crypto';

import { defineProvider, escapeShellArg } from '@computesdk/provider';
import WebSocket, { type RawData } from 'ws';

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

type SafeFieldShape = {
  present: boolean;
  type: 'undefined' | 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object';
  numericRange?: 'zero' | 'nonzero-byte' | 'outside-byte' | 'non-integer';
};
type ProtocolDiagnostic = {
  phase: 'text-json' | 'text-kind' | 'binary-frame' | 'transport-exit';
  kind?: 'exit' | 'session_info' | 'error' | 'other' | 'non-object' | 'invalid-json';
  afterExit: boolean;
  fields?: {
    type: SafeFieldShape; exit_code: SafeFieldShape; exitCode: SafeFieldShape;
    code: SafeFieldShape; tty: SafeFieldShape; error: SafeFieldShape;
  };
  channel?: 'stdin' | 'stdout' | 'stderr' | 'exit' | 'eof' | 'other' | 'empty';
  exitPayload?: 'missing' | 'one-byte' | 'oversized';
  exitRange?: SafeFieldShape['numericRange'];
};

// Only fixed field names, type labels and bounded exit-code classifications.
// Never copy keys, values, JSON, output or provider error messages into errors.
function fieldShape(record: object, key: 'type' | 'exit_code' | 'exitCode' | 'code' | 'tty' | 'error'): SafeFieldShape {
  const value: unknown = (record as Record<string, unknown>)[key];
  const shape: SafeFieldShape = {
    present: Object.prototype.hasOwnProperty.call(record, key),
    type: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value as SafeFieldShape['type'],
  };
  if (typeof value === 'number' && key !== 'type' && key !== 'tty' && key !== 'error') {
    shape.numericRange = !Number.isInteger(value) ? 'non-integer' :
      value < 0 || value > 255 ? 'outside-byte' : value === 0 ? 'zero' : 'nonzero-byte';
  }
  return shape;
}

/** The exec stream ended without trustworthy child completion metadata. */
export class SpritesCommandProtocolError extends Error {
  readonly code = 'SPRITES_COMMAND_PROTOCOL_ERROR';
  readonly provider = 'sprites';

  constructor(readonly reason: 'missing-completion' | 'invalid-completion', readonly diagnostic?: ProtocolDiagnostic) {
    // Do not include command output: it may contain credentials or other secrets.
    super(`Sprites command response did not contain a valid completion record.${diagnostic ? ` ${JSON.stringify(diagnostic)}` : ''}`);
    this.name = 'SpritesCommandProtocolError';
  }
}

/** Non-TTY WebSocket messages preserve channel boundaries; HTTP exec does not. */
async function execStream(url: URL, token: string, script: string): Promise<{ stdout: string; stderr: string }> {
  // Public protocol: superfly/sprites-go@5b9403bdc2468901b7c13c353e8b8592c459de81,
  // websocket.go: StreamStdin=0, Stdout=1, Stderr=2, Exit=3, StdinEOF=4.
  // Text session_info/control notifications and {type:"exit",exit_code:n}
  // are handled separately from binary data. Never decode each UTF-8 chunk.
  return new Promise((resolve, reject) => {
    let socket: WebSocket;
    try {
      socket = new WebSocket(url, {
        headers: { Authorization: `Bearer ${token}` },
        followRedirects: false,
        // Bound a peer that never completes the upgrade, not remote execution.
        handshakeTimeout: 10_000,
      });
    } catch {
      reject(new Error('Sprites command transport failed.'));
      return;
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let exit: number | undefined;
    let settled = false;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (closeTimer) clearTimeout(closeTimer);
      socket.removeAllListeners();
      if (socket.readyState !== WebSocket.CLOSED) {
        // terminate() can emit an asynchronous error while connecting.
        socket.on('error', () => {});
        socket.once('close', () => socket.removeAllListeners());
        socket.terminate();
      }
      if (error) reject(error);
      else resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    };
    const invalid = (diagnostic: ProtocolDiagnostic) => finish(new SpritesCommandProtocolError('invalid-completion', diagnostic));
    const complete = (code: unknown, diagnostic: ProtocolDiagnostic) => {
      // The shell wrapper must finish normally; its own footer carries the
      // user's child status, which can legitimately be nonzero.
      if (!Number.isInteger(code) || code !== 0) return invalid(diagnostic);
      // Official Go supports both text and binary exit formats; Native proved
      // they can both confirm the same zero completion. Idempotent confirmation
      // never resets the close bound or replaces the independent child status.
      if (exit !== undefined) return;
      exit = code as number;
      // Wait for close to detect queued contradictory exit messages.
      // Bound only the close handshake, not remote command execution.
      closeTimer = setTimeout(() => finish(), 1_000);
      closeTimer.unref();
      socket.close();
    };
    socket.on('open', () => {
      try {
        socket.send(Buffer.concat([Buffer.from([0]), Buffer.from(script, 'utf8')]));
        socket.send(Buffer.from([4]));
      } catch {
        finish(new Error('Sprites command transport failed.'));
      }
    });
    socket.on('message', (data: RawData, isBinary: boolean) => {
      if (settled) return;
      const bytes = Buffer.isBuffer(data) ? data :
        Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
      if (!isBinary) {
        const text = bytes.toString('utf8');
        if (text.startsWith('control:')) return;
        let message: { type?: string; exit_code?: unknown; tty?: unknown };
        try { message = JSON.parse(text); } catch {
          return invalid({ phase: 'text-json', kind: 'invalid-json', afterExit: exit !== undefined });
        }
        if (!message || typeof message !== 'object' || Array.isArray(message)) {
          return invalid({ phase: 'text-json', kind: 'non-object', afterExit: exit !== undefined });
        }
        const diagnostic: ProtocolDiagnostic = {
          phase: 'text-kind', afterExit: exit !== undefined,
          kind: message.type === 'exit' || message.type === 'session_info' || message.type === 'error' ? message.type : 'other',
          fields: {
            type: fieldShape(message, 'type'), exit_code: fieldShape(message, 'exit_code'),
            exitCode: fieldShape(message, 'exitCode'), code: fieldShape(message, 'code'),
            tty: fieldShape(message, 'tty'), error: fieldShape(message, 'error'),
          },
        };
        if (message.type === 'exit') return complete(message.exit_code, diagnostic);
        if (message.type === 'session_info' && message.tty === true) return invalid(diagnostic);
        if (message.type === 'error') return invalid(diagnostic);
        // sprites-go@5b9403bdc2468901b7c13c353e8b8592c459de81 websocket.go
        // non-PTY TextMessage branch (575-627): other notifications go only to
        // the optional TextMessageHandler, never stdout/stderr or completion.
        // Native diagnostics confirmed such a string-typed notification before
        // any exit. Ignore metadata on either side of exit, but still require
        // the actual transport exit AND the independent shell child footer.
        if (typeof message.type === 'string') return;
        // Do not expose server errors, metadata, URLs, or command/env contents.
        return invalid(diagnostic);
      }
      const diagnostic: ProtocolDiagnostic = {
        phase: 'binary-frame', afterExit: exit !== undefined,
        channel: bytes.length === 0 ? 'empty' :
          ({ 0: 'stdin', 1: 'stdout', 2: 'stderr', 3: 'exit', 4: 'eof' } as const)[bytes[0] as 0 | 1 | 2 | 3 | 4] || 'other',
      };
      if (bytes[0] === 3) {
        diagnostic.exitPayload = bytes.length === 1 ? 'missing' : bytes.length === 2 ? 'one-byte' : 'oversized';
        if (bytes.length === 2) diagnostic.exitRange = bytes[1] === 0 ? 'zero' : 'nonzero-byte';
      }
      if (bytes.length === 0 || (exit !== undefined && bytes[0] !== 3)) return invalid(diagnostic);
      switch (bytes[0]) {
        case 1: stdout.push(bytes.subarray(1)); break;
        case 2: stderr.push(bytes.subarray(1)); break;
        case 3:
          if (bytes.length !== 2) return invalid(diagnostic);
          complete(bytes[1], diagnostic);
          break;
        default: invalid(diagnostic);
      }
    });
    socket.on('error', () => finish(new Error('Sprites command transport failed.')));
    socket.on('close', () => {
      if (exit === undefined) finish(new SpritesCommandProtocolError('missing-completion'));
      else finish();
    });
  });
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
        const res = await fetch(`${baseUrl}/sprites/${encodeURIComponent(sandboxId)}`, { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } });
        // The public V1 API defines 404 as "Sprite not found"; other HTTP
        // failures, rejected fetches and decoding errors are not absence.
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`Sprites API error (${res.status})`);
        const data = await res.json() as SpritesSandbox;
        if (!data || data.name !== sandboxId) throw new Error('Sprites sandbox identity mismatch');
        data._token = token; data._baseUrl = baseUrl;
        return { instance: data, instanceId: data.name };
      },

      list: async (config: SpritesConfig) => {
        const token = config.apiKey || (typeof process !== 'undefined' && process.env?.SPRITES_TOKEN) || '';
        const baseUrl = config.baseUrl || 'https://api.sprites.dev/v1';
        try {
          const res = await fetch(`${baseUrl}/sprites`, { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } });
          if (!res.ok) return [];
          const data = await res.json() as SpritesSandbox[];
          return data.map((sprite: SpritesSandbox) => { sprite._token = token; sprite._baseUrl = baseUrl; return { instance: sprite, instanceId: sprite.name }; });
        } catch { return []; }
      },

      destroy: async (config: SpritesConfig, sandboxId: string) => {
        const token = config.apiKey || (typeof process !== 'undefined' && process.env?.SPRITES_TOKEN) || '';
        const baseUrl = config.baseUrl || 'https://api.sprites.dev/v1';
        const res = await fetch(`${baseUrl}/sprites/${encodeURIComponent(sandboxId)}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
        // DELETE's documented 404 proves it is already absent, not that a
        // failed authentication/transport operation successfully deleted it.
        if (!res.ok && res.status !== 404) throw new Error(`Sprites API error (${res.status})`);
      },

      runCommand: async (sandbox: SpritesSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const token = sandbox._token;
        const baseUrl = sandbox._baseUrl;
        const name = sandbox.name;
        const startTime = Date.now();

        const commandId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const delimiter = `__COMPUTESDK_EXIT_${commandId}__`;
        const errDelimiter = `__COMPUTESDK_STDERR_${commandId}__`;
        let shellCmd = command;

        if (options?.cwd) shellCmd = `cd "${escapeShellArg(options.cwd)}" || exit $?\n${shellCmd}`;
        if (options?.env) {
          const safeKeyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
          const envPrefix = Object.entries(options.env).map(([k, v]) => {
            if (!safeKeyPattern.test(k)) throw new Error(`Invalid environment variable name: ${k}`);
            return `export ${k}="${escapeShellArg(v)}"`;
          }).join('\n');
          shellCmd = `${envPrefix}\n${shellCmd}`;
        }

        // Keep the strict existing shell completion/stderr envelope even though
        // WebSocket also separates transport stdout/stderr. Newlines preserve
        // comments/heredocs/trailing &, and the
        // subshell keeps a user `exit` from skipping completion and cleanup.
        // This framing does not implement remote timeout/cancellation.
        const errFile = `/tmp/.computesdk-stderr-${commandId}`;
        // Bash receives this source on stdin. Parse the entire outer compound
        // before executing: stdin readers must see EOF, not consume the
        // completion/cleanup source after the command's inner subshell.
        shellCmd = `{\n(\n${shellCmd}\n) 2>"${escapeShellArg(errFile)}"\n__sp_ec=$?\nprintf '%s%s\\n' "${delimiter}" "$__sp_ec"\nprintf '%s\\n' "${errDelimiter}"\ncat "${escapeShellArg(errFile)}" 2>/dev/null\nrm -f "${escapeShellArg(errFile)}"\n}\n`;

        const url = new URL(`${baseUrl}/sprites/${encodeURIComponent(name)}/exec`);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        url.searchParams.set('cmd', 'bash');
        url.searchParams.set('stdin', 'true');

        try {
          const transport = await execStream(url, token, shellCmd);
          const raw = transport.stdout;

          const delimIdx = raw.lastIndexOf(delimiter);
          if (delimIdx === -1) {
            throw new SpritesCommandProtocolError('missing-completion');
          }
          const stdout = raw.substring(0, delimIdx);
          const after = raw.substring(delimIdx + delimiter.length);
          const nlIdx = after.indexOf('\n');
          const status = nlIdx === -1 ? '' : after.substring(0, nlIdx);
          const rest = nlIdx === -1 ? '' : after.substring(nlIdx + 1);
          const stderrHeader = `${errDelimiter}\n`;
          if (!/^\d{1,3}$/.test(status) || Number(status) > 255 || !rest.startsWith(stderrHeader)) {
            throw new SpritesCommandProtocolError('invalid-completion');
          }
          const exitCode = Number(status);
          const stderr = rest.substring(stderrHeader.length) + transport.stderr;
          return { stdout, stderr, exitCode, durationMs: Date.now() - startTime };
        } catch (error) {
          if (error instanceof SpritesCommandProtocolError) throw error;
          return { stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 127, durationMs: Date.now() - startTime };
        }
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
