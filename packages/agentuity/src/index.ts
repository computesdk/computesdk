/**
 * Agentuity Provider - Factory-based Implementation
 *
 * Full-featured provider with native filesystem support using the factory pattern.
 * Agentuity provides isolated cloud sandboxes with full Linux environments,
 * snapshot/checkpoint support, and flexible runtimes (bun, python, node, etc.).
 *
 * Features:
 * - Native filesystem API (read, write, list, mkdir, rm)
 * - Code execution in Python, JavaScript/Bun, Bash
 * - Shell command execution
 * - Snapshot and checkpoint lifecycle management
 * - Pause/resume sandbox support
 * - Stream URLs for stdout/stderr
 */

import { defineProvider, escapeShellArg } from '@computesdk/provider';
import type {
    CodeResult,
    CommandResult,
    SandboxInfo,
    Runtime,
    CreateSandboxOptions,
    FileEntry,
    RunCommandOptions,
} from 'computesdk';

type RunCommandFn = (sandbox: AgentuityHandle, command: string, options?: RunCommandOptions) => Promise<CommandResult>;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Agentuity-specific configuration options
 */
export interface AgentuityConfig {
    /** Agentuity SDK key — falls back to AGENTUITY_SDK_KEY env var */
    apiKey?: string;
    /**
     * Region for API endpoints.
     * - "local"  → https://catalyst.agentuity.io
     * - "usc"    → https://catalyst-usc.agentuity.cloud  (default)
     * - or a full custom base URL
     */
    region?: string;
    /** Override the sandbox base URL entirely */
    baseURL?: string;
    /** Default runtime, e.g. "bun:1", "python:3.14", "node:22" */
    runtime?: string;
    /** Idle timeout passed to the sandbox (e.g. "5m", "1h") */
    idleTimeout?: string;
    /** Execution timeout passed to the sandbox (e.g. "30m", "2h") */
    executionTimeout?: string;
}

/**
 * Minimal representation of an Agentuity sandbox handle.
 * We carry only what we need to make subsequent API calls.
 */
