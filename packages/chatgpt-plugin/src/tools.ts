/**
 * MCP tool surface for the ComputeSDK ChatGPT plugin.
 *
 * Every sandbox tool resolves the caller's stored credentials, instantiates
 * the provider adapter, and delegates to the computesdk sandbox manager.
 * Credential values are write-only — tools return field names and status,
 * never secret material.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Provider, ProviderSandbox } from '@computesdk/provider';
import { CredentialVault } from './vault.js';
import { PROVIDERS, getProvider } from './providers.js';
import { PANEL_HTML, PANEL_MIME, PANEL_URI } from './panel.js';

const PANEL_META = { 'openai/outputTemplate': PANEL_URI };

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

function buildProvider(ctx: RequestContext, name: string): Provider {
  const spec = requireProvider(name);
  if (spec.firstParty) return spec.create({}, ctx.token);
  const credentials = ctx.vault.getCredentials(ctx.userId, name);
  if (!credentials) {
    throw new Error(
      `No credentials configured for "${name}". ` +
        `Required fields: ${spec.credentialFields.filter((f) => f.required).map((f) => f.key).join(', ')}. ` +
        'Call set_provider_credentials first.'
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
    `Sandbox provider. Defaults to "computesdk" (first-party ComputeSDK gateway, no setup needed). Other providers require set_provider_credentials first.`,
  );

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
              `${p.name}: ${p.firstParty ? 'first-party (ready)' : ctx.vault.hasCredentials(ctx.userId, p.name) ? 'configured' : 'no credentials'}`
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
        'Store BYOK credentials for a sandbox provider. Values are encrypted at rest and are never returned by any tool. Call list_providers to see which fields a provider requires.',
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
      const result: CallToolResult = {
        structuredContent: { provider, stored: Object.keys(credentials) },
        content: [{ type: 'text', text: `Credentials stored for ${provider}.` }],
      };
      return result;
    }
  );

  server.registerTool(
    'remove_provider_credentials',
    {
      title: 'Remove provider credentials',
      description: 'Delete stored credentials for a provider.',
      inputSchema: { provider: providerName },
      annotations: { destructiveHint: true },
    },
    async ({ provider }) => {
      const removed = ctx.vault.removeCredentials(ctx.userId, provider);
      return {
        structuredContent: { provider, removed },
        content: [
          { type: 'text', text: removed ? `Removed credentials for ${provider}.` : `No credentials stored for ${provider}.` },
        ],
      };
    }
  );

  server.registerTool(
    'create_sandbox',
    {
      title: 'Create sandbox',
      description: 'Create a new sandbox on a provider the user has configured credentials for.',
      inputSchema: {
        provider: sandboxProvider,
        timeout: z.number().int().optional().describe('Sandbox lifetime in milliseconds'),
        templateId: z.string().optional().describe('Provider template/image ID to boot from'),
        envs: z.record(z.string(), z.string()).optional().describe('Environment variables to set inside the sandbox'),
      },
      outputSchema: {
        sandbox_id: z.string(),
        provider: z.string(),
      },
      annotations: { openWorldHint: true },
      _meta: PANEL_META,
    },
    async ({ provider: name, timeout, templateId, envs }: {
      provider: string;
      timeout?: number;
      templateId?: string;
      envs?: Record<string, string>;
    }) => {
      const provider = buildProvider(ctx, name);
      const sandbox = await provider.sandbox.create({ timeout, templateId, envs });
      sandboxCache.set(cacheKey(ctx.userId, name, sandbox.sandboxId), sandbox);
      const result: CallToolResult = {
        structuredContent: { sandbox_id: sandbox.sandboxId, provider: name },
        content: [{ type: 'text', text: `Created ${name} sandbox ${sandbox.sandboxId}.` }],
      };
      return result;
    }
  );

  server.registerTool(
    'list_sandboxes',
    {
      title: 'List sandboxes',
      description: 'List active sandboxes on a provider.',
      inputSchema: { provider: sandboxProvider },
      annotations: { readOnlyHint: true },
      _meta: PANEL_META,
    },
    async ({ provider: name }) => {
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
      return {
        structuredContent: { provider: name, sandboxes: infos },
        content: [{ type: 'text', text: `${infos.length} sandbox(es) on ${name}.` }],
      };
    }
  );

  server.registerTool(
    'run_command',
    {
      title: 'Run command in sandbox',
      description: 'Execute a shell command inside a sandbox and return stdout, stderr, and exit code.',
      inputSchema: {
        provider: sandboxProvider,
        sandbox_id: z.string(),
        command: z.string().describe('Shell command to execute'),
        timeout: z.number().int().optional().describe('Command timeout in milliseconds'),
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
      return {
        structuredContent: {
          stdout: result.stdout,
          stderr: result.stderr,
          exit_code: exitCode,
        },
        content: [
          {
            type: 'text',
            text: `exit ${exitCode ?? '?'}\n${result.stdout ?? ''}${result.stderr ? `\nstderr: ${result.stderr}` : ''}`,
          },
        ],
      };
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
      return {
        structuredContent: { path, content },
        content: [{ type: 'text', text: content }],
      };
    }
  );

  server.registerTool(
    'write_file',
    {
      title: 'Write file to sandbox',
      description: 'Write a text file to a sandbox filesystem.',
      inputSchema: {
        provider: sandboxProvider,
        sandbox_id: z.string(),
        path: z.string(),
        content: z.string(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ provider: name, sandbox_id, path, content }) => {
      const { sandbox } = await resolveSandbox(ctx, name, sandbox_id);
      await sandbox.filesystem.writeFile(path, content);
      return {
        structuredContent: { path, written: true },
        content: [{ type: 'text', text: `Wrote ${path}.` }],
      };
    }
  );

  server.registerTool(
    'get_sandbox_url',
    {
      title: 'Get sandbox URL',
      description: 'Get the public URL for a port exposed by a sandbox.',
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
      const url = await sandbox.getUrl({ port, protocol });
      return {
        structuredContent: { url },
        content: [{ type: 'text', text: url }],
      };
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
      const result: CallToolResult = {
        structuredContent: { sandbox_id, destroyed: true },
        content: [{ type: 'text', text: `Destroyed ${name} sandbox ${sandbox_id}.` }],
      };
      return result;
    }
  );
}
