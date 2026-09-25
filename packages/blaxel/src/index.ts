/**
 * Blaxel Provider - Factory-based Implementation
 * 
 * Full-featured provider with filesystem support using the factory pattern.
 */

import { SandboxInstance, initialize } from '@blaxel/core';
import { defineProvider, escapeShellArg } from '@computesdk/provider';
import { daemonSeedScriptCommand, parseSeedInvocationOutput } from 'daemond';

import type { CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions, CreateSnapshotOptions, ListSnapshotsOptions } from '@computesdk/provider';
import type { SeedCommandInput, SeedInvocationResult } from 'daemond';

/**
 * A volume attached to a sandbox at creation time.
 *
 * Mirrors `VolumeAttachment` from `@blaxel/core`. The sandbox rootfs is small
 * (~1GB); attach an ephemeral volume for anything disk-hungry, e.g.
 * `{ type: 'ephemeral', name: 'docker', mountPath: '/var/lib/docker', sizeMb: 4096 }`.
 * Blaxel requires `region` to be set when volumes are attached.
 */
export interface BlaxelVolume {
	/** `persistent` attaches an existing volume resource; `ephemeral` creates disk-backed scratch space that lives with the sandbox. Defaults to `persistent`. */
	type?: 'ephemeral' | 'persistent';
	/** Persistent: name of the volume resource in the same workspace/region. Ephemeral: an identifier for the volume. */
	name: string;
	/** Absolute path inside the sandbox. */
	mountPath: string;
	readOnly?: boolean;
	/** Capacity in MB. Required for ephemeral volumes, ignored for persistent ones. */
	sizeMb?: number;
}

/**
 * How `runCommand` delivers commands to the sandbox.
 *
 * - `daemon` (default): the command is handed to daemond inside the sandbox
 *   through a base64-encoded launcher and spawned as `sh -c <command>` with
 *   exact argv. This sidesteps Blaxel's exec layer re-splitting/collapsing
 *   quotes, yields the process's real exit code, and lets `background: true`
 *   run as a detached daemon job so the sandbox's single exec slot is freed.
 *   Falls back to `native` for the sandbox if daemond cannot be bootstrapped
 *   (no JS runtime and no way to download one).
 * - `native`: the command string is passed verbatim to `sandbox.process.exec`.
 */
export type BlaxelExecMode = 'daemon' | 'native';

/**
 * Blaxel-specific configuration options
 */
export interface BlaxelConfig {
	/** Blaxel workspace ID - if not provided, will fallback to BL_WORKSPACE environment variable */
	workspace?: string;
	/** Blaxel API key - if not provided, will fallback to BL_API_KEY environment variable */
	apiKey?: string;
	/** Default image for sandboxes */
	image?: string;
	/** Default region for sandbox deployment */
	region?: string;
	/** Default memory allocation in MB */
	memory?: number | 4096;
	/** Default ports for sandbox */
	ports?: number[] | [3000];
	/** Default volumes attached to every sandbox created by this provider. */
	volumes?: BlaxelVolume[];
	/** Command delivery mode for `runCommand`. Defaults to `daemon`. */
	exec?: BlaxelExecMode;
}

/**
 * `sandbox.create()` options understood by the Blaxel provider.
 */
export interface BlaxelCreateOptions extends CreateSandboxOptions {
	/** Volumes to attach to this sandbox; appended to `BlaxelConfig.volumes`. */
	volumes?: BlaxelVolume[];
}

/**
 * Status of the sandbox process that ran a command, as reported by Blaxel
 * (native mode) or by daemond (daemon mode).
 *
 * `running` is only returned for `background: true` in daemon mode. Native
 * mode never returns a non-terminal status: it throws {@link BlaxelExecError}
 * instead of guessing an exit code.
 */
export type BlaxelProcessStatus = 'completed' | 'running' | 'failed' | 'stopped' | 'killed' | 'terminated';

