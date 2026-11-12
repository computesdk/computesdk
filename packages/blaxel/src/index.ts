/**
 * Blaxel Provider - Factory-based Implementation
 * 
 * Full-featured provider with filesystem support using the factory pattern.
 */

import { createHash, randomUUID } from 'node:crypto';

import { SANDBOX_API_IMAGE, SANDBOX_API_PATH, SandboxInstance, Snapshot, VolumeInstance, deleteImage, deleteImageTag, getImage, initialize, listImages, listImageTags, settings } from '@blaxel/core';
import type { Image, ImageSummary, ImageTag as BlaxelImageTag } from '@blaxel/core';
import { defineProvider, createConfigGate, createConfigStamp, resolveVolumeRef, isUnifiedVolumeMounts, withVolumeSettle } from '@computesdk/provider';

import type { CommandResult, InstanceInfo, CreateInstanceOptions, FileEntry, RunCommandOptions, CreateSnapshotOptions, ListSnapshotsOptions, CreateTemplateOptions, ListTemplatesOptions } from '@computesdk/provider';

/**
 * Blaxel rejects sandboxes with a ttl under 5 minutes
 * (`ttl 120s is too short: the minimum is 5m`). Any timeout below the floor
 * is raised to it — the platform's own destroy still ends the box early, so
 * billing stays on actual use.
 */
export const BLAXEL_MIN_TTL_SECONDS = 300;

function toBlaxelTtl(timeoutMs: number | undefined, what: string): string | undefined {
	if (timeoutMs === undefined) return undefined;
	const seconds = Math.ceil(timeoutMs / 1000);
	if (seconds >= BLAXEL_MIN_TTL_SECONDS) return `${seconds}s`;
	console.warn(
		`blaxel: ${what} ttl ${seconds}s is below the 5m provider minimum — raised to ${BLAXEL_MIN_TTL_SECONDS}s`
	);
	return `${BLAXEL_MIN_TTL_SECONDS}s`;
}

/**
 * A `ttl` passed through provider options (`'300s'`, `'5m'`, `'1h'`; a
 * bare number is taken as milliseconds) in ms — undefined when the value
 * is not a shape we can normalize, in which case it passes through as-is.
 */
function parseBlaxelTtl(ttl: unknown): number | undefined {
	if (typeof ttl === 'number') return Number.isFinite(ttl) ? ttl : undefined;
	if (typeof ttl !== 'string') return undefined;
	const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(ttl.trim());
	if (!match) return undefined;
	const value = Number(match[1]);
	switch (match[2]) {
		case 'ms': return value;
		case 's': return value * 1000;
		case 'm': return value * 60000;
		default: return value * 3600000;
	}
}

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
 * Options for `template.create`: build a sandbox image from an OCI image.
 */
export interface BlaxelCreateTemplateOptions extends CreateTemplateOptions {
	/** OCI image to build from, e.g. `ubuntu:24.04`. Required: create throws without it. */
	image?: string;
	/** Build timeout in ms. Default: 15 minutes. */
	timeout?: number;
	/** Called with each image status of this build (`UPLOADING`, `BUILDING`, `BUILT`, `FAILED`). */
	onStatusChange?: (status: string) => void;
}

/**
 * A sandbox image as Blaxel returns it: a summary with a tag count from API
 * version 2026-09-22 on, the image with its tags before that.
 */
export type BlaxelImage = Image | ImageSummary;

/**
 * A Blaxel template: one tag of a sandbox image in the workspace registry.
 */
export interface BlaxelTemplateInfo {
	/** Image ref (`sandbox/<name>:<tag>`); `create({ templateId: id })` boots it. */
	id: string;
	name: string;
	provider: 'blaxel';
	createdAt?: Date;
	raw?: BlaxelImage;
}

/**
 * Blaxel's `initialize()` rewrites the SDK's process-global settings and
 * client config: a different credential must serialize against in-flight
 * calls, not interleave with them. The gate admits same-config calls
 * concurrently; a different resolved config waits for the active calls to
 * drain, then installs itself once.
 */
const blaxelGate = createConfigGate();

/** Stamps created/connected instances so their instance ops re-enter the gate under their own config. */
const blaxelStamp = createConfigStamp<BlaxelConfig>();

