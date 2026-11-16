/**
 * CoreWeave Sandboxes provider for ComputeSDK, a thin adapter over @coreweave/cwsandbox.
 */

import { CWSandboxNotFoundError, type FileSystemSnapshotResult, type Sandbox, type SandboxClient, type SandboxRunOptions, type SandboxStatus } from '@coreweave/cwsandbox';
import { createSandboxClient } from '@coreweave/cwsandbox/node';
import { defineProvider, escapeShellArg } from '@computesdk/provider';
import type { CommandResult, CreateInstanceOptions, CreateTemplateOptions, FileEntry, InstanceInfo, ListTemplatesOptions, RunCommandOptions } from '@computesdk/provider';

const ADAPTER_TAG = 'computesdk';
/** Assigned HTTPS hostnames can show up a little after the sandbox reaches `running`. */
const URL_WAIT_MS = 60_000;
const URL_POLL_MS = 1_000;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** CoreWeave snapshots archive one scratch volume, not the whole container. */
const DEFAULT_SNAPSHOT_MOUNT_PATH = '/work';
/** Template administration lives on the control plane, not the sandbox data plane. */
const DEFAULT_CONTROL_PLANE_URL = 'https://api.coreweave.com';

export interface CoreWeaveConfig {
  /** CoreWeave API access token; falls back to CWSANDBOX_API_KEY. */
  apiKey?: string;
  /** Sandbox API endpoint; falls back to CWSANDBOX_BASE_URL, then https://api.cwsandbox.com. */
  baseUrl?: string;
  /** Default container image. The SDK default is `python:3.11`. */
  image?: string;
  /** Default CPU cores. */
  cpu?: number;
  /** Default memory in MiB. */
  memory?: number;
  /** Default maximum sandbox lifetime in milliseconds. */
  timeout?: number;
  /** Mount scratch volume for snapshots on every sandbox (also a per-create option). */
  snapshotVolume?: boolean;
  /** Where the snapshot volume is mounted. Defaults to `/work`. */
  snapshotMountPath?: string;
  /** Snapshot volume size as a Kubernetes quantity, e.g. `10Gi`. Omit for the platform default. */
  snapshotVolumeSize?: string;
  /** Control plane endpoint for template management. Defaults to https://api.coreweave.com. */
  controlPlaneUrl?: string;
}

export interface CoreWeaveSnapshot {
  id: string;
  provider: 'coreweave';
  createdAt: Date;
  metadata: Record<string, unknown>;
}

export interface CoreWeaveTemplate {
  id: string;
  name: string;
  provider: 'coreweave';
  revision?: string;
  createdAt?: Date;
  updatedAt?: Date;
  /** True when the template carries admin attachments and must run on CKS. */
  requiresCks?: boolean;
  /** The stored partial sandbox spec. */
  spec?: Record<string, unknown>;
}

export interface CoreWeaveCreateTemplateOptions extends CreateTemplateOptions {
  /** Shorthand for a single `main` container with this image. */
  image?: string;
  /** Partial sandbox spec, as in CoreWeave's template documents (containers, maxLifetimeSeconds, services, tags, ...). */
  spec?: Record<string, unknown>;
  /** Idempotency token: retries with the same token return the original template. */
  requestId?: string;
}

interface SandboxTemplateRecord {
  sandboxTemplateId: string;
  displayName: string;
  spec?: Record<string, unknown>;
  revision?: string;
  createTime?: string;
  updateTime?: string;
  requiresCks?: boolean;
}

const env = (name: string): string | undefined =>
  typeof process !== 'undefined' ? process.env?.[name] : undefined;

/** Credentials are checked when a call needs them; building the client does no I/O. */
function apiKeyOf(config: CoreWeaveConfig): string {
  const apiKey = (config.apiKey || env('CWSANDBOX_API_KEY'))?.trim();
  if (!apiKey) {
    throw new Error(
      'Missing CoreWeave Sandboxes API key: pass coreweave({ apiKey }) or set CWSANDBOX_API_KEY to a CoreWeave API access token. ' +
      'See https://docs.coreweave.com/products/sandboxes'
    );
  }
  return apiKey;
}

function client(config: CoreWeaveConfig): SandboxClient {
  const apiKey = apiKeyOf(config);
  const baseUrl = (config.baseUrl || env('CWSANDBOX_BASE_URL'))?.trim();
  return createSandboxClient({ apiKey, ...(baseUrl ? { baseUrl } : {}) });
}