export interface AgentuityHandle {
    sandboxId: string;
    apiKey: string;
    baseURL: string;
    stdoutStreamUrl?: string;
    stderrStreamUrl?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveBaseURL(config: AgentuityConfig): string {
    if (config.baseURL) return config.baseURL.replace(/\/$/, '');
    // Check env override (matches @agentuity/core behavior)
    const envUrl = typeof process !== 'undefined'
        ? (process.env?.AGENTUITY_SANDBOX_URL || process.env?.AGENTUITY_TRANSPORT_URL || process.env?.AGENTUITY_CATALYST_URL)
        : undefined;
    if (envUrl) return envUrl.replace(/\/$/, '');

    const region = config.region ?? (
        typeof process !== 'undefined' ? process.env?.AGENTUITY_REGION : undefined
    ) ?? 'usc';

    // Local dev uses .agentuity.io domain
    if (region === 'local' || region === 'l') return 'https://catalyst.agentuity.io';
    // Allow passing a full URL as the region string
    if (region.startsWith('http')) return region.replace(/\/$/, '');
    // Production: https://catalyst-{region}.agentuity.cloud
    return `https://catalyst-${region}.agentuity.cloud`;
}

function resolveApiKey(config: AgentuityConfig): string {
    return config.apiKey
        ?? (typeof process !== 'undefined' ? process.env?.AGENTUITY_SDK_KEY : undefined)
        ?? '';
}

async function agentuityFetch(
    handle: { apiKey: string; baseURL: string },
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
): Promise<Response> {
    const url = `${handle.baseURL}${path}`;
    const headers: Record<string, string> = {
        Authorization: `Bearer ${handle.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...extraHeaders,
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    return fetch(url, init);
}

/**
 * Unwrap Agentuity API envelope: { success: true, data: T } → T
 * Falls back to the raw body if no envelope is present.
 */
function unwrapResponse<T>(body: any): T {
    if (body && typeof body === 'object' && 'success' in body && 'data' in body) {
        return body.data as T;
    }
    return body as T;
}

/**
 * Encode a string as base64 — works in both Node/Bun and browser environments.
 */
function toBase64(content: string): string {
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(content).toString('base64');
    }
    return btoa(unescape(encodeURIComponent(content)));
}

/**
 * Decode base64 to string — works in both Node/Bun and browser environments.
 */
function fromBase64(b64: string): string {
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(b64, 'base64').toString('utf-8');
    }
    return decodeURIComponent(escape(atob(b64)));
}

/**
 * Map a ComputeSDK Runtime to an Agentuity runtime string.
 */
function toAgentuityRuntime(runtime?: Runtime | string): string {
    if (!runtime) return 'bun:1';
    switch (runtime) {
        // Agentuity's JS runtime is bun — map node requests to bun
        case 'node': return 'bun:1';
        case 'python': return 'python:3.14';
        case 'bun': return 'bun:1';
        default:
            // Pass-through for explicit strings like "python:3.11", "bun:1", etc.
            return runtime as string;
    }
}

function fromAgentuityRuntime(name?: string): Runtime {
    if (!name) return 'node';
    if (name.startsWith('bun')) return 'node';
    if (name.startsWith('python')) return 'python';
    if (name.startsWith('node')) return 'node';
    if (name.startsWith('deno')) return 'deno';
    return 'node';
}

/**
 * Build a small script that wraps user code for a specific language,
 * writes it to a temp file, and executes it.
 * Returns { command, filename } for the execute payload.
 */
function buildCodeCommand(
    code: string,
    runtime: Runtime | string,
): { exec: string[]; filename: string } {
    const effectiveRuntime = runtime || autoDetectRuntime(code);
    if (effectiveRuntime === 'python') {
        return { exec: ['python3', '/tmp/_compute_run.py'], filename: '/tmp/_compute_run.py' };
    }
    // Default: bun (fastest) or node
    return { exec: ['bun', 'run', '/tmp/_compute_run.js'], filename: '/tmp/_compute_run.js' };
}

function autoDetectRuntime(code: string): Runtime {
    const looksLikePython =
        code.includes('print(') ||
        code.includes('import ') ||
        code.includes('def ') ||
        code.includes('sys.') ||
        code.includes('json.') ||
        code.includes('__') ||
        code.includes("f'") ||
        code.includes('f"') ||
        code.includes('raise ');
    return looksLikePython ? 'python' : 'node';
}

/**
 * Poll GET /sandbox/execution/{executionId} until status is terminal or timeout.
 * Uses the `wait` long-poll parameter (server-side blocking up to 60 s per call).
 */
async function waitForExecution(
    handle: { apiKey: string; baseURL: string },
    executionId: string,
    totalTimeoutMs = 120_000,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const deadline = Date.now() + totalTimeoutMs;

    while (Date.now() < deadline) {
        const res = await agentuityFetch(
            handle,
            'GET',
            `/sandbox/execution/${executionId}?wait=30s`,
        );

        if (!res.ok) {
            throw new Error(`Agentuity: failed to poll execution ${executionId}: ${res.status}`);
        }

        const data = unwrapResponse<{
            status: string;
            exitCode?: number;
            stdout?: string;
            stderr?: string;
            stdoutStreamUrl?: string;
            stderrStreamUrl?: string;
        }>(await res.json());

        const terminal = ['completed', 'failed', 'terminated', 'error'].includes(data.status);
        if (terminal) {
            // Fetch stream content if we only got URLs
            let stdout = data.stdout ?? '';
            let stderr = data.stderr ?? '';

            if (!stdout && data.stdoutStreamUrl) {
                try {
                    const r = await fetch(data.stdoutStreamUrl);
                    stdout = await r.text();
                } catch { /* best-effort */ }
            }
            if (!stderr && data.stderrStreamUrl) {
                try {
                    const r = await fetch(data.stderrStreamUrl);
                    stderr = await r.text();
                } catch { /* best-effort */ }
            }

            return { exitCode: data.exitCode ?? 0, stdout, stderr };
        }

        // Status is still pending/running — the server long-polled 30 s already;
        // loop immediately for another round.
    }

    throw new Error(`Agentuity: execution ${executionId} timed out after ${totalTimeoutMs}ms`);
}

// ─── Provider Definition ──────────────────────────────────────────────────────

export const agentuity = defineProvider<AgentuityHandle, AgentuityConfig>({
    name: 'agentuity',
    methods: {
        sandbox: {
            // ── Lifecycle ─────────────────────────────────────────────────────

            /**
             * Create a new Agentuity sandbox.
             *
             * POST /sandbox
             */
            create: async (
                config: AgentuityConfig,
                options?: CreateSandboxOptions,
            ): Promise<{ sandbox: AgentuityHandle; sandboxId: string }> => {
                const apiKey = resolveApiKey(config);
                if (!apiKey) {
                    throw new Error(
                        'Missing Agentuity API key. Provide `apiKey` in config or set the ' +
                        'AGENTUITY_SDK_KEY environment variable. ' +
                        'You can find your key in the Agentuity Console under project settings.',
                    );
                }

                const baseURL = resolveBaseURL(config);
                const handle = { apiKey, baseURL };

                const runtime = toAgentuityRuntime(
                    (options as any)?.runtime ?? config.runtime,
                );

                const body: Record<string, unknown> = { runtime };
                if (options?.envs) body.env = options.envs;
                if ((options as any)?.name) body.name = (options as any).name;
                const idleTimeout = (options as any)?.idleTimeout ?? config.idleTimeout;
                const executionTimeout = (options as any)?.executionTimeout ?? config.executionTimeout;
                if (idleTimeout || executionTimeout) {
                    body.timeout = {
                        ...(idleTimeout ? { idle: idleTimeout } : {}),
                        ...(executionTimeout ? { execution: executionTimeout } : {}),
                    };
                }

                const res = await agentuityFetch(handle, 'POST', '/sandbox', body);

                if (!res.ok) {
                    const text = await res.text().catch(() => '');
                    if (res.status === 401) {
                        throw new Error(
                            'Agentuity authentication failed. Please check your AGENTUITY_SDK_KEY.',
                        );
                    }
                    throw new Error(`Agentuity: failed to create sandbox (${res.status}): ${text}`);
                }

                const data = unwrapResponse<{
                    sandboxId: string;
                    status: string;
                    stdoutStreamUrl?: string;
                    stderrStreamUrl?: string;
                }>(await res.json());

                const sandbox: AgentuityHandle = {
                    sandboxId: data.sandboxId,
                    apiKey,
                    baseURL,
                    stdoutStreamUrl: data.stdoutStreamUrl,
                    stderrStreamUrl: data.stderrStreamUrl,
                };

                return { sandbox, sandboxId: data.sandboxId };
            },

            /**
             * Reconnect to an existing sandbox by ID.
             *
             * GET /sandbox/status/{sandboxId}
             */
            getById: async (
                config: AgentuityConfig,
                sandboxId: string,
            ): Promise<{ sandbox: AgentuityHandle; sandboxId: string } | null> => {
                const apiKey = resolveApiKey(config);
                if (!apiKey) return null;

                const baseURL = resolveBaseURL(config);
                const handle = { apiKey, baseURL };

                const res = await agentuityFetch(handle, 'GET', `/sandbox/status/${sandboxId}`);
                if (!res.ok) return null;

                const sandbox: AgentuityHandle = { sandboxId, apiKey, baseURL };
                return { sandbox, sandboxId };
            },

            /**
             * List active sandboxes.
             *
             * GET /sandbox?live=true
             */
            list: async (
                config: AgentuityConfig,
            ): Promise<Array<{ sandbox: AgentuityHandle; sandboxId: string }>> => {
                const apiKey = resolveApiKey(config);
                if (!apiKey) return [];

                const baseURL = resolveBaseURL(config);
                const handle = { apiKey, baseURL };

                const res = await agentuityFetch(handle, 'GET', '/sandbox?live=true');
                if (!res.ok) return [];

                const data = unwrapResponse<{ sandboxes: Array<{ sandboxId: string }> }>(await res.json());
                return (data.sandboxes ?? []).map((s) => ({
                    sandboxId: s.sandboxId,
                    sandbox: { sandboxId: s.sandboxId, apiKey, baseURL },
                }));
            },

            /**
             * Destroy a sandbox and release all resources.
             *
             * DELETE /sandbox/{sandboxId}
             */
            destroy: async (config: AgentuityConfig, sandboxId: string): Promise<void> => {
                const apiKey = resolveApiKey(config);
                if (!apiKey) return;

                const baseURL = resolveBaseURL(config);
                const handle = { apiKey, baseURL };

                // Best-effort — ignore errors (sandbox may already be gone)
                await agentuityFetch(handle, 'DELETE', `/sandbox/${sandboxId}`).catch(() => undefined);
            },

            // ── Execution ─────────────────────────────────────────────────────

            /**
             * Run code in the sandbox.
             *
             * Writes the code as a temp file via the execute `files` payload,
             * then runs it with the appropriate interpreter.
             *
             * POST /sandbox/{sandboxId}/execute
             */

            /**
             * Run a shell command in the sandbox.
             *
             * POST /sandbox/{sandboxId}/execute  (using ["sh", "-c", command])
             */
            runCommand: async (
                sandbox: AgentuityHandle,
                command: string,
                options?: RunCommandOptions,
            ): Promise<CommandResult> => {
                const startTime = Date.now();

                // Build full shell command respecting options
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

                const body = {
                    command: ['sh', '-c', fullCommand],
                    timeout: '2m',
                };

                const res = await agentuityFetch(
                    sandbox,
                    'POST',
                    `/sandbox/${sandbox.sandboxId}/execute`,
                    body,
                );

                if (!res.ok) {
                    const text = await res.text().catch(() => '');
                    return {
                        stdout: '',
                        stderr: `Agentuity: execute request failed (${res.status}): ${text}`,
                        exitCode: 1,
                        durationMs: Date.now() - startTime,
                    };
                }

                const execData = unwrapResponse<{
                    executionId: string;
                    status: string;
                    exitCode?: number;
                    stdout?: string;
                    stderr?: string;
                }>(await res.json());

                const terminal = ['completed', 'failed', 'terminated', 'error'].includes(execData.status);

                if (terminal) {
                    return {
                        stdout: execData.stdout ?? '',
                        stderr: execData.stderr ?? '',
                        exitCode: execData.exitCode ?? 0,
                        durationMs: Date.now() - startTime,
                    };
                }

                const result = await waitForExecution(sandbox, execData.executionId);
                return { ...result, durationMs: Date.now() - startTime };
            },

            // ── Metadata ──────────────────────────────────────────────────────

            /**
             * Retrieve sandbox metadata.
             *
             * GET /sandbox/{sandboxId}
             */
            getInfo: async (sandbox: AgentuityHandle): Promise<SandboxInfo> => {
                const res = await agentuityFetch(
                    sandbox,
                    'GET',
                    `/sandbox/${sandbox.sandboxId}`,
                );

                if (!res.ok) {
                    // Fallback to minimal info
                    return {
                        id: sandbox.sandboxId,
                        provider: 'agentuity',
                        runtime: 'node',
                        status: 'running',
                        createdAt: new Date(),
                        timeout: 300_000,
                        metadata: {},
                    };
                }

                const data = unwrapResponse<{
                    sandboxId: string;
                    status: string;
                    createdAt?: string;
                    runtime?: { name: string };
                    timeout?: { idle?: string; execution?: string };
                    region?: string;
                    name?: string;
                    url?: string;
                    networkPort?: number;
                }>(await res.json());

                // Convert status → ComputeSDK standard
                const statusMap: Record<string, 'running' | 'stopped' | 'error'> = {
                    idle: 'running',
                    running: 'running',
                    creating: 'running',
                    paused: 'stopped',
                    terminated: 'stopped',
                    failed: 'error',
                };

                return {
                    id: data.sandboxId,
                    provider: 'agentuity',
                    runtime: fromAgentuityRuntime(data.runtime?.name),
                    status: statusMap[data.status] ?? 'running',
                    createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
                    timeout: 300_000,
                    metadata: {
                        region: data.region,
                        name: data.name,
                        url: data.url,
                        networkPort: data.networkPort,
                        idleTimeout: data.timeout?.idle,
                    },
                };
            },

            /**
             * Get the public URL for a service running on a given port.
             *
             * Agentuity exposes a `url` field on the sandbox when a `networkPort` is
             * configured.  We fetch fresh sandbox details to get it.
             */
            getUrl: async (
                sandbox: AgentuityHandle,
                options: { port: number; protocol?: string },
            ): Promise<string> => {
                const res = await agentuityFetch(
                    sandbox,
                    'GET',
                    `/sandbox/${sandbox.sandboxId}`,
                );

                if (res.ok) {
                    const data = unwrapResponse<{ url?: string; networkPort?: number }>(await res.json());
                    if (data.url) return data.url;
                }

                // Fallback: construct a best-guess URL using the sandbox identifier
                const protocol = options.protocol ?? 'https';
                return `${protocol}://${sandbox.sandboxId}.sandbox.agentuity.com:${options.port}`;
            },

            // ── File System ───────────────────────────────────────────────────

            filesystem: {
                /**
                 * Read a file from the sandbox.
                 *
                 * GET /fs/{sandboxId}?path=<path>
                 * Returns raw bytes (streamed); we read as text.
                 */
                readFile: async (sandbox: AgentuityHandle, path: string, _runCommand: RunCommandFn): Promise<string> => {
                    const encodedPath = encodeURIComponent(path);
                    const res = await agentuityFetch(
                        sandbox,
                        'GET',
                        `/fs/${sandbox.sandboxId}?path=${encodedPath}`,
                    );

                    if (!res.ok) {
                        throw new Error(
                            `Agentuity: failed to read file "${path}" (${res.status})`,
                        );
                    }

                    return res.text();
                },

                /**
                 * Write content to a file in the sandbox.
                 *
                 * POST /fs/{sandboxId}
                 * Content must be base64-encoded.
                 */
                writeFile: async (
                    sandbox: AgentuityHandle,
                    path: string,
                    content: string,
                    _runCommand: RunCommandFn,
                ): Promise<void> => {
                    const res = await agentuityFetch(
                        sandbox,
                        'POST',
                        `/fs/${sandbox.sandboxId}`,
                        { files: [{ path, content: toBase64(content) }] },
                    );

                    if (!res.ok) {
                        const text = await res.text().catch(() => '');
                        throw new Error(
                            `Agentuity: failed to write file "${path}" (${res.status}): ${text}`,
                        );
                    }
                },

                /**
                 * Create a directory (with parents) in the sandbox.
                 *
                 * POST /fs/mkdir/{sandboxId}
                 */
                mkdir: async (sandbox: AgentuityHandle, path: string, _runCommand: RunCommandFn): Promise<void> => {
                    const res = await agentuityFetch(
                        sandbox,
                        'POST',
                        `/fs/mkdir/${sandbox.sandboxId}`,
                        { path, recursive: true },
                    );

                    if (!res.ok) {
                        const text = await res.text().catch(() => '');
                        throw new Error(
                            `Agentuity: failed to create directory "${path}" (${res.status}): ${text}`,
                        );
                    }
                },

                /**
                 * List directory contents.
                 *
                 * GET /fs/list/{sandboxId}?path=<path>
                 */
                readdir: async (
                    sandbox: AgentuityHandle,
                    path: string,
                    _runCommand: RunCommandFn,
                ): Promise<FileEntry[]> => {
                    const encodedPath = encodeURIComponent(path);
                    const res = await agentuityFetch(
                        sandbox,
                        'GET',
                        `/fs/list/${sandbox.sandboxId}?path=${encodedPath}`,
                    );

                    if (!res.ok) {
                        throw new Error(
                            `Agentuity: failed to list directory "${path}" (${res.status})`,
                        );
                    }

                    const data = unwrapResponse<{
                        files: Array<{
                            path: string;
                            size: number;
                            isDir: boolean;
                            mode: string;
                            modTime: string;
                        }>;
                    }>(await res.json());

                    return (data.files ?? []).map((entry) => {
                        const name = entry.path.split('/').filter(Boolean).pop() ?? entry.path;
                        return {
                            name,
                            type: entry.isDir ? ('directory' as const) : ('file' as const),
                            path: `${path.replace(/\/$/, '')}/${name}`,
                            isDirectory: entry.isDir,
                            size: entry.size,
                            modified: new Date(entry.modTime),
                        };
                    });
                },

                /**
                 * Check whether a path exists by attempting to list it (directory)
                 * or read its metadata via the execute endpoint.
                 */
                exists: async (
                    sandbox: AgentuityHandle,
                    path: string,
                    _runCommand: RunCommandFn,
                ): Promise<boolean> => {
                    // Use a quick shell test — cheaper than a full file read
                    const result = await (async () => {
                        const body = { command: ['sh', '-c', `test -e "${escapeShellArg(path)}" && echo yes || echo no`], timeout: '10s' };
                        const res = await agentuityFetch(
                            sandbox,
                            'POST',
                            `/sandbox/${sandbox.sandboxId}/execute`,
                            body,
                        );
                        if (!res.ok) return false;
                        const data = unwrapResponse<{ executionId: string; status: string; stdout?: string }>(await res.json());
                        const terminal = ['completed', 'failed', 'terminated', 'error'].includes(data.status);
                        let stdout = data.stdout ?? '';
                        if (!terminal) {
                            const r = await waitForExecution(sandbox, data.executionId, 15_000);
                            stdout = r.stdout;
                        }
                        return stdout.trim() === 'yes';
                    })();
                    return result;
                },

                /**
                 * Remove a file from the sandbox.
                 *
                 * POST /fs/rm/{sandboxId}
                 */
                remove: async (sandbox: AgentuityHandle, path: string, _runCommand: RunCommandFn): Promise<void> => {
                    const res = await agentuityFetch(
                        sandbox,
                        'POST',
                        `/fs/rm/${sandbox.sandboxId}`,
                        { path },
                    );

                    if (!res.ok) {
                        const text = await res.text().catch(() => '');
                        throw new Error(
                            `Agentuity: failed to remove "${path}" (${res.status}): ${text}`,
                        );
                    }
                },
            },

            // ── Native handle ─────────────────────────────────────────────────

            /**
             * Return the raw handle for direct Agentuity API access.
             */
            getInstance: (sandbox: AgentuityHandle): AgentuityHandle => sandbox,
        },
    },
});