function blaxelKey(config: BlaxelConfig): string {
	const apiKey = config.apiKey || (typeof process !== 'undefined' ? process.env?.BL_API_KEY : undefined) || '';
	const workspace = config.workspace || (typeof process !== 'undefined' ? process.env?.BL_WORKSPACE : undefined) || '';
	return JSON.stringify({ apiKey, workspace });
}

async function withBlaxelConfig<T>(config: BlaxelConfig, fn: () => Promise<T>): Promise<T> {
	return blaxelGate.withConfig(blaxelKey(config), () => initializeBlaxel(config), fn);
}

/**
 * Instance ops use the config the instance was created under. An instance
 * arriving without a stamp joins whatever epoch is active without installing
 * a config — the same best-effort semantics it always had.
 */
function withBlaxelInstance<T>(sandbox: SandboxInstance, fn: () => Promise<T>): Promise<T> {
	const config = blaxelStamp.config(sandbox);
	if (config === undefined) {
		return blaxelGate.withConfig('blaxel.unconfigured', undefined, fn);
	}
	return withBlaxelConfig(config, fn);
}

/**
 * Create a Blaxel provider instance using the factory pattern
 */
export const blaxel = defineProvider<SandboxInstance, BlaxelConfig, any, any>({
	name: 'blaxel',
	methods: {
		instances: {
			// Collection operations (map to compute.sandbox.*)
			create: async (config: BlaxelConfig, options?: CreateInstanceOptions) => {
				// Destructure known ComputeSDK fields, collect the rest for passthrough
				const {
					timeout: optTimeout,
					envs,
					name,
					metadata,
					templateId,
					image: optImage,
					snapshotId,
					sandboxId: optSandboxId,
					namespace: _namespace,
					directory: _directory,
					volumes,
					...providerOptions
				} = options || {};

				// `volumes` only counts as unified VolumeMount[] when every entry
				// carries `volume`; a provider-native volumes spec stays in
				// providerOptions and reaches the wire untouched.
				const unifiedVolumes = isUnifiedVolumeMounts(volumes) ? volumes : undefined;
				if (volumes !== undefined && !unifiedVolumes) (providerOptions as any).volumes = volumes;

				const optRuntime = (options as any)?.runtime as string | undefined;

				// Determine the image to use. A template id is the image ref
				// template.create() built, so it wins over an image option, which
				// wins over the configured image.
				let image = templateId || (optImage as string | undefined) || config.image || 'blaxel/base-image:latest';  // Default to prod-base

				// Override with runtime-specific image if runtime is specified and no explicit image
				if (!templateId && !optImage && !config.image && optRuntime) {
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
				const ttl = toBlaxelTtl(optTimeout, 'sandbox');

			return withBlaxelConfig(config, async () => {
			try {
				let sandbox: SandboxInstance;

				if (optSandboxId) {
					// Resume an existing live sandbox. Refuse an abort signal here:
					// the sandbox manager destroys a resolved sandbox after an abort,
					// which would delete a sandbox this call did not create.
					if (options?.signal) {
						throw new Error(
							'create({ sandboxId }) attaches to an existing sandbox and cannot be combined with an abort signal'
						);
					}
					sandbox = await SandboxInstance.get(optSandboxId);
					if (!sandbox) {
						throw new Error(`Sandbox ${optSandboxId} not found`);
					}
				} else if (snapshotId) {
					// Fork a new sandbox from a workspace snapshot. The fork is
					// created even when the snapshot's source sandbox is gone.
					const snapshot = await Snapshot.get(snapshotId);
					const forkName = name || `sandbox-${randomUUID().slice(0, 8)}`;
					const forkResult = await snapshot.fork(forkName, {
						targetType: 'sandbox',
						envs: Object.entries(envs || {}).map(([envName, value]) => ({ name: envName, value: value as string })),
					});
					const createdName = forkResult.name || forkName;
					sandbox = await SandboxInstance.get(createdName);
					if (!sandbox) {
						throw new Error(`Sandbox ${forkName} not found after forking snapshot ${snapshotId}`);
					}
				} else {
					// A `ttl` inside providerOptions would spread over the clamped
					// value — lift it out and apply the same 5m floor.
					const { ttl: optionTtl, ...restProviderOptions } = providerOptions;
					const effectiveTtl = optionTtl === undefined
						? ttl
						: (toBlaxelTtl(parseBlaxelTtl(optionTtl), 'sandbox') ?? (optionTtl as string));
					// Create new Blaxel sandbox
					sandbox = await SandboxInstance.createIfNotExists({
						image,
						memory,
						envs: Object.entries(envs || {}).map(([name, value]) => ({ name, value: value as string })),
						...(metadata?.labels && { labels: metadata.labels }),
						ttl: effectiveTtl,
						ports: config.ports?.map(port => ({ target: port, protocol: 'HTTP' })),
						...(region && { region }),
						...(unifiedVolumes && {
							// Unified mounts → blaxel VolumeAttachment shape.
							volumes: unifiedVolumes.map((m: any) => {
								const ref = resolveVolumeRef(m.volume);
								return { name: ref.name ?? ref.id, mountPath: m.mountPath, readOnly: m.readOnly, type: 'persistent' };
							}),
						}),
						...restProviderOptions, // Spread provider-specific options
					});
				}

				return { instance: blaxelStamp.stamp(sandbox, config), instanceId: sandbox.metadata?.name || 'blaxel-unknown',
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
				});
			},

			getById: async (config: BlaxelConfig, sandboxId: string) =>
				withBlaxelConfig(config, async () => {
					try {
						const sandbox = await SandboxInstance.get(sandboxId);

						if (!sandbox) {
							return null;
						}

						return {
							sandbox: blaxelStamp.stamp(sandbox, config),
							sandboxId,
						};
					} catch (error) {
						// Sandbox doesn't exist or can't be accessed
						return null;
					}
				}),

			list: async (config: BlaxelConfig) =>
				withBlaxelConfig(config, async () => {
					const sandboxList = await listAllSandboxes();
					return sandboxList.map(sandbox => ({ instance: blaxelStamp.stamp(sandbox, config), instanceId: sandbox.metadata?.name || 'blaxel-unknown'
					}));
				}),

			destroy: async (config: BlaxelConfig, sandboxId: string) =>
				withBlaxelConfig(config, async () => {
					try {
						await SandboxInstance.delete(sandboxId);
					} catch (error) {
						// Sandbox might already be destroyed or doesn't exist
					}
				}),

			// Instance operations (map to individual Sandbox methods)
			runCommand: (sandbox: SandboxInstance, command: string, options?: RunCommandOptions): Promise<CommandResult> =>
				runBlaxelCommand(sandbox, command, options),

			// Blaxel's process API streams output while the command runs.
			streamCommand: (sandbox: SandboxInstance, command: string, options: RunCommandOptions): Promise<CommandResult> =>
				runBlaxelCommand(sandbox, command, options),

			getInfo: async (sandbox: SandboxInstance): Promise<InstanceInfo> => {
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
			}): Promise<string> =>
				withBlaxelInstance(sandbox, async () => {
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
							ttl: toBlaxelTtl(options.ttl, 'preview')
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
				}),

			// Optional filesystem methods - implement using Blaxel's filesystem API
			filesystem: {
				readFile: async (sandbox: SandboxInstance, path: string): Promise<string> =>
					withBlaxelInstance(sandbox, async () => {
						const result = await sandbox.fs.read(path);
						return result || '';
					}),

				writeFile: async (sandbox: SandboxInstance, path: string, content: string): Promise<void> =>
					withBlaxelInstance(sandbox, async () => {
						await sandbox.fs.write(path, content);
					}),

				mkdir: async (sandbox: SandboxInstance, path: string): Promise<void> =>
					withBlaxelInstance(sandbox, async () => {
						await sandbox.fs.mkdir(path);
					}),

				readdir: async (sandbox: SandboxInstance, path: string): Promise<FileEntry[]> =>
					withBlaxelInstance(sandbox, async () => {
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
					}),

				exists: async (sandbox: SandboxInstance, path: string): Promise<boolean> =>
					withBlaxelInstance(sandbox, async () => {
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
					}),

				remove: async (sandbox: SandboxInstance, path: string): Promise<void> =>
					withBlaxelInstance(sandbox, async () => {
						await sandbox.fs.rm(path);
					})
			},

			// Provider-specific typed getInstance method
			getInstance: (sandbox: SandboxInstance): SandboxInstance => {
				return sandbox;
			},
		},

		snapshot: {
			// Live-observed: a fork restores the whole overlay rootfs (/tmp, home
			// and /opt included) and the source's running processes; the source
			// keeps running.
			capabilities: { scope: 'rootfs', memory: true, destroysSource: false },

			create: async (config: BlaxelConfig, sandboxId: string, options?: CreateSnapshotOptions) =>
				withBlaxelConfig(config, async () => {
					try {
					const snapshot = await Snapshot.create({
						...(options?.name && { name: options.name }),
						source: { name: sandboxId },
					});

					return toSnapshotInfo(snapshot);
					} catch (error) {
						// @blaxel/core calls use throwOnError: the rejection value can be a
						// plain API error object, where String(error) is '[object Object]'.
						const errorDetail = error instanceof Error
							? error.message
							: typeof error === 'object' && error !== null
								? JSON.stringify(error)
								: String(error);
						throw new Error(
							`Failed to create Blaxel snapshot: ${errorDetail}`
						);
					}
				}),

			list: async (config: BlaxelConfig, options?: ListSnapshotsOptions) =>
				withBlaxelConfig(config, async () => {
					if (options?.sandboxId) {
						const sandbox = await SandboxInstance.get(options.sandboxId);
						const snapshots = await sandbox.snapshots.list();
						const infos = snapshots.map(toSnapshotInfo);
						return options.limit ? infos.slice(0, options.limit) : infos;
					}

					// Workspace-wide listing; the page is an auto-paging iterable.
					const snapshots: Snapshot[] = [];
					for await (const snapshot of await Snapshot.list(
						options?.limit ? { limit: Math.min(options.limit, 200) } : undefined
					)) {
						snapshots.push(snapshot);
						if (options?.limit && snapshots.length >= options.limit) break;
					}
					return snapshots.map(toSnapshotInfo);
				}),

			delete: async (config: BlaxelConfig, snapshotId: string) =>
				withBlaxelConfig(config, async () => {
					try {
						await Snapshot.delete(snapshotId);
					} catch (error) {
						// Ignore if not found
					}
				})
		},

		// A Blaxel template is a sandbox image in the workspace registry. The id
		// is its image ref, which create({ templateId }) boots.
		template: {
			create: async (config: BlaxelConfig, options: BlaxelCreateTemplateOptions): Promise<BlaxelTemplateInfo> =>
				withBlaxelConfig(config, () => buildBlaxelTemplate(options)),

			list: async (config: BlaxelConfig, options?: ListTemplatesOptions): Promise<BlaxelTemplateInfo[]> =>
				withBlaxelConfig(config, async () => {
					if (options?.limit === 0) return [];
					const templates: BlaxelTemplateInfo[] = [];
					for (const image of await listSandboxImages()) {
						const name = image.metadata?.name;
						if (!name) continue;
						templates.push(...toTemplateInfos(image, await imageTags(name, image)));
						if (options?.limit !== undefined && templates.length >= options.limit) break;
					}
					return options?.limit === undefined ? templates : templates.slice(0, options.limit);
				}),

			delete: async (config: BlaxelConfig, templateId: string) =>
				withBlaxelConfig(config, async () => {
					const { imageName, tag } = parseTemplateId(templateId);
					const { response, error } = tag
						? await deleteImageTag({ path: { resourceType: SANDBOX_IMAGE_TYPE, imageName, tagName: tag } })
						: await deleteImage({ path: { resourceType: SANDBOX_IMAGE_TYPE, imageName } });
					// Already gone is fine; any other failure is reported.
					if (error !== undefined && response?.status !== 404) {
						throw new Error(`Failed to delete Blaxel template ${templateId}: ${describeError(error)}`);
					}
				}),
		},

		volume: {
			create: async (config: BlaxelConfig, options) =>
				withBlaxelConfig(config, async () => {
					const volume = await VolumeInstance.create({ name: options.name, size: options.sizeBytes ? Math.ceil(options.sizeBytes / (1024 * 1024)) : undefined, region: config.region });
					return { name: volume.name, native: volume };
				}),
			get: async (config: BlaxelConfig, name: string) =>
				withBlaxelConfig(config, async () => {
					try {
						const volume = await VolumeInstance.get(name);
						return { name: volume.name, native: volume };
					} catch { return null; }
				}),
			list: async (config: BlaxelConfig, options) =>
				withBlaxelConfig(config, async () => {
					const page = await VolumeInstance.list({ limit: options?.limit });
					return page.data.map((v) => ({ name: v.name, native: v }));
				}),
			delete: async (config: BlaxelConfig, name: string) =>
				withBlaxelConfig(config, async () => {
					await withVolumeSettle(() => VolumeInstance.delete(name));
				}),
		}
	}
});

/**
 * Map a Blaxel workspace snapshot to the provider-agnostic snapshot shape.
 */
function toSnapshotInfo(snapshot: Snapshot) {
	return {
		id: snapshot.id,
		provider: 'blaxel',
		createdAt: snapshot.createdAt ? new Date(snapshot.createdAt) : new Date(),
		metadata: {
			name: snapshot.name,
			status: snapshot.status,
			sourceSandbox: snapshot.source?.name,
			sourceDeleted: snapshot.source?.deleted,
		}
	};
}

/** Registry resource type of the images sandboxes boot from. */
const SANDBOX_IMAGE_TYPE = 'sandbox';

const TEMPLATE_BUILD_TIMEOUT_MS = 15 * 60_000;
const TEMPLATE_POLL_MS = 2_000;
/** How long a rebuild waits for a new tag before it takes a reused one. */
const TEMPLATE_TAG_SETTLE_MS = 10_000;

/**
 * Build a template with Blaxel's image builder (`POST /images`): the source
 * image gets Blaxel's sandbox API as its entrypoint and is built into the
 * workspace registry. No sandbox is deployed for the build.
 *
 * The registry image is named `<name>-<hash of the build>`. Blaxel reuses an
 * identical build without reporting which tag it reused, so one image per
 * distinct build is what lets the tag be read back exactly.
 */
async function buildBlaxelTemplate(options: BlaxelCreateTemplateOptions): Promise<BlaxelTemplateInfo> {
	const requested = options?.name?.trim();
	if (!requested) throw new Error('A Blaxel template name is required.');
	if (options.description !== undefined || options.metadata !== undefined) {
		throw new Error('Blaxel template builds do not support description or metadata.');
	}
	const source = options.image?.trim();
	if (!source || /\s/.test(source)) {
		throw new Error('A Blaxel template needs an OCI image ref without spaces, e.g. image: \'ubuntu:24.04\'.');
	}
	const dockerfile = [
		`FROM ${source}`,
		`COPY --from=${SANDBOX_API_IMAGE}:latest /sandbox-api ${SANDBOX_API_PATH}`,
		`ENTRYPOINT ["${SANDBOX_API_PATH}"]`,
		'',
	].join('\n');
	const name = `${requested}-${createHash('sha256').update(dockerfile).digest('hex').slice(0, 8)}`;
	const path = { resourceType: SANDBOX_IMAGE_TYPE, imageName: name };

	const before = await getImage({ path });
	if (before.error !== undefined && before.response?.status !== 404) {
		throw new Error(`Failed to read the Blaxel template ${name}: ${describeError(before.error)}`);
	}
	const lastEventBefore = latestEventTime(before.data);
	const tagsBefore = new Set((await imageTags(name, before.data)).map(tag => tag.name));

	await settings.authenticate();
	const created = await fetch(`${settings.baseUrl}/images?upload=true`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...settings.headers },
		body: JSON.stringify({ name, resourceType: SANDBOX_IMAGE_TYPE }),
	});
	const uploadUrl = created.headers.get('x-blaxel-upload-url');
	if (!created.ok || !uploadUrl) {
		throw new Error(`Failed to start the Blaxel template build for ${name}: ${created.status} ${await created.text()}`);
	}
	const uploaded = await fetch(uploadUrl, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/zip' },
		body: zipSingleFile('Dockerfile', Buffer.from(dockerfile)),
	});
	if (!uploaded.ok) {
		throw new Error(`Failed to upload the Blaxel template build for ${name}: ${uploaded.status} ${await uploaded.text()}`);
	}

	// This build is done when the image records a build result newer than
	// any event it had before the upload.
	const deadline = Date.now() + (options.timeout ?? TEMPLATE_BUILD_TIMEOUT_MS);
	let lastStatus = before.data?.metadata?.status;
	let builtSeenAt: number | undefined;
	for (;;) {
		const { data, error, response } = await getImage({ path });
		if (error !== undefined && response?.status !== 404) {
			throw new Error(`Failed to read the Blaxel template ${name}: ${describeError(error)}`);
		}
		const status = data?.metadata?.status;
		if (status && status !== lastStatus) {
			lastStatus = status;
			options.onStatusChange?.(status);
		}
		const result = (data?.metadata?.events ?? []).find(event =>
			eventTime(event) > lastEventBefore && (event.status === 'BUILT' || event.status === 'FAILED'));
		if (result?.status === 'FAILED') {
			throw new Error(`Blaxel failed to build template ${name} from ${source}: ${result.message?.replace(/\s+/g, ' ').trim() || 'build failed'}`);
		}
		// The tag can land a moment after the BUILT event: keep polling until
		// it does. A tag the image already had counts only once no new tag has
		// shown up for TEMPLATE_TAG_SETTLE_MS after the build result, since an
		// identical build reuses its tag without saying so.
		const tags = result ? await imageTags(name, data) : [];
		if (result && builtSeenAt === undefined) builtSeenAt = Date.now();
		const settled = builtSeenAt !== undefined && Date.now() - builtSeenAt >= TEMPLATE_TAG_SETTLE_MS;
		const tag = tags.find(t => t.name && !tagsBefore.has(t.name)) ?? (settled ? newestTag(tags) : undefined);
		if (result && tag?.name) {
			return {
				id: `${SANDBOX_IMAGE_TYPE}/${name}:${tag.name}`,
				name,
				provider: 'blaxel',
				createdAt: tag.createdAt ? new Date(tag.createdAt) : undefined,
				raw: data,
			};
		}
		if (Date.now() >= deadline) {
			const state = result ? 'built but has no tag yet' : `did not finish building in time (last status ${lastStatus ?? 'none'})`;
			throw new Error(`Blaxel template ${name} ${state}.`);
		}
		await new Promise(resolve => setTimeout(resolve, result ? 500 : TEMPLATE_POLL_MS));
	}
}

