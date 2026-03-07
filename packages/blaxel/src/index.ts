/**
 * Blaxel Provider - Factory-based Implementation
 * 
 * Full-featured provider with filesystem support using the factory pattern.
 */

import { SandboxInstance, initialize } from '@blaxel/core';
import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type { Runtime, CodeResult, CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

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
export const blaxel = defineProvider<SandboxInstance, BlaxelConfig>({
	name: 'blaxel',
	methods: {
		sandbox: {
			// Collection operations (map to compute.sandbox.*)
			create: async (config: BlaxelConfig, options?: CreateSandboxOptions) => {
				// Determine the image to use
				let image = config.image || 'blaxel/prod-base:latest';  // Default to prod-base

				// Override with runtime-specific image if runtime is specified and no explicit image
				if (!config.image && options?.runtime) {
					switch (options.runtime) {
						case 'python':
							image = 'blaxel/prod-py-app:latest';
							break;
						case 'node':
							image = 'blaxel/prod-ts-app:latest';
							break;
						default:
							image = 'blaxel/prod-base:latest';
							break;
					}
				}
				const memory = config.memory;
				const region = config.region;
				const envs = options?.envs;
				const ttl = options?.timeout ? `${Math.ceil(options.timeout / 1000)}s` : undefined;

				try {
					// Initialize Blaxel SDK with credentials
					initializeBlaxel(config);

					let sandbox: SandboxInstance;

					// Create new Blaxel sandbox
					sandbox = await SandboxInstance.createIfNotExists({
						name: options?.sandboxId || `blaxel-${Date.now()}`,
						image,
						memory,
						envs: Object.entries(envs || {}).map(([name, value]) => ({ name, value: value as string })),
						metadata: {
							name: options?.sandboxId || `blaxel-${Date.now()}`,
							labels: {
								...options?.metadata?.labels,
							}
						},
						ttl,
						ports: config.ports?.map(port => ({ target: port, protocol: 'HTTP' })),
						...(region && { region })
					});

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
					// This is acceptable for destroy operations
				}
			},

			// Instance operations (map to individual Sandbox methods)
			runCode: async (sandbox: SandboxInstance, code: string, runtime?: Runtime): Promise<CodeResult> => {
				const startTime = Date.now();

				try {
					// Determine runtime: 
					// 1. Use explicitly passed runtime if provided
					// 2. Check sandbox's actual runtime based on its image
					// 3. Fall back to auto-detection from code content
					let effectiveRuntime = runtime;

					if (!effectiveRuntime) {
						// Check sandbox's image to determine its runtime
						const sandboxImage = sandbox.spec?.runtime?.image || '';
						if (sandboxImage.includes('py')) {
							effectiveRuntime = 'python';
						} else if (sandboxImage.includes('ts') || sandboxImage.includes('node') || sandboxImage.includes('base')) {
							// prod-base, prod-ts-app are both Node/TypeScript environments
							effectiveRuntime = 'node';
						} else {
							// Fall back to auto-detection with improved patterns for unknown images
							effectiveRuntime = (
								// Strong Python indicators
								code.includes('print(') ||
									code.includes('import ') ||
									code.includes('from ') ||
									code.includes('def ') ||
									code.includes('class ') ||
									code.includes('raise ') ||
									code.includes('except ') ||
									code.includes('elif ') ||
									code.includes('lambda ') ||
									code.includes('True') ||
									code.includes('False') ||
									code.includes('None') ||
									code.includes('sys.') ||
									code.includes('json.') ||
									code.includes('__') ||
									code.includes('f"') ||
									code.includes("f'") ||
									code.includes('"""') ||
									code.includes("'''")
									? 'python'
									// Default to Node.js for all other cases (including ambiguous)
									: 'node'
							);
						}
					}

					// Execute code using Blaxel's process execution
					// Escape the code properly for shell execution
					const escapedCode = code.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');

					const command = effectiveRuntime === 'python'
						? `python3 -c "${escapedCode}"`
						: `node -e "${escapedCode}"`;

					const { stdout, stderr, exitCode } = await executeWithStreaming(sandbox, command);

					// Check for syntax errors and throw them
					if (exitCode !== 0 && stderr) {
						// Check for common syntax error patterns
						if (stderr.includes('SyntaxError') ||
							stderr.includes('invalid syntax') ||
							stderr.includes('Unexpected token') ||
							stderr.includes('Unexpected identifier')) {
							throw new Error(`Syntax error: ${stderr.trim()}`);
						}
					}

					// Combine stdout and stderr into output
					const output = stderr ? `${stdout}\n${stderr}`.trim() : stdout;

					return {
						output,
						exitCode,
						language: effectiveRuntime
					};
				} catch (error) {
					// Re-throw syntax errors
					if (error instanceof Error && error.message.includes('Syntax error')) {
						throw error;
					}

					// For runtime errors, return a result instead of throwing
					return {
						output: error instanceof Error ? error.message : String(error),
						exitCode: 1,
						language: runtime || 'node'
					};
				}
			},

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
				return {
					id: sandbox.metadata?.name || 'blaxel-unknown',
					provider: 'blaxel',
					runtime: sandbox.spec?.runtime?.image?.includes('py') ? 'python' : 'node',
					status: convertSandboxStatus(sandbox.status),
					createdAt: sandbox.metadata?.createdAt ? new Date(sandbox.metadata.createdAt) : new Date(),
					timeout: parseTTLToMilliseconds(sandbox.spec?.runtime?.ttl),
					metadata: {
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
						return true;  // It's a file and exists
					} catch {
						try {
							await sandbox.fs.ls(path);
							return true;  // It's a directory and exists
						} catch {
							return false;  // Path doesn't exist
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
		}
	}
});

/**
 * Parse TTL value from Blaxel's format to milliseconds
 * Supports formats like "30m", "24h", "7d" or plain numbers (seconds)
 */
function parseTTLToMilliseconds(ttl: string | number | undefined): number {
	if (!ttl) return 300000; // Default to 5 minutes

	// If it's already a number, treat it as seconds and convert to milliseconds
	if (typeof ttl === 'number') {
		return ttl * 1000;
	}

	// Parse string formats like "30m", "24h", "7d"
	const match = ttl.match(/^(\d+)([smhd])?$/);
	if (!match) return 300000; // Default if format is invalid

	const value = parseInt(match[1], 10);
	const unit = match[2] || 's'; // Default to seconds if no unit

	switch (unit) {
		case 's': return value * 1000;           // seconds to ms
		case 'm': return value * 60 * 1000;      // minutes to ms
		case 'h': return value * 60 * 60 * 1000; // hours to ms
		case 'd': return value * 24 * 60 * 60 * 1000; // days to ms
		default: return 300000; // Default fallback
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
 * Handles the common pattern of executing, streaming logs, and waiting for completion
 */
async function executeWithStreaming(
	sandbox: SandboxInstance,
	command: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	// Execute the command
	const result = await sandbox.process.exec({ command });

	// Wait for process completion
	await sandbox.process.wait(result.name);

	// Get final process result for exit code
	const processResult = await sandbox.process.get(result.name);

	return {
		stdout: processResult.logs,
		stderr: processResult.logs,
		exitCode: processResult.exitCode || 0
	};
}

// Export the Blaxel SandboxInstance type for explicit typing
export type { SandboxInstance as BlaxelSandbox } from '@blaxel/core';