export function createOptions(config: CoreWeaveConfig, options: CreateInstanceOptions = {}): SandboxRunOptions {
  const mountPath = config.snapshotMountPath ?? DEFAULT_SNAPSHOT_MOUNT_PATH;
  const size = config.snapshotVolumeSize;
  const snapshotVolume = options.snapshotId !== undefined || (options.snapshotVolume ?? config.snapshotVolume) === true;
  const cpu = options.cpu ?? config.cpu;
  const memory = options.memory ?? config.memory;
  const timeout = options.timeout ?? config.timeout;
  const image = options.image ?? (options.templateId === undefined ? config.image : undefined);
  const ports: number[] = Array.isArray(options.ports) ? options.ports : [];
  return {
    ...(image !== undefined ? { containerImage: image } : {}),
    ...(cpu !== undefined || memory !== undefined
      ? { resources: { ...(cpu !== undefined ? { cpu: String(cpu) } : {}), ...(memory !== undefined ? { memory: `${memory}Mi` } : {}) } }
      : {}),
    ...(timeout !== undefined ? { maxLifetimeSeconds: Math.ceil(timeout / 1000) } : {}),
    ...(options.envs ? { environmentVariables: options.envs } : {}),
    ...(options.name ? { annotations: { name: options.name } } : {}),
    // A port must be requested at create to get a public HTTPS URL for it.
    ...(ports.length > 0
      ? { services: ports.map((port) => ({ port, visibility: 'public' as const, endpoint: { kind: 'https' as const, auth: 'open' as const } })) }
      : {}),
    ...(snapshotVolume
      ? {
          fileSystemSnapshot: {
            mountPath,
            ...(size ? { size } : {}),
            ...(options.snapshotId !== undefined ? { restoreFromSnapshotId: options.snapshotId } : {}),
          },
        }
      : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    tags: [ADAPTER_TAG],
  };
}

/** The argv sent to the sandbox. Env goes through `env` as separate arguments, so values need no quoting. */
export function commandArgv(command: string, options: RunCommandOptions = {}): string[] {
  const vars = Object.entries(options.env ?? {});
  for (const [name] of vars) {
    if (!ENV_NAME.test(name)) throw new Error(`Invalid environment variable name: ${name}`);
  }
  const script = options.background ? `nohup sh -c "${escapeShellArg(command)}" >/dev/null 2>&1 &` : command;
  const shell = ['/bin/sh', '-c', script];
  return vars.length > 0 ? ['/usr/bin/env', ...vars.map(([k, v]) => `${k}=${v}`), ...shell] : shell;
}

function status(value: SandboxStatus | undefined): InstanceInfo['status'] {
  switch (value) {
    case 'pending':
    case 'creating':
    case 'running':
      return 'running';
    case 'failed':
      return 'error';
    default:
      return 'stopped';
  }
}

/** Parses `ls -la` output; works with GNU coreutils and busybox. */
export function parseLs(stdout: string): FileEntry[] {
  const entries: FileEntry[] = [];
  for (const line of stdout.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 9 || line.startsWith('total ')) continue;
    const name = parts.slice(8).join(' ').replace(/ -> .*$/, '');
    if (name === '.' || name === '..') continue;
    const size = Number.parseInt(parts[4], 10);
    entries.push({ name, type: parts[0].startsWith('d') ? 'directory' : 'file', ...(Number.isFinite(size) ? { size } : {}) });
  }
  return entries;
}

function toSnapshot(record: FileSystemSnapshotResult): CoreWeaveSnapshot {
  return {
    id: record.snapshotId,
    provider: 'coreweave',
    createdAt: record.createdAt ?? new Date(),
    metadata: {
      state: record.state,
      ...(record.sourceSandboxId ? { sourceSandboxId: record.sourceSandboxId } : {}),
      ...(record.sizeBytes !== undefined ? { sizeBytes: record.sizeBytes } : {}),
      ...(record.stateReason ? { stateReason: record.stateReason } : {}),
    },
  };
}