type BlaxelImageEvent = NonNullable<NonNullable<BlaxelImage['metadata']['events']>[number]>;
type ListPage<T> = { data?: T[]; meta?: { nextCursor?: string } };

function eventTime(event: BlaxelImageEvent): number {
	return Date.parse(event.time ?? '') || 0;
}

function latestEventTime(image: BlaxelImage | undefined): number {
	return Math.max(0, ...(image?.metadata?.events ?? []).map(eventTime));
}

/**
 * Every tag of a sandbox image. From Blaxel API version 2026-09-22 (sent by
 * @blaxel/core 0.3.23 and later) the image is a summary with a tag count and
 * the tags are listed, a page at a time, by `listImageTags`. Older API versions
 * return the tags on the image itself.
 */
async function imageTags(imageName: string, image: BlaxelImage | undefined): Promise<BlaxelImageTag[]> {
	if (!image) return [];
	if ('tags' in image.spec && Array.isArray(image.spec.tags)) return image.spec.tags;
	if ('tagCount' in image.spec && image.spec.tagCount === 0) return [];
	return await allPages<BlaxelImageTag>(async cursor => {
		const { data, error, response } = await listImageTags({
			path: { resourceType: SANDBOX_IMAGE_TYPE, imageName },
			query: { limit: 100, ...(cursor && { cursor }) },
		});
		// Deleted meanwhile: it has no tags.
		if (response?.status === 404) return [];
		if (error !== undefined) {
			throw new Error(`Failed to list the tags of the Blaxel template ${imageName}: ${describeError(error)}`);
		}
		return data;
	});
}