/**
 * `runCommand` result with the process status alongside the exit code.
 */
export interface BlaxelCommandResult extends CommandResult {
	status: BlaxelProcessStatus;
	/** Signal that terminated the process, when daemond reports one (exit code is then `128 + signo`). */
	signal?: string | null;
	/** daemond job id for `background: true` commands in daemon mode. */
	jobId?: string;
}

/**
 * Thrown by `runCommand` when Blaxel reports a process status from which no
 * trustworthy exit code can be derived — most commonly `failed` with exit code
 * 0, which is what the exec API returns when another process is already
 * running in the sandbox (Blaxel allows one exec at a time).
 */
export class BlaxelExecError extends Error {
	readonly status: string;
	readonly exitCode: number | null;
	readonly pid?: string;
	readonly stdout: string;
	readonly stderr: string;

	constructor(message: string, info: { status: string; exitCode: number | null; pid?: string; stdout: string; stderr: string }) {
		super(message);
		this.name = 'BlaxelExecError';
		this.status = info.status;
		this.exitCode = info.exitCode;
		this.pid = info.pid;
		this.stdout = info.stdout;
		this.stderr = info.stderr;
	}
}

/** Same daemon as the provider framework's streaming path, so both share one process. */
const DAEMON_SSE_PORT = 38989;

/** Exec mode per sandbox instance; downgraded to `native` when daemond can't be bootstrapped. */
const execModes = new WeakMap<SandboxInstance, BlaxelExecMode>();

function registerSandbox(config: BlaxelConfig, sandbox: SandboxInstance): SandboxInstance {
	execModes.set(sandbox, config.exec ?? 'daemon');
	return sandbox;
}

/**
 * Create a Blaxel provider instance using the factory pattern
 */