function toTemplate(record: SandboxTemplateRecord): CoreWeaveTemplate {
  return {
    id: record.sandboxTemplateId,
    name: record.displayName,
    provider: 'coreweave',
    ...(record.revision !== undefined ? { revision: record.revision } : {}),
    ...(record.createTime ? { createdAt: new Date(record.createTime) } : {}),
    ...(record.updateTime ? { updatedAt: new Date(record.updateTime) } : {}),
    ...(record.requiresCks !== undefined ? { requiresCks: record.requiresCks } : {}),
    ...(record.spec ? { spec: record.spec } : {}),
  };
}

/** Builds the template document sent to POST /v1/sandboxTemplates. */
export function templateBody(options: CoreWeaveCreateTemplateOptions): { displayName: string; spec: Record<string, unknown> } {
  const displayName = options.name?.trim();
  if (!displayName) throw new Error('A CoreWeave template name is required.');
  if (options.description !== undefined || options.metadata !== undefined) {
    throw new Error('CoreWeave templates have no description or metadata; put annotations or tags in `spec` instead.');
  }
  if (options.image !== undefined && options.spec?.containers !== undefined) {
    throw new Error('Pass either `image` or `spec.containers` for a CoreWeave template, not both.');
  }
  return {
    displayName,
    spec: { ...options.spec, ...(options.image !== undefined ? { containers: [{ name: 'main', image: options.image }] } : {}) },
  };
}

/** Calls the CoreWeave control plane REST API (documented OpenAPI: SandboxTemplateService). */
async function controlPlane(config: CoreWeaveConfig, method: string, path: string, body?: unknown): Promise<Response> {
  const base = (config.controlPlaneUrl || DEFAULT_CONTROL_PLANE_URL).replace(/\/+$/, '');
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKeyOf(config)}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok && !(method === 'DELETE' && res.status === 404)) {
    const text = await res.text().catch(() => '');
    let message = text;
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {
      // not JSON
    }
    throw new Error(`CoreWeave ${method} ${path} failed (${res.status}): ${message || res.statusText}`);
  }
  return res;
}