/** The workspace's sandbox images: every page from API 2026-09-22 on, the bare array before it. */
async function listSandboxImages(): Promise<BlaxelImage[]> {
	const images = await allPages<BlaxelImage>(async cursor => {
		const { data } = await listImages({ throwOnError: true, ...(cursor && { query: { cursor } }) });
		return data as BlaxelImage[] | ListPage<BlaxelImage>;
	});
	return images.filter(image => image.metadata?.resourceType === SANDBOX_IMAGE_TYPE);
}

/** Collect a cursor-paged list; a bare array is the whole list. */
async function allPages<T>(fetchPage: (cursor?: string) => Promise<T[] | ListPage<T> | undefined>): Promise<T[]> {
	const items: T[] = [];
	const seen = new Set<string>();
	let cursor: string | undefined;
	do {
		const page = await fetchPage(cursor);
		if (Array.isArray(page)) return [...items, ...page];
		items.push(...(page?.data ?? []));
		cursor = page?.meta?.nextCursor || undefined;
		if (cursor && seen.has(cursor)) throw new Error('Blaxel returned a repeated page cursor.');
		if (cursor) seen.add(cursor);
	} while (cursor);
	return items;
}

function newestTag(tags: BlaxelImageTag[]): BlaxelImageTag | undefined {
	const time = (tag: BlaxelImageTag) => Date.parse(tag.updatedAt ?? tag.createdAt ?? '') || 0;
	return [...tags].sort((a, b) => time(b) - time(a))[0];
}

