/**
 * MCP tool surface for the ComputeSDK ChatGPT plugin.
 *
 * Default mode is first-party: the caller's bearer token is their ComputeSDK
 * API key, and sandboxes route through the platform's provider order (or its
 * compute market) — no provider credentials needed, just a positive balance.
 * BYOK providers are an opt-in for technical users via
 * set_provider_credentials.
 *
 * Credential values are write-only — tools return field names and status,
 * never secret material.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Provider, ProviderSandbox } from '@computesdk/provider';
import { CredentialVault } from './vault.js';
import { PROVIDERS, getProvider } from './providers.js';
import { gatewayClient, GatewayApiError } from './gateway.js';
import { PANEL_HTML, PANEL_MIME, PANEL_URI } from './panel.js';

const PANEL_META = { 'openai/outputTemplate': PANEL_URI };

// Labels the plugin stamps on gateway sandboxes; the panel and list filter
// scope to them so org pool boxes (`sb-pool-*`) and Actions sandboxes
// don't leak in.
const PLUGIN_LABEL_PREFIX = 'chatgpt-plugin';
const MAX_SANDBOX_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const MAX_COMMAND_TIMEOUT_MS = 290_000;
const MAX_COMMAND_BYTES = 64 * 1024;
const MAX_FILE_CONTENT_BYTES = 32 * 1024 * 1024;

interface RequestContext {
  userId: string;
  /** The caller's bearer token — the ComputeSDK API key in first-party mode. */
  token: string;
  vault: CredentialVault;
}

// In-memory handles: userId:provider:sandboxId -> sandbox
const sandboxCache = new Map<string, ProviderSandbox>();

function cacheKey(userId: string, provider: string, sandboxId: string): string {
  return `${userId}:${provider}:${sandboxId}`;
}

function requireProvider(name: string) {
  const spec = getProvider(name);
  if (!spec) {
    throw new Error(`Unknown provider "${name}". Call list_providers to see supported providers.`);
  }
  return spec;
}

function requireFirstParty(name: string) {
  const spec = requireProvider(name);
  if (!spec.firstParty) {
    throw new Error(`"${name}" is a BYOK provider — this tool only applies to first-party computesdk sandboxes.`);
  }
}

function buildProvider(ctx: RequestContext, name: string): Provider {
  const spec = requireProvider(name);
  if (spec.firstParty) return spec.create({}, ctx.token);
  const credentials = ctx.vault.getCredentials(ctx.userId, name);
  if (!credentials) {
    throw new Error(
      `No credentials configured for "${name}". ` +
        `Required fields: ${spec.credentialFields.filter((f) => f.required).map((f) => f.key).join(', ')}. ` +
        'Call set_provider_credentials first — or omit `provider` to use first-party ComputeSDK compute.'
    );
  }
  return spec.create(credentials, ctx.token);
}

async function resolveSandbox(
  ctx: RequestContext,
  providerName: string,
  sandboxId: string
): Promise<{ provider: Provider; sandbox: ProviderSandbox }> {
  const key = cacheKey(ctx.userId, providerName, sandboxId);
  const cached = sandboxCache.get(key);
  const provider = buildProvider(ctx, providerName);
  if (cached) return { provider, sandbox: cached };

  const found = await provider.sandbox.getById(sandboxId);
  if (!found) {
    throw new Error(`Sandbox "${sandboxId}" not found on provider "${providerName}".`);
  }
  sandboxCache.set(key, found);
  return { provider, sandbox: found };
}

const providerName = z
  .string()
  .describe(`Sandbox provider name. One of: ${PROVIDERS.map((p) => p.name).join(', ')}`);

// Sandbox-operation tools default to first-party computesdk; BYOK providers
// are used only when explicitly named.
const sandboxProvider = providerName
  .optional()
  .default('computesdk')
  .describe(
    `Sandbox provider. Defaults to "computesdk" (first-party — billed to your ComputeSDK account balance, no provider keys needed). Other providers require set_provider_credentials first.`,
  );

const gatewayOnly = (name: string): string => {
  requireFirstParty(name);
  return name;
};

const textResult = (structured: Record<string, unknown>, text: string): CallToolResult => ({
  structuredContent: structured,
  content: [{ type: 'text', text }],
});