export const blaxel = defineProvider<SandboxInstance, BlaxelConfig, any, any>({
	name: 'blaxel',
	methods: {
		sandbox: {
			// Collection operations (map to compute.sandbox.*)
			create: async (config: BlaxelConfig, options?: BlaxelCreateOptions) => {
				// Destructure known ComputeSDK fields, collect the rest for passthrough
				const {
					timeout: optTimeout,
					envs,
					name: _name,
					metadata,
					templateId: _templateId,
					snapshotId,
					sandboxId: optSandboxId,
					namespace: _namespace,
					directory: _directory,
					volumes: optVolumes,
					...providerOptions
				} = options || {};
				const volumes = [...(config.volumes ?? []), ...(optVolumes ?? [])];

				const optRuntime = (options as any)?.runtime as string | undefined;

				// Determine the image to use
				let image = config.image || 'blaxel/base-image:latest';  // Default to prod-base

				// Override with runtime-specific image if runtime is specified and no explicit image
				if (!config.image && optRuntime) {
					switch (optRuntime) {
						case 'python':
							image = 'blaxel/py-app:latest';
							break;
						case 'node':
							image = 'blaxel/ts-app:latest';
							break;
						default:
							image = 'blaxel/base-image:latest';
							break;
					}
				}
				const memory = config.memory;
				const region = config.region;
				const ttl = optTimeout ? `${Math.ceil(optTimeout / 1000)}s` : undefined;

			try {
				// Initialize Blaxel SDK with credentials
				initializeBlaxel(config);

				let sandbox: SandboxInstance;

				// Check if we should resume an existing sandbox or create new
				const existingId = optSandboxId || snapshotId;
				
				if (existingId) {
					// Resume existing sandbox or snapshot
					sandbox = await SandboxInstance.get(existingId);
					if (!sandbox) {
						throw new Error(`Sandbox ${existingId} not found`);
					}
				} else {
					// Create new Blaxel sandbox
					sandbox = await SandboxInstance.createIfNotExists({
						image,
						memory,
						envs: Object.entries(envs || {}).map(([name, value]) => ({ name, value: value as string })),
						...(metadata?.labels && { labels: metadata.labels }),
						ttl,
						ports: config.ports?.map(port => ({ target: port, protocol: 'HTTP' })),
						...(region && { region }),
						...(volumes.length > 0 && { volumes }),
						...providerOptions, // Spread provider-specific options
					});
				}

				return {
					sandbox: registerSandbox(config, sandbox),
					sandboxId: sandbox.metadata?.name || 'blaxel-unknown',
				};
			} catch (error) {
					const errorDetail = error instanceof Error
						? error.message
						: typeof error === 'object' && error !== null
							? JSON.stringify(error)
							: String(error);

					if (
						errorDetail.includes('unauthorized') ||
						errorDetail.includes('Unauthorized') ||
						errorDetail.includes('Forbidden') ||
						errorDetail.includes('API key')
					) {
						throw new Error(
							`Blaxel authentication failed: ${errorDetail}`
						);
					}
					if (errorDetail.includes('quota') || errorDetail.includes('limit')) {
						throw new Error(
							`Blaxel quota exceeded: ${errorDetail}`
						);
					}
					throw new Error(
						`Failed to create Blaxel sandbox: ${errorDetail}`
					);
				}
			},

			getById: async (config: BlaxelConfig, sandboxId: string) => {
				try {
					initializeBlaxel(config);
					const sandbox = await SandboxInstance.get(sandboxId);

					if (!sandbox) {
						return null;
					}

					return {
						sandbox: registerSandbox(config, sandbox),
						sandboxId,
					};
				} catch (error) {
					// Sandbox doesn't exist or can't be accessed
					return null;
				}
			},

			list: async (config: BlaxelConfig) => {
				initializeBlaxel(config);
				const sandboxList = await listAllSandboxes();
				return sandboxList.map(sandbox => ({
					sandbox: registerSandbox(config, sandbox),
					sandboxId: sandbox.metadata?.name || 'blaxel-unknown'
				}));
			},

			destroy: async (config: BlaxelConfig, sandboxId: string) => {
				try {
					initializeBlaxel(config);
					await SandboxInstance.delete(sandboxId);
				} catch (error) {
					// Sandbox might already be destroyed or doesn't exist
				}
			},

			// Instance operations (map to individual Sandbox methods)
		runCommand: async (sandbox: SandboxInstance, command: string, options?: RunCommandOptions): Promise<BlaxelCommandResult> => {
			const startTime = Date.now();

			try {
				if ((execModes.get(sandbox) ?? 'daemon') === 'daemon') {
					const viaDaemon = await runViaDaemon(sandbox, command, options, startTime);
					if (viaDaemon) return viaDaemon;
					execModes.set(sandbox, 'native');
				}

				// Build command with options
				let fullCommand = command;
				
				// Handle environment variables
				if (options?.env && Object.keys(options.env).length > 0) {
					const envPrefix = Object.entries(options.env)
						.map(([k, v]) => `${k}="${escapeShellArg(v)}"`)
						.join(' ');
					fullCommand = `${envPrefix} ${fullCommand}`;
				}
				
				// Handle working directory
				if (options?.cwd) {
					fullCommand = `cd "${escapeShellArg(options.cwd)}" && ${fullCommand}`;
				}
				
				// Handle background execution
				if (options?.background) {
					fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
				}

				const { stdout, stderr, exitCode, status } = await executeWithStreaming(sandbox, fullCommand, options?.timeout);

				return {
					stdout,
					stderr,
					exitCode,
					status,
					durationMs: Date.now() - startTime
				};
			} catch (error) {
				if (error instanceof BlaxelExecError) throw error;
				return {
					stdout: '',
					stderr: error instanceof Error ? error.message : String(error),
					exitCode: 127,
					status: 'failed',
					durationMs: Date.now() - startTime
				};
			}
		},

			getInfo: async (sandbox: SandboxInstance): Promise<SandboxInfo> => {
				const runtime = sandbox.spec?.runtime?.image?.includes('py') ? 'python' : 'node';
				return {
					id: sandbox.metadata?.name || 'blaxel-unknown',
					provider: 'blaxel',
					status: convertSandboxStatus(sandbox.status),
					createdAt: sandbox.metadata?.createdAt ? new Date(sandbox.metadata.createdAt) : new Date(),
					timeout: parseTTLToMilliseconds(sandbox.spec?.runtime?.ttl),
					metadata: {
						runtime,
						...sandbox.metadata?.labels
					}
				};
			},

			getUrl: async (sandbox: SandboxInstance, options: {
				port: number;
				ttl?: number;
				prefixUrl?: string;
				headers?: {
					response?: Record<string, string>;
					request?: Record<string, string>;
				};
				customDomain?: string;
				authentication?: {
					public?: boolean;
					tokenExpiryMinutes?: number;
				};
			}): Promise<string> => {
				try {
					// If public is not set, default to true
					const isPublic = options.authentication?.public !== undefined ? options.authentication.public : true;

					// Default CORS headers for broad compatibility
					const defaultHeaders = {
						"Access-Control-Allow-Origin": "*",
						"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
						"Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, X-Blaxel-Preview-Token, X-Blaxel-Authorization",
						"Access-Control-Allow-Credentials": "true",
						"Access-Control-Expose-Headers": "Content-Length, X-Request-Id",
						"Access-Control-Max-Age": "86400",
						"Vary": "Origin"
					};

					// Use custom headers if provided, otherwise use defaults
					const responseHeaders = options.headers?.response || defaultHeaders;

					// Create or get existing preview URL using Blaxel's preview API
					const preview = await sandbox.previews.createIfNotExists({
						metadata: {
							name: `preview-port-${options.port}-${isPublic ? 'public' : 'private'}`
						},
						spec: {
							port: options.port,
							public: isPublic,
							responseHeaders,
							requestHeaders: options.headers?.request || defaultHeaders,
							customDomain: options.customDomain,
							prefixUrl: options.prefixUrl,
							ttl: options.ttl ? `${Math.ceil(options.ttl / 1000)}s` : undefined
						}
					});

					// Get the preview URL
					const url = preview.spec?.url;
					if (!url) {
						throw new Error(`Failed to get preview URL for port ${options.port}`);
					}

					// For private previews, create an access token and append it to the URL
					if (!isPublic) {
						// Create token with specified expiry (default 60 minutes)
						const expiryMinutes = options.authentication?.tokenExpiryMinutes || 60;
						const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);
						const token = await preview.tokens.create(expiresAt);

						// Return URL with token as query parameter
						const separator = url.includes('?') ? '&' : '?';
						return `${url}${separator}bl_preview_token=${token.value}`;
					}

					// For public previews, just return the URL
					return url;
				} catch (error) {
					throw new Error(
						`Failed to get Blaxel preview URL for port ${options.port}: ${error instanceof Error ? error.message : String(error)}`
					);
				}
			},

			// Optional filesystem methods - implement using Blaxel's filesystem API
			filesystem: {
				readFile: async (sandbox: SandboxInstance, path: string): Promise<string> => {
					const result = await sandbox.fs.read(path);
					return result || '';
				},

				writeFile: async (sandbox: SandboxInstance, path: string, content: string): Promise<void> => {
					await sandbox.fs.write(path, content);
				},

				mkdir: async (sandbox: SandboxInstance, path: string): Promise<void> => {
					await sandbox.fs.mkdir(path);
				},

				readdir: async (sandbox: SandboxInstance, path: string): Promise<FileEntry[]> => {
					const result = await sandbox.fs.ls(path);
					const files = result.files || [];
					const directories = result.subdirectories || [];
					let entries = [];
					for (const file of files) {
						entries.push({
							name: file.name,
							type: 'file' as const,
							size: file.size || 0,
							modified: new Date(file.lastModified || Date.now())
						});
					}
					for (const directory of directories) {
						entries.push({
							name: directory.name,
							type: 'directory' as const,
							size: 0,
							modified: new Date()
						});
					}
					return entries;
				},

				exists: async (sandbox: SandboxInstance, path: string): Promise<boolean> => {
					try {
						await sandbox.fs.read(path);
						return true;
					} catch {
						try {
							await sandbox.fs.ls(path);
							return true;
						} catch {
							return false;
						}
					}
				},

				remove: async (sandbox: SandboxInstance, path: string): Promise<void> => {
					await sandbox.fs.rm(path);
				}
			},

			// Provider-specific typed getInstance method
			getInstance: (sandbox: SandboxInstance): SandboxInstance => {
				return sandbox;
			},
		},

		snapshot: {
			create: async (config: BlaxelConfig, sandboxId: string, options?: { name?: string }) => {
				try {
					initializeBlaxel(config);
					
					const sandbox = await SandboxInstance.get(sandboxId);
					
					if (!sandbox) {
						throw new Error(`Sandbox ${sandboxId} not found`);
					}

					return {
						id: sandboxId,
						provider: 'blaxel',
						createdAt: new Date(),
						metadata: {
							name: options?.name,
							image: sandbox.spec?.runtime?.image
						}
					};
				} catch (error) {
					throw new Error(
						`Failed to create Blaxel snapshot: ${error instanceof Error ? error.message : String(error)}`
					);
				}
			},

			list: async (config: BlaxelConfig) => {
				initializeBlaxel(config);
				const sandboxList = await listAllSandboxes();
				return sandboxList.map(sandbox => ({
					id: sandbox.metadata?.name || 'blaxel-unknown',
					provider: 'blaxel',
					createdAt: sandbox.metadata?.createdAt ? new Date(sandbox.metadata.createdAt) : new Date(),
					metadata: {
						image: sandbox.spec?.runtime?.image,
						status: sandbox.status
					}
				}));
			},

			delete: async (config: BlaxelConfig, snapshotId: string) => {
				try {
					initializeBlaxel(config);
					await SandboxInstance.delete(snapshotId);
				} catch (error) {
					// Ignore if not found
				}
			}
		},

		// Templates in Blaxel are pre-configured images
		template: {
			create: async (_config: BlaxelConfig, _options: { name: string }) => {
				throw new Error(
					`Blaxel templates must be created via the Blaxel dashboard or CLI. Use image in sandbox.create() to specify a base image.`
				);
			},

			list: async (_config: BlaxelConfig) => {
				throw new Error(
					`Blaxel provider does not support listing templates via API. Use the dashboard to manage templates.`
				);
			},

			delete: async (_config: BlaxelConfig, _templateId: string) => {
				throw new Error(
					`Blaxel templates must be deleted via the Blaxel dashboard or CLI.`
				);
			}
		}
	}
});