/** A zip archive holding one uncompressed file: the build context upload. */
function zipSingleFile(fileName: string, content: Buffer): Buffer {
	const nameBytes = Buffer.from(fileName);
	const crc = crc32(content);
	const local = Buffer.alloc(30);
	local.writeUInt32LE(0x04034b50, 0);
	local.writeUInt16LE(20, 4);
	local.writeUInt16LE(0x21, 12); // 1980-01-01
	local.writeUInt32LE(crc, 14);
	local.writeUInt32LE(content.length, 18);
	local.writeUInt32LE(content.length, 22);
	local.writeUInt16LE(nameBytes.length, 26);
	const central = Buffer.alloc(46);
	central.writeUInt32LE(0x02014b50, 0);
	central.writeUInt16LE(20, 4);
	central.writeUInt16LE(20, 6);
	central.writeUInt16LE(0x21, 14);
	central.writeUInt32LE(crc, 16);
	central.writeUInt32LE(content.length, 20);
	central.writeUInt32LE(content.length, 24);
	central.writeUInt16LE(nameBytes.length, 28);
	const centralOffset = local.length + nameBytes.length + content.length;
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(1, 8);
	end.writeUInt16LE(1, 10);
	end.writeUInt32LE(central.length + nameBytes.length, 12);
	end.writeUInt32LE(centralOffset, 16);
	return Buffer.concat([local, nameBytes, content, central, nameBytes, end]);
}

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/** One template per tag of a registry image. */
function toTemplateInfos(image: BlaxelImage, tags: BlaxelImageTag[]): BlaxelTemplateInfo[] {
	const name = image.metadata?.name;
	if (!name) return [];
	return tags
		.filter(tag => tag.name)
		.map(tag => ({
			id: `${SANDBOX_IMAGE_TYPE}/${name}:${tag.name}`,
			name,
			provider: 'blaxel' as const,
			createdAt: tag.createdAt ? new Date(tag.createdAt) : undefined,
			raw: image,
		}));
}