// ─── Bonus: lightweight snapshot / checkpoint helpers ─────────────────────────

/**
 * Create a filesystem snapshot from a running sandbox.
 *
 * POST /sandbox/{sandboxId}/snapshot
 */
export async function createSnapshot(
    sandbox: AgentuityHandle,
    options?: { name?: string; tag?: string; description?: string; public?: boolean },
): Promise<{ snapshotId: string }> {
    const res = await agentuityFetch(
        sandbox,
        'POST',
        `/sandbox/${sandbox.sandboxId}/snapshot`,
        options ?? {},
    );
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Agentuity: failed to create snapshot (${res.status}): ${text}`);
    }
    return unwrapResponse<{ snapshotId: string }>(await res.json());
}

/**
 * Pause a sandbox and create a memory checkpoint.
 *
 * POST /sandbox/{sandboxId}/pause
 */
export async function pauseSandbox(sandbox: AgentuityHandle): Promise<void> {
    const res = await agentuityFetch(sandbox, 'POST', `/sandbox/${sandbox.sandboxId}/pause`);
    if (!res.ok) throw new Error(`Agentuity: failed to pause sandbox (${res.status})`);
}

/**
 * Resume a paused sandbox.
 *
 * POST /sandbox/{sandboxId}/resume
 */
export async function resumeSandbox(sandbox: AgentuityHandle): Promise<void> {
    const res = await agentuityFetch(sandbox, 'POST', `/sandbox/${sandbox.sandboxId}/resume`);
    if (!res.ok) throw new Error(`Agentuity: failed to resume sandbox (${res.status})`);
}