/**
 * Collect all sandboxes across pages — since @blaxel/core 0.3.x, list()
 * returns a cursor-paginated, auto-paging async iterable instead of an array.
 */
async function listAllSandboxes(): Promise<SandboxInstance[]> {
	const sandboxes: SandboxInstance[] = [];
	for await (const sandbox of await SandboxInstance.list()) {
		sandboxes.push(sandbox);
	}
	return sandboxes;
}

/**
 * Parse TTL value from Blaxel's format to milliseconds
 */
function parseTTLToMilliseconds(ttl: string | number | undefined): number {
	if (!ttl) return 300000;
	if (typeof ttl === 'number') return ttl * 1000;
	const match = ttl.match(/^(\d+)([smhd])?$/);
	if (!match) return 300000;
	const value = parseInt(match[1], 10);
	const unit = match[2] || 's';
	switch (unit) {
		case 's': return value * 1000;
		case 'm': return value * 60 * 1000;
		case 'h': return value * 60 * 60 * 1000;
		case 'd': return value * 24 * 60 * 60 * 1000;
		default: return 300000;
	}
}

/**
 * Initialize the Blaxel SDK with credentials from config or environment variables
 */
function initializeBlaxel(config: BlaxelConfig): void {
	const apiKey = config.apiKey || process.env?.BL_API_KEY!;
	const workspace = config.workspace || process.env?.BL_WORKSPACE!;
	initialize({ apikey: apiKey, workspace: workspace });
}