/** `sandbox/<name>:<tag>` → registry image name and tag. A bare `<name>` has no tag, so delete removes all of its tags. */
function parseTemplateId(templateId: string): { imageName: string; tag?: string } {
	const ref = templateId.startsWith(`${SANDBOX_IMAGE_TYPE}/`) ? templateId.slice(SANDBOX_IMAGE_TYPE.length + 1) : templateId;
	const colon = ref.lastIndexOf(':');
	if (colon <= 0) return { imageName: ref };
	return { imageName: ref.slice(0, colon), tag: ref.slice(colon + 1) || undefined };
}

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === 'object' && error !== null) return JSON.stringify(error);
	return String(error);
}

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

/** Native env and working directory fields of a Blaxel process request. */
function processEnvAndCwd(options: RunCommandOptions): { env?: Record<string, string>; workingDir?: string } {
	return {
		...(options.env && Object.keys(options.env).length > 0 && { env: options.env }),
		...(options.cwd && { workingDir: options.cwd }),
	};
}

/**
 * Run a command through Blaxel's process API. Env and cwd go in the request's
 * native fields so every part of a compound command sees them; background
 * commands are started without waiting for completion.
 */
async function runBlaxelCommand(
	sandbox: SandboxInstance,
	command: string,
	options: RunCommandOptions = {}
): Promise<CommandResult> {
	return withBlaxelInstance(sandbox, async () => {
		const startTime = Date.now();
		try {
			if (options.background) {
				await sandbox.process.exec({ command, waitForCompletion: false, ...processEnvAndCwd(options) });
				return { stdout: '', stderr: '', exitCode: 0, durationMs: Date.now() - startTime };
			}
			const { stdout, stderr, exitCode } = await executeWithStreaming(sandbox, command, options);
			return { stdout, stderr, exitCode, durationMs: Date.now() - startTime };
		} catch (error) {
			return {
				stdout: '',
				stderr: error instanceof Error ? error.message : String(error),
				exitCode: 127,
				durationMs: Date.now() - startTime,
			};
		}
	});
}

