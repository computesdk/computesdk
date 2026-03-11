/**
 * Sprites Provider - Factory-based Implementation
 *
 * Cloud sandbox provider using the factory pattern.
 * API methods are stubbed and ready to be wired up.
 */

import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type { Runtime, CodeResult, CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

/**
 * Sprites sandbox instance returned from the API
 */
export interface SpritesSandbox {
  id: string;
  status: string;
  [key: string]: any;
}

/**
 * Sprites-specific configuration options
 */
export interface SpritesConfig {
  /** Sprites API token - if not provided, will fallback to SPRITES_TOKEN environment variable */
  apiKey?: string;
  /** Base URL for the Sprites API */
  baseUrl?: string;
  /** Default runtime environment */
  runtime?: Runtime;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

/**
 * Create a Sprites provider instance using the factory pattern
 */
export const sprites = defineProvider<SpritesSandbox, SpritesConfig>({
  name: 'sprites',
  methods: {
    sandbox: {
      // Collection operations (map to compute.sandbox.*)
      create: async (config: SpritesConfig, options?: CreateSandboxOptions) => {
        const token = config.apiKey || (typeof process !== 'undefined' && process.env?.SPRITES_TOKEN) || '';
        const baseUrl = config.baseUrl || 'https://api.sprites.dev/v1';

        if (!token) {
          throw new Error(
            `Missing Sprites API token. Provide 'apiKey' in config or set SPRITES_TOKEN environment variable.`
          );
        }

        try {
          const body: Record<string, any> = {
            name: options?.sandboxId || `sprite-${Date.now()}`,
            url_settings: { auth: 'public' },
          };

          const res = await fetch(`${baseUrl}/sprites`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          });

          if (!res.ok) {
            const text = await res.text();
            throw new Error(`Sprites API error (${res.status}): ${text}`);
          }

          const data = await res.json() as SpritesSandbox;

          // Attach token and baseUrl so instance methods can use them
          data._token = token;
          data._baseUrl = baseUrl;

          return {
            sandbox: data,
            sandboxId: data.name,
          };
        } catch (error) {
          if (error instanceof Error && error.message.includes('Sprites API error')) {
            throw error;
          }
          throw new Error(
            `Failed to create Sprites sandbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: SpritesConfig, sandboxId: string) => {
        const token = config.apiKey || (typeof process !== 'undefined' && process.env?.SPRITES_TOKEN) || '';
        const baseUrl = config.baseUrl || 'https://api.sprites.dev/v1';

        try {
          const res = await fetch(`${baseUrl}/sprites/${encodeURIComponent(sandboxId)}`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });

          if (!res.ok) {
            return null;
          }

          const data = await res.json() as SpritesSandbox;
          data._token = token;
          data._baseUrl = baseUrl;

          return {
            sandbox: data,
            sandboxId: data.name,
          };
        } catch (error) {
          return null;
        }
      },

      list: async (config: SpritesConfig) => {
        const token = config.apiKey || (typeof process !== 'undefined' && process.env?.SPRITES_TOKEN) || '';
        const baseUrl = config.baseUrl || 'https://api.sprites.dev/v1';

        try {
          const res = await fetch(`${baseUrl}/sprites`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });

          if (!res.ok) {
            return [];
          }

          const data = await res.json() as SpritesSandbox[];
          return data.map((sprite: SpritesSandbox) => ({
            sandbox: sprite,
            sandboxId: sprite.name,
          }));
        } catch (error) {
          return [];
        }
      },

      destroy: async (config: SpritesConfig, sandboxId: string) => {
        const token = config.apiKey || (typeof process !== 'undefined' && process.env?.SPRITES_TOKEN) || '';
        const baseUrl = config.baseUrl || 'https://api.sprites.dev/v1';

        try {
          await fetch(`${baseUrl}/sprites/${encodeURIComponent(sandboxId)}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });
        } catch (error) {
          // Sprite might already be destroyed or doesn't exist
        }
      },

      // Instance operations (map to individual Sandbox methods)
      runCode: async (sandbox: SpritesSandbox, code: string, runtime?: Runtime): Promise<CodeResult> => {
        const token = sandbox._token;
        const baseUrl = sandbox._baseUrl;
        const name = sandbox.name;

        // Auto-detect runtime if not specified
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

        // Use base64 encoding to safely pass code via shell
        const encoded = Buffer.from(code).toString('base64');
        const shellCmd = effectiveRuntime === 'python'
          ? `echo "${encoded}" | base64 -d | python3`
          : `echo "${encoded}" | base64 -d | node`;

        const url = new URL(`${baseUrl}/sprites/${encodeURIComponent(name)}/exec`);
        url.searchParams.set('cmd', 'bash');
        url.searchParams.set('stdin', 'true');

        try {
          const res = await fetch(url.toString(), {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'text/plain',
            },
            body: shellCmd,
          });

          const output = await res.text();

          if (!res.ok) {
            if (output.includes('SyntaxError') || output.includes('invalid syntax') ||
                output.includes('Unexpected token') || output.includes('Unexpected identifier')) {
              throw new Error(`Syntax error: ${output.trim()}`);
            }
          }

          return {
            output,
            exitCode: res.ok ? 0 : 1,
            language: effectiveRuntime,
          };
        } catch (error) {
          if (error instanceof Error && error.message.includes('Syntax error')) {
            throw error;
          }
          throw new Error(
            `Sprites execution failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      runCommand: async (sandbox: SpritesSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const token = sandbox._token;
        const baseUrl = sandbox._baseUrl;
        const name = sandbox.name;
        const startTime = Date.now();

        const url = new URL(`${baseUrl}/sprites/${encodeURIComponent(name)}/exec`);

        // Split command into cmd + args for query params
        const parts = command.split(' ');
        parts.forEach(part => url.searchParams.append('cmd', part));

        if (options?.cwd) {
          url.searchParams.set('dir', options.cwd);
        }

        if (options?.env) {
          Object.entries(options.env).forEach(([k, v]) => {
            url.searchParams.append('env', `${k}=${v}`);
          });
        }

        try {
          const res = await fetch(url.toString(), {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });

          const output = await res.text();

          return {
            stdout: res.ok ? output : '',
            stderr: res.ok ? '' : output,
            exitCode: res.ok ? 0 : 1,
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

      getInfo: async (sandbox: SpritesSandbox): Promise<SandboxInfo> => {
        const token = sandbox._token;
        const baseUrl = sandbox._baseUrl;
        const name = sandbox.name;

        try {
          const res = await fetch(`${baseUrl}/sprites/${encodeURIComponent(name)}`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });

          if (!res.ok) {
            throw new Error(`Sprites API error (${res.status})`);
          }

          const data = await res.json() as Record<string, any>;

          return {
            id: data.id || name,
            provider: 'sprites',
            runtime: 'python',
            status: data.status === 'running' ? 'running' : data.status === 'warm' ? 'running' : 'stopped',
            createdAt: new Date(data.created_at),
            timeout: 300000,
            metadata: {
              name: data.name,
              organization: data.organization,
              url: data.url,
              urlSettings: data.url_settings,
              lastStartedAt: data.last_started_at,
              lastActiveAt: data.last_active_at,
            },
          };
        } catch (error) {
          throw new Error(
            `Failed to get Sprites info: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getUrl: async (sandbox: SpritesSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        // The sprite object has a `url` field from the API response.
        // For port-specific access, the proxy WebSocket is at /v1/sprites/{name}/proxy
        // but for HTTP access the sprite's url field is the public endpoint.
        if (sandbox.url) {
          const protocol = options.protocol || 'https';
          const baseHost = sandbox.url.replace(/^https?:\/\//, '');
          return `${protocol}://${baseHost}`;
        }

        // Fallback: fetch fresh sprite data to get the url
        const token = sandbox._token;
        const baseUrl = sandbox._baseUrl;
        const name = sandbox.name;

        const res = await fetch(`${baseUrl}/sprites/${encodeURIComponent(name)}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (!res.ok) {
          throw new Error(`Failed to get Sprites URL: API error (${res.status})`);
        }

        const data = await res.json() as Record<string, any>;
        const protocol = options.protocol || 'https';
        const host = (data.url || '').replace(/^https?:\/\//, '');
        return `${protocol}://${host}`;
      },

      // Optional filesystem methods
      filesystem: {
        readFile: async (sandbox: SpritesSandbox, filePath: string): Promise<string> => {
          const token = sandbox._token;
          const baseUrl = sandbox._baseUrl;
          const name = sandbox.name;

          const url = new URL(`${baseUrl}/sprites/${encodeURIComponent(name)}/fs/read`);
          url.searchParams.set('path', filePath);
          url.searchParams.set('workingDir', '/');

          const res = await fetch(url.toString(), {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });

          if (!res.ok) {
            throw new Error(`Failed to read file: API error (${res.status})`);
          }

          return await res.text();
        },

        writeFile: async (sandbox: SpritesSandbox, filePath: string, content: string): Promise<void> => {
          const token = sandbox._token;
          const baseUrl = sandbox._baseUrl;
          const name = sandbox.name;

          const url = new URL(`${baseUrl}/sprites/${encodeURIComponent(name)}/fs/write`);
          url.searchParams.set('path', filePath);
          url.searchParams.set('workingDir', '/');
          url.searchParams.set('mkdir', 'true');

          const res = await fetch(url.toString(), {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/octet-stream',
            },
            body: content,
          });

          if (!res.ok) {
            throw new Error(`Failed to write file: API error (${res.status})`);
          }
        },

        mkdir: async (sandbox: SpritesSandbox, dirPath: string): Promise<void> => {
          const token = sandbox._token;
          const baseUrl = sandbox._baseUrl;
          const name = sandbox.name;

          // Use writeFile with mkdir=true to create a placeholder, ensuring the directory exists
          // Alternatively, write an empty .keep file in the directory
          const url = new URL(`${baseUrl}/sprites/${encodeURIComponent(name)}/fs/write`);
          url.searchParams.set('path', `${dirPath}/.keep`);
          url.searchParams.set('workingDir', '/');
          url.searchParams.set('mkdir', 'true');

          const res = await fetch(url.toString(), {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/octet-stream',
            },
            body: '',
          });

          if (!res.ok) {
            throw new Error(`Failed to create directory: API error (${res.status})`);
          }
        },

        readdir: async (sandbox: SpritesSandbox, dirPath: string): Promise<FileEntry[]> => {
          const token = sandbox._token;
          const baseUrl = sandbox._baseUrl;
          const name = sandbox.name;

          const url = new URL(`${baseUrl}/sprites/${encodeURIComponent(name)}/fs/list`);
          url.searchParams.set('path', dirPath);
          url.searchParams.set('workingDir', '/');

          const res = await fetch(url.toString(), {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });

          if (!res.ok) {
            throw new Error(`Failed to list directory: API error (${res.status})`);
          }

          const data = await res.json() as { entries: any[]; count: number };
          return (data.entries || []).map((entry: any) => ({
            name: entry.name,
            type: entry.isDir || entry.type === 'directory' ? 'directory' as const : 'file' as const,
            size: entry.size || 0,
            modified: new Date(entry.modified || entry.modTime || Date.now()),
          }));
        },

        exists: async (sandbox: SpritesSandbox, filePath: string): Promise<boolean> => {
          const token = sandbox._token;
          const baseUrl = sandbox._baseUrl;
          const name = sandbox.name;

          // No dedicated exists endpoint; try reading the file
          const url = new URL(`${baseUrl}/sprites/${encodeURIComponent(name)}/fs/read`);
          url.searchParams.set('path', filePath);
          url.searchParams.set('workingDir', '/');

          const res = await fetch(url.toString(), {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });

          return res.ok;
        },

        remove: async (sandbox: SpritesSandbox, filePath: string): Promise<void> => {
          const token = sandbox._token;
          const baseUrl = sandbox._baseUrl;
          const name = sandbox.name;

          const url = new URL(`${baseUrl}/sprites/${encodeURIComponent(name)}/fs/delete`);
          url.searchParams.set('path', filePath);
          url.searchParams.set('workingDir', '/');

          const res = await fetch(url.toString(), {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });

          if (!res.ok) {
            throw new Error(`Failed to delete file: API error (${res.status})`);
          }
        }
      },

      getInstance: (sandbox: SpritesSandbox): SpritesSandbox => {
        return sandbox;
      },
    }
  }
});