async function shell(sandbox: Sandbox, script: string, what: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await sandbox.commands.run(['/bin/sh', '-c', script]);
  if (result.exitCode !== 0) throw new Error(`${what} failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}

export const coreweave = defineProvider<Sandbox, CoreWeaveConfig, CoreWeaveTemplate, CoreWeaveSnapshot>({
  name: 'coreweave',
  methods: {
    instances: {
      create: async (config, options = {}) => {
        const sdk = client(config);
        const request = createOptions(config, options);
        // create() and runFromTemplate() wait for `running` by default.
        const sandbox = options.templateId !== undefined
          ? await sdk.runFromTemplate(options.templateId, request)
          : await sdk.create(request);
        return { instance: sandbox, instanceId: sandbox.sandboxId };
      },

      getById: async (config, instanceId) => {
        try {
          const sandbox = await client(config).fromId(instanceId);
          return { instance: sandbox, instanceId: sandbox.sandboxId };
        } catch (error) {
          if (error instanceof CWSandboxNotFoundError) return null;
          throw error;
        }
      },

      // Lists active (not ended) sandboxes this provider created.
      list: async (config) =>
        (await client(config).listAll({ tags: [ADAPTER_TAG] })).map((sandbox) => ({ instance: sandbox, instanceId: sandbox.sandboxId })),

      destroy: async (config, instanceId) => {
        await client(config).delete(instanceId, { missingOk: true });
      },

      runCommand: async (sandbox, command, options: RunCommandOptions = {}): Promise<CommandResult> => {
        const start = Date.now();
        const result = await sandbox.commands.run(commandArgv(command, options), {
          ...(options.cwd ? { cwd: options.cwd } : {}),
          ...(options.timeout !== undefined && !options.background ? { timeoutMs: options.timeout } : {}),
        });
        return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, durationMs: Date.now() - start };
      },

      getInfo: async (sandbox): Promise<InstanceInfo> => {
        const info = await sandbox.inspect();
        return {
          id: sandbox.sandboxId,
          provider: 'coreweave',
          status: status(info.status),
          createdAt: info.createdAt ?? info.startedAt ?? new Date(),
          timeout: 0,
          metadata: {
            status: info.status,
            ...(info.runnerId ? { runnerId: info.runnerId } : {}),
            ...(info.statusReason ? { statusReason: info.statusReason } : {}),
          },
        };
      },

      getUrl: async (sandbox, { port, protocol }) => {
        const deadline = Date.now() + URL_WAIT_MS;
        for (;;) {
          const info = await sandbox.inspect();
          const match = info.serviceUrls?.find((service) => service.port === port && service.url.startsWith('https://'));
          if (match) {
            const url = new URL(match.url);
            if (protocol) url.protocol = `${protocol}:`;
            return url.toString();
          }
          if (Date.now() >= deadline) {
            throw new Error(`CoreWeave sandbox ${sandbox.sandboxId} has no HTTPS URL for port ${port}. Request the port at create with { ports: [${port}] }.`);
          }
          await new Promise((resolve) => setTimeout(resolve, URL_POLL_MS));
        }
      },

      getInstance: (sandbox) => sandbox,

      filesystem: {
        readFile: (sandbox, path) => sandbox.files.readText(path),
        writeFile: async (sandbox, path, content) => {
          const parent = path.slice(0, path.lastIndexOf('/'));
          if (parent) await shell(sandbox, `mkdir -p "${escapeShellArg(parent)}"`, `mkdir ${parent}`);
          await sandbox.files.write(path, content);
        },
        mkdir: async (sandbox, path) => {
          await shell(sandbox, `mkdir -p "${escapeShellArg(path)}"`, `mkdir ${path}`);
        },
        readdir: async (sandbox, path) => parseLs((await shell(sandbox, `ls -la "${escapeShellArg(path)}"`, `readdir ${path}`)).stdout),
        exists: async (sandbox, path) =>
          (await sandbox.commands.run(['/bin/sh', '-c', `test -e "${escapeShellArg(path)}"`])).exitCode === 0,
        remove: async (sandbox, path) => {
          await shell(sandbox, `rm -rf "${escapeShellArg(path)}"`, `remove ${path}`);
        },
      },
    },

    // Organization-scoped templates on the control plane. Writes need the Sandbox Admin role;
    // start a sandbox from one with create({ templateId }).
    template: {
      create: async (config: CoreWeaveConfig, options: CoreWeaveCreateTemplateOptions): Promise<CoreWeaveTemplate> => {
        const query = options.requestId ? `?requestId=${encodeURIComponent(options.requestId)}` : '';
        const res = await controlPlane(config, 'POST', `/v1/sandboxTemplates${query}`, templateBody(options));
        return toTemplate((await res.json()) as SandboxTemplateRecord);
      },
      list: async (config: CoreWeaveConfig, options?: ListTemplatesOptions): Promise<CoreWeaveTemplate[]> => {
        const limit = options?.limit;
        const templates: CoreWeaveTemplate[] = [];
        let pageToken = '';
        do {
          if (limit !== undefined && templates.length >= limit) break;
          const params = new URLSearchParams();
          if (limit !== undefined) params.set('pageSize', String(limit - templates.length));
          if (pageToken) params.set('pageToken', pageToken);
          const query = params.toString() ? `?${params}` : '';
          const page = (await (await controlPlane(config, 'GET', `/v1/sandboxTemplates${query}`)).json()) as {
            sandboxTemplates?: SandboxTemplateRecord[];
            nextPageToken?: string;
          };
          templates.push(...(page.sandboxTemplates ?? []).map(toTemplate));
          pageToken = page.nextPageToken ?? '';
        } while (pageToken);
        return limit !== undefined ? templates.slice(0, limit) : templates;
      },
      // Soft delete; sandboxes already created from the template are unaffected.
      delete: async (config: CoreWeaveConfig, templateId: string): Promise<void> => {
        await controlPlane(config, 'DELETE', `/v1/sandboxTemplates/${encodeURIComponent(templateId)}`);
      },
    },

    // Snapshots archive the scratch volume at `snapshotMountPath`, so the source
    // must be created with `snapshotVolume: true`. `sandbox.snapshot()` waits for READY.
    snapshot: {
      capabilities: {
        scope: 'volume',
        path: DEFAULT_SNAPSHOT_MOUNT_PATH,
        memory: false,
        destroysSource: false,
        source: 'kept',
        fork: true,
        readiness: 'immediate',
        createOptions: { snapshotVolume: true },
      },
      create: async (config, instanceId) => {
        const sandbox = await client(config).fromId(instanceId);
        return toSnapshot(await sandbox.snapshot());
      },
      list: async (config) => (await client(config).listSnapshots()).map(toSnapshot),
      delete: async (config, snapshotId) => {
        await client(config).deleteSnapshot(snapshotId, { missingOk: true });
      },
    },
  },
});