/**
 * Resolve with the exec result, or kill the named process and reject once the
 * command outruns its deadline (exec's streamed response only ends on exit).
 */
async function raceProcessDeadline<T>(
	sandbox: SandboxInstance,
	execPromise: Promise<T>,
	processName: string,
	timeoutMs: number
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`Command timed out after ${timeoutMs}ms`)), timeoutMs);
	});
	try {
		return await Promise.race([execPromise, deadline]);
	} catch (error) {
		execPromise.catch(() => {});
		try {
			await sandbox.process.kill(processName);
		} catch {
			// Process may have already exited
		}
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

/** Process statuses from which no more output will arrive. */
const TERMINAL_PROCESS_STATUSES = new Set(['completed', 'failed', 'stopped', 'killed']);

/** How long to poll for a still-running process when no command timeout is set. */
const DEFAULT_PROCESS_WAIT_MS = 5 * 60 * 1000;

/** Grace period for the live log stream to deliver its final bytes after the process goes terminal. */
const STREAM_DRAIN_MS = 2000;

/**
 * Execute a command in the sandbox and capture stdout/stderr
 */
async function executeWithStreaming(
	sandbox: SandboxInstance,
	command: string,
	options: RunCommandOptions = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const timeoutMs = options.timeout;
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
	// A named process can be killed before exec resolves; the request's native
	// timeout (seconds) lets the box stop it even if the kill is lost.
	const processName = timeoutMs !== undefined ? `csdk-${randomUUID().slice(0, 12)}` : undefined;
	const execPromise = sandbox.process.exec({
		command,
		waitForCompletion: true,
		...processEnvAndCwd(options),
		...(processName && { name: processName, timeout: Math.max(1, Math.ceil(timeoutMs! / 1000)) }),
		onStdout: (chunk) => {
			stdoutLines.push(chunk);
			options.onStdout?.(chunk);
		},
		onStderr: (chunk) => {
			stderrLines.push(chunk);
			options.onStderr?.(chunk);
		},
	});
	const processResult = processName
		? await raceProcessDeadline(sandbox, execPromise, processName, timeoutMs!)
		: await execPromise;

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
		// Forward a channel's stream lines only when exec delivered nothing on
		// it, so a caller never sees the same output twice.
		const logStream = sandbox.process.streamLogs(pid, {
			onStdout: (line) => {
				streamStdoutLines.push(line);
				if (stdoutLines.length === 0) options.onStdout?.(`${line}\n`);
			},
			onStderr: (line) => {
				streamStderrLines.push(line);
				if (stderrLines.length === 0) options.onStderr?.(`${line}\n`);
			},
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

	let exitCode = result.exitCode ?? 0;
	if (result.status === 'failed' && exitCode === 0) {
		exitCode = 1;
	}

	return { stdout, stderr, exitCode };
}

// Export the Blaxel SandboxInstance type for explicit typing
export type { SandboxInstance as BlaxelSandbox } from '@blaxel/core';