export function registerTools(server: McpServer, ctx: RequestContext): void {
  server.registerResource(
    'sandboxes-panel',
    PANEL_URI,
    { mimeType: PANEL_MIME, description: 'ComputeSDK sandboxes panel' },
    async () => ({ contents: [{ uri: PANEL_URI, mimeType: PANEL_MIME, text: PANEL_HTML }] })
  );

  server.registerTool(
    'list_providers',
    {
      title: 'List sandbox providers',
      description:
        'List the sandbox providers available through this plugin, the credential fields each requires, and whether the current user has configured credentials.',
      annotations: { readOnlyHint: true },
    },
    async () => ({
      structuredContent: {
        providers: PROVIDERS.map((p) => ({
          name: p.name,
          description: p.description,
          firstParty: Boolean(p.firstParty),
          credentialFields: p.credentialFields,
          configured: p.firstParty ? true : ctx.vault.hasCredentials(ctx.userId, p.name),
        })),
      },
      content: [
        {
          type: 'text',
          text: PROVIDERS.map(
            (p) =>
              `${p.name}: ${p.firstParty ? 'first-party (ready — your ComputeSDK account)' : ctx.vault.hasCredentials(ctx.userId, p.name) ? 'configured' : 'no credentials'}`
          ).join('\n'),
        },
      ],
    })
  );

  server.registerTool(
    'set_provider_credentials',
    {
      title: 'Set provider credentials',
      description:
        'Store BYOK credentials for a sandbox provider. Values are encrypted at rest and are never returned by any tool. Call list_providers to see which fields a provider requires. Not needed for the default first-party computesdk provider.',
      inputSchema: {
        provider: providerName,
        credentials: z
          .record(z.string(), z.string())
          .describe('Map of credential field name to value, e.g. { "apiKey": "e2b_..." }'),
      },
      annotations: { destructiveHint: false },
    },
    async ({ provider, credentials }: { provider: string; credentials: Record<string, string> }) => {
      const spec = requireProvider(provider);
      const missing = spec.credentialFields.filter((f) => f.required && !credentials[f.key]);
      if (missing.length > 0) {
        throw new Error(`Missing required credential fields: ${missing.map((f) => f.key).join(', ')}`);
      }
      const allowed = new Set(spec.credentialFields.map((f) => f.key));
      for (const key of Object.keys(credentials)) {
        if (!allowed.has(key)) {
          throw new Error(`Unknown credential field "${key}" for provider "${provider}".`);
        }
      }
      ctx.vault.setCredentials(ctx.userId, provider, credentials);
      return textResult(
        { provider, stored: Object.keys(credentials) },
        `Credentials stored for ${provider}.`
      );
    }
  );

  server.registerTool(
    'remove_provider_credentials',
    {
      title: 'Remove provider credentials',
      description: 'Delete stored BYOK credentials for a provider.',
      inputSchema: { provider: providerName },
      annotations: { destructiveHint: true },
    },
    async ({ provider }) => {
      const removed = ctx.vault.removeCredentials(ctx.userId, provider);
      return textResult(
        { provider, removed },
        removed ? `Removed credentials for ${provider}.` : `No credentials stored for ${provider}.`
      );
    }
  );

  server.registerTool(
    'create_sandbox',
    {
      title: 'Create sandbox',
      description:
        'Create a new sandbox. With the default computesdk provider it is placed across your account\'s provider order or compute market — pass provider_order to pin routing (e.g. ["namespace:us-east"], or ["market"] to force a market fill).',
      inputSchema: {
        provider: sandboxProvider,
        label: z.string().max(200).optional().describe('Human-readable label (first-party only; must not start with "sb-pool")'),
        timeout: z.number().int().max(MAX_SANDBOX_TIMEOUT_MS).optional().describe('Sandbox lifetime in milliseconds (max 6h, default 30m)'),
        templateId: z.string().optional().describe('Provider template/image ID to boot from'),
        image: z.string().max(500).optional().describe('Container/VM image to boot (first-party only)'),
        snapshotId: z.string().max(500).optional().describe('Snapshot to restore the sandbox from (first-party only)'),
        provider_order: z
          .array(z.string().regex(/^[a-z0-9-]+(:[a-z0-9-]+)?$/i))
          .max(8)
          .optional()
          .describe('Provider routing preference, "provider[:region]" entries; "market" allowed (first-party only)'),
        resources: z
          .object({
            cpus: z.number().positive().optional(),
            memoryMb: z.number().positive().optional(),
            ephemeralDiskMb: z.number().positive().optional(),
          })
          .optional()
          .describe('Requested sizing (first-party only)'),
        secrets: z
          .array(z.string().regex(/^[A-Za-z0-9_]+$/))
          .max(100)
          .optional()
          .describe('Names of org vault secrets to inject as env vars into commands (first-party only)'),
        envs: z.record(z.string(), z.string()).optional().describe('Environment variables to set inside the sandbox (BYOK providers only)'),
      },
      outputSchema: {
        sandbox_id: z.string(),
        provider: z.string(),
      },
      annotations: { openWorldHint: true },
      _meta: PANEL_META,
    },
    async ({ provider: name, label, timeout, templateId, image, snapshotId, provider_order, resources, secrets, envs }: {
      provider: string;
      label?: string;
      timeout?: number;
      templateId?: string;
      image?: string;
      snapshotId?: string;
      provider_order?: string[];
      resources?: { cpus?: number; memoryMb?: number; ephemeralDiskMb?: number };
      secrets?: string[];
      envs?: Record<string, string>;
    }) => {
      const provider = buildProvider(ctx, name);
      const firstParty = Boolean(requireProvider(name).firstParty);
      if (!firstParty && (provider_order || image || resources || secrets || label)) {
        throw new Error(
          'label/image/resources/secrets/provider_order are first-party computesdk options — BYOK providers accept timeout/templateId/envs only.'
        );
      }
      const sandbox = await provider.sandbox.create({
        timeout,
        templateId,
        envs,
        name: label ?? `${PLUGIN_LABEL_PREFIX}-${Date.now().toString(36)}`,
        image,
        snapshotId,
        metadata: {
          ...(provider_order ? { providerOrder: provider_order } : {}),
          ...(resources ? { resources } : {}),
          ...(secrets ? { secrets } : {}),
        },
      });
      sandboxCache.set(cacheKey(ctx.userId, name, sandbox.sandboxId), sandbox);
      return textResult(
        { sandbox_id: sandbox.sandboxId, provider: name },
        `Created ${name} sandbox ${sandbox.sandboxId}.`
      );
    }
  );

  server.registerTool(
    'list_sandboxes',
    {
      title: 'List sandboxes',
      description: 'List active sandboxes on a provider. First-party results can be scoped to sandboxes this plugin created via label_prefix.',
      inputSchema: {
        provider: sandboxProvider,
        label_prefix: z.string().optional().describe('Only return first-party sandboxes whose label starts with this (e.g. "chatgpt-plugin")'),
      },
      annotations: { readOnlyHint: true },
      _meta: PANEL_META,
    },
    async ({ provider: name, label_prefix }) => {
      const provider = buildProvider(ctx, name);
      const sandboxes = await provider.sandbox.list();
      const infos = await Promise.all(
        sandboxes.map(async (s) => {
          try {
            return await s.getInfo();
          } catch {
            return { id: s.sandboxId };
          }
        })
      );
      const filtered = label_prefix
        ? infos.filter((i) => {
            const label = (i as { metadata?: { label?: unknown } }).metadata?.label;
            return typeof label === 'string' && label.startsWith(label_prefix);
          })
        : infos;
      return textResult(
        { provider: name, sandboxes: filtered },
        `${filtered.length} sandbox(es) on ${name}.`
      );
    }
  );

  server.registerTool(
    'run_command',
    {
      title: 'Run command in sandbox',
      description: `Execute a shell command inside a sandbox and return stdout, stderr, and exit code. Bounded: max ${MAX_COMMAND_BYTES / 1024}KB command, ~${MAX_COMMAND_TIMEOUT_MS / 1000}s timeout on first-party. For long-running work use start_process instead.`,
      inputSchema: {
        provider: sandboxProvider,
        sandbox_id: z.string(),
        command: z.string().max(MAX_COMMAND_BYTES).describe('Shell command to execute'),
        timeout: z.number().int().max(MAX_COMMAND_TIMEOUT_MS).optional().describe('Command timeout in milliseconds'),
      },
      outputSchema: {
        stdout: z.string().optional(),
        stderr: z.string().optional(),
        exit_code: z.number().optional(),
      },
      annotations: { openWorldHint: true, destructiveHint: true },
    },
    async ({ provider: name, sandbox_id, command, timeout }) => {
      const { sandbox } = await resolveSandbox(ctx, name, sandbox_id);
      const result = await sandbox.runCommand(command, { timeout });
      const exitCode = result.exitCode;
      return textResult(
        { stdout: result.stdout, stderr: result.stderr, exit_code: exitCode },
        `exit ${exitCode ?? '?'}\n${result.stdout ?? ''}${result.stderr ? `\nstderr: ${result.stderr}` : ''}`
      );
    }
  );

  server.registerTool(
    'start_process',
    {
      title: 'Start detached process in sandbox',
      description:
        'Start a detached, long-running process in a first-party computesdk sandbox. Returns a job_id for process_status / wait_process / kill_process. Use for servers, watchers, builds — anything that outlives the ~290s run_command cap.',
      inputSchema: {
        provider: sandboxProvider,
        sandbox_id: z.string(),
        command: z.string().max(MAX_COMMAND_BYTES),
        cwd: z.string().optional(),
        env: z.record(z.string(), z.string()).optional(),
      },
      outputSchema: { job_id: z.string(), status: z.string().optional() },
      annotations: { openWorldHint: true, destructiveHint: true },
    },
    async ({ provider: name, sandbox_id, command, cwd, env }) => {
      gatewayOnly(name);
      const client = gatewayClient({ apiKey: ctx.token });
      const p = await client.startProcess(sandbox_id, { command, cwd, env });
      return textResult(
        { job_id: p.jobId, status: p.status, pid: p.pid },
        `Started process ${p.jobId} (${p.status}).`
      );
    }
  );

  server.registerTool(
    'list_processes',
    {
      title: 'List sandbox processes',
      description: 'List detached processes started in a first-party computesdk sandbox.',
      inputSchema: { provider: sandboxProvider, sandbox_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ provider: name, sandbox_id }) => {
      gatewayOnly(name);
      const client = gatewayClient({ apiKey: ctx.token });
      const processes = await client.listProcesses(sandbox_id);
      return textResult(
        { processes },
        processes.map((p) => `${p.jobId} ${p.status} exit=${p.exitCode ?? '—'} ${p.command}`).join('\n') || 'No processes.'
      );
    }
  );

  server.registerTool(
    'process_status',
    {
      title: 'Get process output',
      description: 'Fetch a detached process\'s status plus buffered stdout/stderr (first-party computesdk only).',
      inputSchema: {
        provider: sandboxProvider,
        sandbox_id: z.string(),
        job_id: z.string(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ provider: name, sandbox_id, job_id }) => {
      gatewayOnly(name);
      const client = gatewayClient({ apiKey: ctx.token });
      const p = await client.getProcess(sandbox_id, job_id);
      return textResult(
        { process: p },
        `${p.jobId} ${p.status}${p.exitCode !== null ? ` exit=${p.exitCode}` : ''}\n${p.stdout}${p.stderr ? `\nstderr: ${p.stderr}` : ''}`
      );
    }
  );

  server.registerTool(
    'wait_process',
    {
      title: 'Wait for process exit',
      description: 'Block until a detached process exits (bounded by timeout; the job keeps running on timeout). First-party computesdk only.',
      inputSchema: {
        provider: sandboxProvider,
        sandbox_id: z.string(),
        job_id: z.string(),
        timeout: z.number().int().optional().describe('Wait bound in milliseconds'),
      },
      annotations: { openWorldHint: true },
    },
    async ({ provider: name, sandbox_id, job_id, timeout }) => {
      gatewayOnly(name);
      const client = gatewayClient({ apiKey: ctx.token });
      const p = await client.waitProcess(sandbox_id, job_id, timeout);
      return textResult(
        { process: p },
        `${p.jobId} ${p.status}${p.exitCode !== null ? ` exit=${p.exitCode}` : ''}${p.signal ? ` signal=${p.signal}` : ''}`
      );
    }
  );

  server.registerTool(
    'kill_process',
    {
      title: 'Kill process',
      description: 'Signal a detached process (default SIGTERM). First-party computesdk only.',
      inputSchema: {
        provider: sandboxProvider,
        sandbox_id: z.string(),
        job_id: z.string(),
        signal: z.string().optional().describe('Signal name or number, e.g. SIGKILL or 9'),
      },
      annotations: { destructiveHint: true },
    },
    async ({ provider: name, sandbox_id, job_id, signal }) => {
      gatewayOnly(name);
      const client = gatewayClient({ apiKey: ctx.token });
      const p = await client.killProcess(sandbox_id, job_id, signal);
      return textResult(
        { process: p },
        `${p.jobId} ${p.status}${p.exitCode !== null ? ` exit=${p.exitCode}` : ''}`
      );
    }
  );

  server.registerTool(
    'read_file',
    {
      title: 'Read file from sandbox',
      description: 'Read a text file from a sandbox filesystem.',
      inputSchema: {
        provider: sandboxProvider,
        sandbox_id: z.string(),
        path: z.string(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ provider: name, sandbox_id, path }) => {
      const { sandbox } = await resolveSandbox(ctx, name, sandbox_id);
      const content = await sandbox.filesystem.readFile(path);
      return textResult({ path, content }, content);
    }
  );

  server.registerTool(
    'write_file',
    {
      title: 'Write file to sandbox',
      description: 'Write a text file to a sandbox filesystem (max 32MB first-party).',
      inputSchema: {
        provider: sandboxProvider,
        sandbox_id: z.string(),
        path: z.string(),
        content: z.string().max(MAX_FILE_CONTENT_BYTES),
      },
      annotations: { destructiveHint: true },
    },
    async ({ provider: name, sandbox_id, path, content }) => {
      const { sandbox } = await resolveSandbox(ctx, name, sandbox_id);
      await sandbox.filesystem.writeFile(path, content);
      return textResult({ path, written: true }, `Wrote ${path}.`);
    }
  );

  server.registerTool(
    'list_files',
    {
      title: 'List directory in sandbox',
      description: 'List a directory\'s entries in a sandbox filesystem.',
      inputSchema: {
        provider: sandboxProvider,
        sandbox_id: z.string(),
        path: z.string(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ provider: name, sandbox_id, path }) => {
      const { sandbox } = await resolveSandbox(ctx, name, sandbox_id);
      const entries = await sandbox.filesystem.readdir(path);
      return textResult(
        { path, entries },
        entries.map((e) => `${e.type === 'directory' ? 'd' : 'f'} ${e.name}`).join('\n') || '(empty)'
      );
    }
  );

  server.registerTool(
    'delete_path',
    {
      title: 'Delete path in sandbox',
      description: 'Remove a file or directory tree from a sandbox filesystem.',
      inputSchema: {
        provider: sandboxProvider,
        sandbox_id: z.string(),
        path: z.string(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ provider: name, sandbox_id, path }) => {
      const { sandbox } = await resolveSandbox(ctx, name, sandbox_id);
      await sandbox.filesystem.remove(path);
      return textResult({ path, removed: true }, `Removed ${path}.`);
    }
  );

  server.registerTool(
    'get_sandbox_url',
    {
      title: 'Get sandbox URL',
      description: 'Get the public URL for a port exposed by a sandbox. Works on first-party sandboxes whose placed provider supports ingress.',
      inputSchema: {
        provider: sandboxProvider,
        sandbox_id: z.string(),
        port: z.number().int().min(1).max(65535),
        protocol: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ provider: name, sandbox_id, port, protocol }: {
      provider: string;
      sandbox_id: string;
      port: number;
      protocol?: string;
    }) => {
      const { sandbox } = await resolveSandbox(ctx, name, sandbox_id);
      try {
        const url = await sandbox.getUrl({ port, protocol });
        return textResult({ url }, url);
      } catch (e) {
        if (e instanceof GatewayApiError && e.status === 501) {
          throw new Error(
            `The provider this sandbox was placed on does not expose public URLs. Serve on the port and use run_command output, or recreate with a provider_order whose provider supports ingress.`
          );
        }
        throw e;
      }
    }
  );

  server.registerTool(
    'get_routing_settings',
    {
      title: 'Get routing settings',
      description:
        'Show the caller\'s sandbox routing config on the ComputeSDK gateway: provider order, market spend cap, resource sizes, and warm-pool floors. First-party only.',
      inputSchema: { provider: sandboxProvider },
      annotations: { readOnlyHint: true },
    },
    async ({ provider: name }) => {
      gatewayOnly(name);
      const client = gatewayClient({ apiKey: ctx.token });
      const settings = await client.getSettings();
      return textResult({ settings }, JSON.stringify(settings, null, 2));
    }
  );

  server.registerTool(
    'destroy_sandbox',
    {
      title: 'Destroy sandbox',
      description: 'Destroy a sandbox and release its resources.',
      inputSchema: {
        provider: sandboxProvider,
        sandbox_id: z.string(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ provider: name, sandbox_id }) => {
      const { sandbox } = await resolveSandbox(ctx, name, sandbox_id);
      await sandbox.destroy();
      sandboxCache.delete(cacheKey(ctx.userId, name, sandbox_id));
      return textResult(
        { sandbox_id, destroyed: true },
        `Destroyed ${name} sandbox ${sandbox_id}.`
      );
    }
  );
}