function convertSandboxStatus(status: string | undefined): 'running' | 'stopped' | 'error' {
	switch (status?.toLowerCase()) {
		case 'deployed': return 'running';
		case 'deleting': return 'stopped';
		case 'failed': return 'error';
		default: return 'running';
	}
}

/** Process statuses from which no more output will arrive. */
const TERMINAL_PROCESS_STATUSES = new Set(['completed', 'failed', 'stopped', 'killed', 'terminated']);

/** How long to poll for a still-running process when no command timeout is set. */
const DEFAULT_PROCESS_WAIT_MS = 5 * 60 * 1000;
const LAUNCHER_TIMEOUT_GRACE_MS = 10_000;

/** Grace period for the live log stream to deliver its final bytes after the process goes terminal. */
const STREAM_DRAIN_MS = 2000;

/**
 * Execute a command in the sandbox and capture stdout/stderr
 */
async function executeWithStreaming(
	sandbox: SandboxInstance,
	command: string,
	timeoutMs?: number
): Promise<{ stdout: string; stderr: string; exitCode: number; status: BlaxelProcessStatus; pid?: string }> {
	const stdoutLines: string[] = [];
	const stderrLines: string[] = [];
	// streamLogs emits whole protocol lines with their delimiters stripped,
	// unlike the exec callbacks' arbitrary chunks — keep them separate so the
	// framing can be restored on join.
	const streamStdoutLines: string[] = [];
	const streamStderrLines: string[] = [];

	// Passing callbacks routes exec through @blaxel/core's execWithStreaming
	// path, which surfaces output via stdout/stderr events, the completed-process
	// `logs` field, and the streamed `result` event. Reading `stdout` off the
	// plain POST /process response comes back empty on current Blaxel infra.
	const processResult = await sandbox.process.exec({
		command,
		waitForCompletion: true,
		onStdout: (line) => stdoutLines.push(line),
		onStderr: (line) => stderrLines.push(line),
	});

	type ExecResult = {
		stdout?: string;
		stderr?: string;
		logs?: string;
		exitCode?: number;
		pid?: string;
		status?: string;
	};

	let result = processResult as ExecResult;

	// On current Blaxel infra, waitForCompletion is not honored server-side:
	// exec returns promptly with status 'running' and empty output. Poll the
	// process to a terminal state before attempting output recovery.
	if (result.pid && (!result.status || !TERMINAL_PROCESS_STATUSES.has(result.status))) {
		const pid = result.pid;
		// Mark 3 doesn't retain process output for the logs GET after the
		// process exits — attach the live log stream before waiting so output
		// produced while the process finishes isn't lost.
		const logStream = sandbox.process.streamLogs(pid, {
			onStdout: (line) => streamStdoutLines.push(line),
			onStderr: (line) => streamStderrLines.push(line),
			onError: () => {},
		});
		try {
			const finished = (await sandbox.process.wait(pid, {
				maxWait: timeoutMs ?? DEFAULT_PROCESS_WAIT_MS,
				interval: 500,
			})) as ExecResult;
			// @blaxel/core's wait() breaks its poll loop on a mid-poll error and
			// returns the last (possibly still 'running') response, so a resolved
			// promise doesn't guarantee a terminal state.
			if (!finished.status || !TERMINAL_PROCESS_STATUSES.has(finished.status)) {
				throw new Error(
					`Process ${pid} did not reach a terminal state (status: ${finished.status ?? 'unknown'})`
				);
			}
			result = { ...result, ...finished, pid };
		} catch (error) {
			// Best-effort: don't leave the process running past its deadline.
			try {
				await sandbox.process.kill(pid);
			} catch {
				// Process may have already exited
			}
			throw error instanceof Error ? error : new Error(String(error));
		} finally {
			// The status poll and the log stream are separate requests — a
			// terminal status can arrive before the stream's final bytes. Give
			// the stream a bounded window to drain, then abort it.
			try {
				await Promise.race([
					logStream.wait(),
					new Promise((resolve) => setTimeout(resolve, STREAM_DRAIN_MS)),
				]);
			} catch {
				// Fall through to abort
			}
			logStream.close();
			try {
				await logStream.wait();
			} catch {
				// Stream teardown is best-effort; chunks already captured stand
			}
		}
	}

	// Streamed callbacks receive arbitrary chunks, not lines — concatenate
	// exactly; the result fields are authoritative when populated.
	let stdout =
		result.stdout ||
		stdoutLines.join('') ||
		streamStdoutLines.map((line) => `${line}\n`).join('');
	let stderr =
		result.stderr ||
		stderrLines.join('') ||
		streamStderrLines.map((line) => `${line}\n`).join('');

	// Completed-process output may only be retrievable via the logs endpoint,
	// which reports stdout and stderr per channel.
	if (!stdout && result.pid) {
		try {
			stdout = (await sandbox.process.logs(result.pid, 'stdout')) || '';
		} catch {
			// Logs fetch is best-effort; keep whatever output we already have
		}
	}
	if (!stderr && result.pid) {
		try {
			stderr = (await sandbox.process.logs(result.pid, 'stderr')) || '';
		} catch {
			// Logs fetch is best-effort; keep whatever output we already have
		}
	}

	// Last resort when no per-channel output is retrievable: `logs` is the
	// combined stream, so only treat it as stdout when stderr is empty —
	// otherwise it would duplicate stderr content into stdout.
	if (!stdout && !stderr && result.logs) {
		stdout = result.logs;
	}

	const status = normalizeProcessStatus(result.status);
	const exitCode = result.exitCode ?? (status === 'completed' ? 0 : null);

	// A non-`completed` status without a non-zero exit code is not a process
	// outcome: Blaxel reports `failed`/0 when it refuses an exec because another
	// process is running, and `terminated`/`stopped` when the sandbox side went
	// away. Substituting a code would hide all of those.
	if (status === 'completed' && exitCode !== null) {
		return { stdout, stderr, exitCode, status, pid: result.pid };
	}
	if (exitCode !== null && exitCode !== 0) {
		return { stdout, stderr, exitCode, status, pid: result.pid };
	}
	throw new BlaxelExecError(
		`Blaxel exec ended with status '${status}' and no exit code` +
		(status === 'failed' ? ' (another process may be running: the sandbox allows one exec at a time)' : ''),
		{ status, exitCode, pid: result.pid, stdout, stderr }
	);
}

