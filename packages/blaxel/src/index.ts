/**
 * Blaxel Provider - Factory-based Implementation
 * 
 * Full-featured provider with filesystem support using the factory pattern.
 */

import { SandboxInstance, initialize } from '@blaxel/core';
import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type { CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions, CreateSnapshotOptions, ListSnapshotsOptions } from '@computesdk/provider';

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
}

/**
 * Create a Blaxel provider instance using the factory pattern
 */
export const blaxel = defineProvider<SandboxInstance, BlaxelConfig, any, any>({
	name: 'blaxel',
	methods: {
		sandbox: {
			// Collection operations (map to compute.sandbox.*)
			create: async (config: BlaxelConfig, options?: CreateSandboxOptions) => {
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
					...providerOptions
				} = options || {};

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
						...providerOptions, // Spread provider-specific options
					});
				}

				return {
					sandbox,
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
						sandbox,
						sandboxId,
					};
				} catch (error) {
					// Sandbox doesn't exist or can't be accessed
					return null;
				}
			},

			list: async (config: BlaxelConfig) => {
				initializeBlaxel(config);
				const sandboxList = await SandboxInstance.list();
				return sandboxList.map(sandbox => ({
					sandbox,
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
		runCommand: async (sandbox: SandboxInstance, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
			const startTime = Date.now();

			try {
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

				const { stdout, stderr, exitCode } = await executeWithStreaming(sandbox, fullCommand);

				return {
					stdout,
					stderr,
					exitCode,
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
				const sandboxList = await SandboxInstance.list();
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

/**
 * Execute a command in the sandbox and capture stdout/stderr
 */
async function executeWithStreaming(
	sandbox: SandboxInstance,
	command: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const processResult = await sandbox.process.exec({
		command,
		waitForCompletion: true,
	});
	const result = processResult as { stdout?: string; stderr?: string; exitCode?: number };
	return {
		stdout: result.stdout || '',
		stderr: result.stderr || '',
		exitCode: result.exitCode || 0,
	};
}

// Export the Blaxel SandboxInstance type for explicit typing
export type { SandboxInstance as BlaxelSandbox } from '@blaxel/core';
