/**
 * Blaxel Provider - Factory-based Implementation
 * 
 * Full-featured provider with filesystem support using the factory pattern.
 */

import { SandboxInstance, settings } from '@blaxel/core';
import { createProvider, createBackgroundCommand } from 'computesdk';
import type {
	ExecutionResult,
	SandboxInfo,
	Runtime,
	CreateSandboxOptions,
	FileEntry,
	RunCommandOptions,
	SandboxStatus
} from 'computesdk';

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
export const blaxel = createProvider<SandboxInstance, BlaxelConfig>({
	name: 'blaxel',
	methods: {
		sandbox: {
			// Collection operations (map to compute.sandbox.*)
			create: async (config: BlaxelConfig, options?: CreateSandboxOptions) => {
				await handleBlaxelAuth(config);

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
					let sandbox: SandboxInstance;

					// Create new Blaxel sandbox
					sandbox = await SandboxInstance.createIfNotExists({
						name: options?.sandboxId || `blaxel-${Date.now()}`,
						image,
						memory,
						envs: Object.entries(envs || {}).map(([name, value]) => ({ name, value })),
						metadata: {
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
						sandboxId: sandbox.metadata?.name || 'blaxel-unknown'
					};
				} catch (error) {
					// Enhanced error handling with detailed debugging
					console.error('🔍 Blaxel SDK Error Debug Info:');
					console.error('Error type:', typeof error);
					console.error('Error constructor:', error?.constructor?.name);
					console.error('Is Error instance:', error instanceof Error);
					
					let errorDetails = 'Unknown error';
					
					if (error instanceof Error) {
						console.error('Error message:', error.message);
						console.error('Error name:', error.name);
						console.error('Error stack:', error.stack);
						errorDetails = error.message;
						
						if (error.message.includes('unauthorized') || error.message.includes('API key')) {
							throw new Error(
								`Blaxel authentication failed. Please check your BL_API_KEY environment variable. Original error: ${error.message}`
							);
						}
						if (error.message.includes('quota') || error.message.includes('limit')) {
							throw new Error(
								`Blaxel quota exceeded. Please check your usage limits. Original error: ${error.message}`
							);
						}
					} else {
						// Handle non-Error objects
						console.error('Raw error object:', error);
						
						try {
							const serialized = JSON.stringify(error, null, 2);
							console.error('Serialized error:', serialized);
							errorDetails = serialized;
						} catch (serializationError) {
							const serializationMsg = serializationError instanceof Error ? serializationError.message : String(serializationError);
							console.error('Could not serialize error:', serializationMsg);
							
							// Manual property inspection
							if (typeof error === 'object' && error !== null) {
								console.error('Error properties:');
								const properties: Record<string, any> = {};
								try {
									for (const [key, value] of Object.entries(error)) {
										console.error(`  ${key}:`, value);
										properties[key] = value;
									}
									errorDetails = JSON.stringify(properties);
								} catch (inspectionError) {
									const inspectionMsg = inspectionError instanceof Error ? inspectionError.message : String(inspectionError);
									console.error('Error inspecting properties:', inspectionMsg);
									errorDetails = `Could not inspect error: ${inspectionMsg}`;
								}
							} else {
								errorDetails = String(error);
							}
						}
					}
					
					throw new Error(
						`Failed to create Blaxel sandbox: ${errorDetails}`
					);
				}
			},

			getById: async (config: BlaxelConfig, sandboxId: string) => {
				await handleBlaxelAuth(config);

				try {
					const sandbox = await SandboxInstance.get(sandboxId);

					if (!sandbox) {
						return null;
					}

					return {
						sandbox,
						sandboxId
					};
				} catch (error) {
					// Sandbox doesn't exist or can't be accessed
					return null;
				}
			},

			list: async (config: BlaxelConfig) => {
				await handleBlaxelAuth(config);

				const sandboxList = await SandboxInstance.list();
				return sandboxList.map(sandbox => ({
					sandbox,
					sandboxId: sandbox.metadata?.name || 'blaxel-unknown'
				}));
			},

			destroy: async (config: BlaxelConfig, sandboxId: string) => {
				await handleBlaxelAuth(config);

				try {
					await SandboxInstance.delete(sandboxId);
				} catch (error) {
					// Sandbox might already be destroyed or doesn't exist
					// This is acceptable for destroy operations
				}
			},

			// Instance operations (map to individual Sandbox methods)
			runCode: async (sandbox: SandboxInstance, code: string, runtime?: Runtime): Promise<ExecutionResult> => {
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

					const { stdout, stderr, exitCode } = await executeWithStreaming(sandbox, false, command);

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

					return {
						stdout,
						stderr,
						exitCode,
						executionTime: Date.now() - startTime,
						sandboxId: sandbox.metadata?.name || 'blaxel-unknown',
						provider: 'blaxel'
					};
				} catch (error) {
					// Re-throw syntax errors
					if (error instanceof Error && error.message.includes('Syntax error')) {
						throw error;
					}

					// For runtime errors, return a result instead of throwing
					return {
						stdout: '',
						stderr: error instanceof Error ? error.message : String(error),
						exitCode: 1,
						executionTime: Date.now() - startTime,
						sandboxId: sandbox.metadata?.name || 'blaxel-unknown',
						provider: 'blaxel'
					};
				}
			},

			runCommand: async (sandbox: SandboxInstance, command: string, args: string[] = [], options?: RunCommandOptions): Promise<ExecutionResult> => {
				const startTime = Date.now();

				try {
					// Handle background command execution
					const { command: finalCommand, args: finalArgs, isBackground } = createBackgroundCommand(command, args, options);

					// Construct full command
					const fullCommand = finalArgs.length > 0 ? `${finalCommand} ${finalArgs.join(' ')}` : finalCommand;

					const { stdout, stderr, exitCode } = await executeWithStreaming(sandbox, isBackground, fullCommand);

					return {
						stdout,
						stderr,
						exitCode,
						executionTime: Date.now() - startTime,
						sandboxId: sandbox.metadata?.name || 'blaxel-unknown',
						provider: 'blaxel',
						isBackground,
						...(isBackground && { pid: -1 })
					};
				} catch (error) {
					// For command failures, return error info instead of throwing
					return {
						stdout: '',
						stderr: error instanceof Error ? error.message : String(error),
						exitCode: 127, // Command not found exit code
						executionTime: Date.now() - startTime,
						sandboxId: sandbox.metadata?.name || 'blaxel-unknown',
						provider: 'blaxel'
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
							path: `${path}/${file.name}`,
							isDirectory: false,
							size: file.size || 0,
							lastModified: new Date(file.lastModified || Date.now())
						});
					}
					for (const directory of directories) {
						entries.push({
							name: directory.name,
							path: `${path}/${directory.name}`,
							isDirectory: true,
							size: 0,
							lastModified: new Date()
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
 * Create a properly typed compute instance for Blaxel
 * This version provides full type safety for getInstance() calls
 * 
 * @example
 * ```typescript
 * import { createBlaxelCompute } from '@computesdk/blaxel'
 * 
 * const compute = createBlaxelCompute({ workspace: 'your-workspace', apiKey: 'your-key' });
 * const sandbox = await compute.sandbox.create();
 * const instance = sandbox.getInstance(); // ✅ Properly typed as SandboxInstance!
 * ```
 */
export function createBlaxelCompute(config: BlaxelConfig): {
	sandbox: {
		create(): Promise<{
			sandboxId: string;
			provider: string;
			runCode(code: string, runtime?: import('computesdk').Runtime): Promise<import('computesdk').ExecutionResult>;
			runCommand(command: string, args?: string[]): Promise<import('computesdk').ExecutionResult>;
			getInfo(): Promise<import('computesdk').SandboxInfo>;
			getUrl(options: { port: number; protocol?: string }): Promise<string>;
			getProvider(): ReturnType<typeof blaxel>;
			getInstance(): SandboxInstance; // ✅ Properly typed!
			kill(): Promise<void>;
			destroy(): Promise<void>;
			filesystem: import('computesdk').SandboxFileSystem;
		}>;
	};
} {
	const provider = blaxel(config);

	return {
		sandbox: {
			create: async () => {
				const sandbox = await provider.sandbox.create();
				return {
					...sandbox,
					getInstance: (): SandboxInstance => {
						return sandbox.getInstance() as SandboxInstance;
					}
				};
			}
		}
	};
}

async function handleBlaxelAuth(config: BlaxelConfig) {
	// Check if auth is already set in the SDK
	try {
		await settings.authenticate();
	} catch (error) {
		// If not, set the auth from the config
		if (config.workspace || process.env.BL_WORKSPACE && typeof process !== 'undefined') {
			const workspace = config.workspace || process.env.BL_WORKSPACE;
			process.env.BL_WORKSPACE = workspace;
		}
		if (config.apiKey || process.env.BL_API_KEY && typeof process !== 'undefined') {
			const apiKey = config.apiKey || process.env.BL_API_KEY;
			process.env.BL_API_KEY = apiKey;
		}
		
		try {
			await settings.authenticate();
		} catch (authError) {
			let authErrorDetails = 'Unknown authentication error';
			if (authError instanceof Error) {
				authErrorDetails = authError.message;
			} else {
				try {
					authErrorDetails = JSON.stringify(authError, null, 2);
				} catch {
					authErrorDetails = String(authError);
				}
			}
			
			throw new Error(`Blaxel authentication failed: ${authErrorDetails}. Please check your API credentials and visit: https://docs.blaxel.ai/Security/Access-tokens#using-api-keys`);
		}
	}
}

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

function convertSandboxStatus(status: string | undefined): SandboxStatus {
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
	isBackground: boolean,
	command: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	// Execute the command
	const result = await sandbox.process.exec({ command });

	if (!isBackground) {
		// Wait for process completion
		await sandbox.process.wait(result.name);
	}

	// Get final process result for exit code
	const processResult = await sandbox.process.get(result.name);

	// TODO: Handle proper stdout/stderr streaming
	return {
		stdout: processResult.logs,
		stderr: processResult.logs,
		exitCode: processResult.exitCode || 0
	};
}

// Export the Blaxel SandboxInstance type for explicit typing
export type { SandboxInstance as BlaxelSandbox } from '@blaxel/core';