function normalizeProcessStatus(status: string | undefined): BlaxelProcessStatus {
	switch (status) {
		case 'completed':
		case 'running':
		case 'failed':
		case 'stopped':
		case 'killed':
		case 'terminated':
			return status;
		case undefined:
			return 'completed';
		default:
			return 'failed';
	}
}

// Linux signal numbers (the sandbox is Linux; Node reports signals by name).
const SIGNAL_NUMBERS: Record<string, number> = {
	SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGILL: 4, SIGTRAP: 5, SIGABRT: 6, SIGIOT: 6, SIGBUS: 7, SIGFPE: 8,
	SIGKILL: 9, SIGUSR1: 10, SIGSEGV: 11, SIGUSR2: 12, SIGPIPE: 13, SIGALRM: 14, SIGTERM: 15, SIGSTKFLT: 16,
	SIGCHLD: 17, SIGCONT: 18, SIGSTOP: 19, SIGTSTP: 20, SIGTTIN: 21, SIGTTOU: 22, SIGURG: 23, SIGXCPU: 24,
	SIGXFSZ: 25, SIGVTALRM: 26, SIGPROF: 27, SIGWINCH: 28, SIGIO: 29, SIGPOLL: 29, SIGPWR: 30, SIGSYS: 31,
};

function createRequestId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * Runs `command` through daemond inside the sandbox. Returns `null` when the
 * launcher itself could not run (no JS runtime and bootstrap failed), in which
 * case the caller should fall back to native exec for this sandbox.
 */
async function runViaDaemon(
	sandbox: SandboxInstance,
	command: string,
	options: RunCommandOptions | undefined,
	startTime: number
): Promise<BlaxelCommandResult | null> {
	const detach = options?.background === true;
	const payload: SeedCommandInput = {
		command: 'sh',
		args: ['-c', command],
		cwd: options?.cwd,
		env: options?.env,
		// A background job runs until it exits or is killed; only attached
		// commands get the native path's default deadline.
		timeoutMs: options?.timeout ?? (detach ? undefined : DEFAULT_PROCESS_WAIT_MS),
		detach,
		requestId: createRequestId(),
	};
	const launcher = daemonSeedScriptCommand({ ssePort: DAEMON_SSE_PORT }, payload, { argvEncoding: 'base64' });

	// The launcher's own exit status is only meaningful for the bootstrap; the
	// command's outcome is in the JSON it prints.
	// Give the launcher a little longer than the command so daemond's own
	// timeout result (real exit code / signal) wins over a native wait timeout.
	const native = await executeWithStreaming(
		sandbox,
		launcher,
		(options?.timeout ?? DEFAULT_PROCESS_WAIT_MS) + LAUNCHER_TIMEOUT_GRACE_MS
	);

	let invocation: SeedInvocationResult;
	try {
		invocation = parseSeedInvocationOutput(native.stdout);
	} catch (parseError) {
		// The launcher exits 127 only when the sandbox has no JS runtime and the
		// bootstrap download failed: a property of the image, so fall back to
		// native for good. Anything else is a transient daemon failure and must
		// not silently route later commands through Blaxel's quote-mangling exec.
		if (native.exitCode === 127) return null;
		throw new BlaxelExecError(
			`Blaxel daemon launcher produced no result (exit ${native.exitCode}, status '${native.status}'): ` +
				(parseError instanceof Error ? parseError.message : String(parseError)),
			{ status: native.status, exitCode: native.exitCode, pid: native.pid, stdout: native.stdout, stderr: native.stderr }
		);
	}

	const cmd = invocation.command;
	if (cmd.status === 'running') {
		return {
			stdout: cmd.stdout,
			stderr: cmd.stderr,
			exitCode: 0,
			status: 'running',
			jobId: cmd.jobId,
			durationMs: Date.now() - startTime,
		};
	}

	const signal = cmd.signal ?? null;
	if (cmd.exitCode === null && signal && SIGNAL_NUMBERS[signal] === undefined) {
		throw new BlaxelExecError(`Blaxel daemon job was terminated by unknown signal '${signal}'`, {
			status: 'killed',
			exitCode: null,
			stdout: cmd.stdout,
			stderr: cmd.stderr,
		});
	}
	const exitCode = cmd.exitCode ?? (signal ? 128 + SIGNAL_NUMBERS[signal] : 1);
	return {
		stdout: cmd.stdout,
		stderr: cmd.stderr,
		exitCode,
		status: signal ? 'killed' : 'completed',
		signal,
		durationMs: Date.now() - startTime,
	};
}

// Export the Blaxel SandboxInstance type for explicit typing
export type { SandboxInstance as BlaxelSandbox } from '@blaxel/core';
