/**
 * `compute ai-router` (alias `air`) — the org's AI router over
 * `/api/v1/ai-router`: one OpenAI-compatible Chat Completions endpoint that
 * sends each request to the cheapest gateway (OpenRouter, LLM Gateway, …)
 * offering the model, using the org's own gateway keys. Its own settings,
 * separate from Actions and sandbox routing. Shown in the dashboard as
 * Agents → Inference.
 */

import type { Command } from 'commander';
import pc from 'picocolors';
import { output, client, fail, parseInputs, secretValueClient, usageErrorOutput, type CommonOpts } from './actions.js';
import { confirmWrite } from './confirm.js';
import { safeTerm, safeTermText } from './term.js';

// Wire shapes: benchmarks-platform lib/api/v1-contract/ai-router.ts.

export type AiRouterStrategy = 'cheapest' | 'order';
export type AiRouterByokMode = 'off' | 'first' | 'fallback' | 'only';

export interface AiRouterSettings {
  byokMode: AiRouterByokMode;
  strategy: AiRouterStrategy;
  gatewayOrder: string[];
  maxAttempts: number;
}

export interface AiRouterKey {
  gateway: string;
  /** Masked tail of the stored key. Never the key. */
  keyHint: string | null;
  status: 'connected' | 'error' | 'unverified';
  statusDetail: string | null;
  lastVerifiedAt: string | null;
  modelCount: number;
  catalogFetchedAt: string | null;
  updatedAt: string;
}

export interface AiRouterGateway {
  id: string;
  name: string;
  kind: 'gateway' | 'direct';
  experimental: boolean;
  docs: string | null;
  credentials: Array<{ name: string; required: boolean; description: string | null }>;
  key: AiRouterKey | null;
}

export interface AiRouterModel {
  id: string;
  name: string | null;
  offers: Array<{
    gateway: string;
    gatewayModelId: string;
    inputPerMTok: number | null;
    outputPerMTok: number | null;
    free: boolean;
    contextLength: number | null;
  }>;
}

export interface AiRouterCandidate {
  gateway: string;
  account: 'byok' | 'managed';
  gatewayModelId: string;
  price: { inputPerMTok: number | null; outputPerMTok: number | null; confidence: string };
  free: boolean;
  estimatedCostUsd: number | null;
  contextLength: number | null;
}

export interface AiRouterQuote {
  model: string;
  tokens: { inputTokens: number; outputTokens: number };
  candidates: AiRouterCandidate[];
}

export interface AiRouterRequest {
  id: string;
  model: string;
  stream: boolean;
  gateway: string | null;
  account: 'byok' | 'managed' | null;
  status: 'succeeded' | 'failed';
  errorKind: string | null;
  errorMessage: string | null;
  attempts: Array<{ gateway: string; ok: boolean; errorKind?: string; ms: number }>;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  costUsd: number | null;
  totalMs: number | null;
  createdAt: string;
}

const STRATEGIES: AiRouterStrategy[] = ['cheapest', 'order'];
const BYOK_MODES: AiRouterByokMode[] = ['off', 'first', 'fallback', 'only'];

function gatewayPath(gateway: string, rest = ''): string {
  return `/api/v1/ai-router/gateways/${encodeURIComponent(gateway)}${rest}`;
}

/** `$0.15`, `Free`, or `?` for an unpublished price. */
export function formatPerMTok(value: number | null): string {
  if (value === null) return '?';
  if (value === 0) return 'free';
  return `$${Number(value.toPrecision(3))}`;
}

export function formatUsd(value: number | null): string {
  if (value === null) return '—';
  if (value === 0) return 'free';
  return value < 0.01 ? `$${value.toPrecision(2)}` : `$${value.toFixed(4)}`;
}

function keyStatus(key: AiRouterKey | null): string {
  if (!key) return pc.gray('no key');
  const status =
    key.status === 'connected' ? pc.green('connected') : key.status === 'error' ? pc.red('error') : pc.yellow('unverified');
  return `${status} ${pc.dim(safeTerm(key.keyHint ?? ''))} ${pc.dim(`${safeTerm(String(key.modelCount))} models`)}`;
}

export function formatAiRouterSettings(s: AiRouterSettings): string {
  return [
    `strategy       ${safeTerm(s.strategy)}`,
    `byok mode      ${safeTerm(s.byokMode)}`,
    `gateway order  ${s.gatewayOrder.length > 0 ? s.gatewayOrder.map(safeTerm).join(', ') : pc.dim('none (alphabetical)')}`,
    `max attempts   ${safeTerm(String(s.maxAttempts))}`,
  ].join('\n');
}

export function formatGatewayRow(g: AiRouterGateway): string {
  const ready = g.key?.status === 'connected';
  const icon = ready ? pc.green('●') : pc.gray('○');
  const name = ready ? pc.white(safeTerm(g.id)) : pc.gray(safeTerm(g.id));
  const creds = pc.dim(g.credentials.map((c) => safeTerm(c.name)).join(','));
  const detail = g.key?.status === 'error' && g.key.statusDetail ? `  ${pc.red(safeTerm(g.key.statusDetail))}` : '';
  return `  ${icon} ${name}  ${keyStatus(g.key)}  ${creds}${detail}`;
}

export function formatModelRow(m: AiRouterModel): string {
  const offers = m.offers
    .map((o) =>
      o.free
        ? `${safeTerm(o.gateway)} ${pc.green('free')}`
        : `${safeTerm(o.gateway)} ${formatPerMTok(o.inputPerMTok)}/${formatPerMTok(o.outputPerMTok)}`,
    )
    .join(pc.dim(' · '));
  return `${pc.white(safeTerm(m.id))}  ${offers}`;
}

export function formatQuote(q: AiRouterQuote): string {
  const lines = [`${pc.white(safeTerm(q.model))}  ${pc.dim(`~${safeTerm(String(q.tokens.inputTokens))} in / ${safeTerm(String(q.tokens.outputTokens))} out tokens`)}`];
  if (q.candidates.length === 0) lines.push(pc.yellow('  no connected gateway offers this model'));
  q.candidates.forEach((c, i) => {
    const price = c.free ? pc.green('free') : `${formatPerMTok(c.price.inputPerMTok)}/${formatPerMTok(c.price.outputPerMTok)} per 1M`;
    lines.push(`  ${i + 1}. ${safeTerm(c.gateway)} ${pc.dim(`(${safeTerm(c.account)})`)}  ${price}  est ${formatUsd(c.estimatedCostUsd)}`);
  });
  return lines.join('\n');
}

export function formatRequestRow(r: AiRouterRequest): string {
  const status = r.status === 'succeeded' ? pc.green('ok') : pc.red(safeTerm(r.errorKind ?? 'failed'));
  const tokens = r.inputTokens === null && r.outputTokens === null ? '—' : safeTerm(`${r.inputTokens ?? 0}/${r.outputTokens ?? 0}`);
  const tries = r.attempts.length > 1 ? pc.dim(` ${r.attempts.length} attempts`) : '';
  return `${pc.dim(safeTerm(r.createdAt))}  ${safeTerm(r.model)}  ${safeTerm(r.gateway ?? '—')}${tries}  ${status}  ${tokens}  ${formatUsd(r.costUsd ?? r.estimatedCostUsd)}`;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], flag: string): T | undefined {
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) throw new Error(`${flag} must be ${allowed.join(', ')}`);
  return value as T;
}

/** The PATCH body from `routing set` flags; refuses an empty change. */
export function routingChange(opts: {
  strategy?: string;
  byokMode?: string;
  maxAttempts?: string;
  gatewayOrder?: string;
}): Partial<AiRouterSettings> {
  const change: Partial<AiRouterSettings> = {};
  const strategy = oneOf(opts.strategy, STRATEGIES, '--strategy');
  if (strategy) change.strategy = strategy;
  const byokMode = oneOf(opts.byokMode, BYOK_MODES, '--byok-mode');
  if (byokMode) change.byokMode = byokMode;
  if (opts.maxAttempts !== undefined) {
    const n = Number(opts.maxAttempts);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error('--max-attempts must be 1 to 5');
    change.maxAttempts = n;
  }
  if (opts.gatewayOrder !== undefined) change.gatewayOrder = opts.gatewayOrder.split(',').map((g) => g.trim()).filter(Boolean);
  if (Object.keys(change).length === 0) throw new Error('Pass --strategy, --byok-mode, --max-attempts or --gateway-order.');
  return change;
}

/** First choice's message text from a Chat Completions reply. */
export function chatText(reply: unknown): string {
  const choices = (reply as { choices?: Array<{ message?: { content?: unknown } }> })?.choices;
  const content = choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : JSON.stringify(reply);
}

export function registerAiRouterCommands(program: Command): void {
  const air = program
    .command('ai-router')
    .alias('air')
    .description('The AI router (Agents → Inference): OpenAI-compatible chat routed to the cheapest gateway using your gateway keys')
    .configureOutput({ outputError: usageErrorOutput });

  const common = (cmd: Command) =>
    cmd
      .option('--api-key <key>', 'API key (default: $COMPUTE_API_KEY)')
      .option('--base-url <url>', 'API base URL (default: https://platform.computesdk.com)')
      .option('--org <slug>', 'organization slug for this command (or $COMPUTE_ORG)')
      .option('--allow-untrusted-host', 'send an explicit --api-key/env key to a non-computesdk, non-localhost --base-url (stored login credentials are never sent)')
      .option('--json', 'print machine-readable JSON');

  // ── routing ──
  const routing = air.command('routing').description("The AI router's settings: strategy, BYOK mode, gateway order, attempts (owner/admin)");
  const showRouting = async (opts: CommonOpts) => {
    try {
      const data = await (await client(opts)).get<AiRouterSettings>('/api/v1/ai-router/routing');
      output(opts, data, (d) => console.log(formatAiRouterSettings(d)));
    } catch (e) {
      fail(e, opts);
    }
  };
  common(routing).action(showRouting);
  common(routing.command('show').description("Print the AI router's settings")).action(showRouting);
  common(
    routing
      .command('set')
      .description('Change the AI router settings; only the flags given change (owner/admin)')
      .option('--strategy <strategy>', 'cheapest (by estimated request cost) or order (by --gateway-order)')
      .option('--byok-mode <mode>', 'off, first, fallback or only: where your keys sit relative to managed gateways')
      .option('--gateway-order <ids>', 'comma-separated gateway ids in preference order ("" clears)')
      .option('--max-attempts <n>', 'offers tried per request before giving up (1-5)'),
  ).action(async (opts: CommonOpts & { strategy?: string; byokMode?: string; gatewayOrder?: string; maxAttempts?: string }) => {
    try {
      const data = await (await client(opts)).patch<AiRouterSettings>('/api/v1/ai-router/routing', routingChange(opts));
      output(opts, data, (d) => console.log(formatAiRouterSettings(d)));
    } catch (e) {
      fail(e, opts);
    }
  });

  // ── gateways ──
  const gateways = air.command('gateways').alias('gw').description('Gateways the router can send to and your keys for them (owner/admin)');
  const listGateways = async (opts: CommonOpts) => {
    try {
      const data = await (await client(opts)).get<{ gateways: AiRouterGateway[] }>('/api/v1/ai-router/gateways');
      output(opts, data, (d) => {
        for (const g of d.gateways) console.log(formatGatewayRow(g));
      });
    } catch (e) {
      fail(e, opts);
    }
  };
  common(gateways).action(listGateways);
  common(gateways.command('list').alias('ls').description('Every gateway, its credential names and your key status')).action(listGateways);

  common(
    gateways
      .command('configure')
      .description("Save your key for a gateway; it's verified by fetching the gateway's model catalog (owner/admin)")
      .argument('<gateway>', 'gateway id (e.g. openrouter, llmgateway)')
      .option('--key <key>', 'the key, for a gateway with one required credential')
      .option('--field <pair...>', 'credentials as NAME=value (e.g. OPENROUTER_API_KEY=sk-or-…)'),
  ).action(async (gateway: string, opts: CommonOpts & { key?: string; field?: string[] }) => {
    try {
      // A gateway key is a local secret: trusted hosts only, even with --allow-untrusted-host.
      const c = await secretValueClient(opts, 'gateway keys');
      let credentials: Record<string, string>;
      if (opts.field !== undefined) {
        if (opts.key !== undefined) throw new Error('Pass either --key or --field, not both.');
        credentials = parseInputs(opts.field);
      } else if (opts.key !== undefined) {
        const { gateways: all } = await c.get<{ gateways: AiRouterGateway[] }>('/api/v1/ai-router/gateways');
        const required = all.find((g) => g.id === gateway)?.credentials.filter((cred) => cred.required) ?? [];
        if (required.length !== 1) throw new Error(`${gateway} needs --field NAME=value (credentials: ${required.map((r) => r.name).join(', ') || 'unknown gateway'})`);
        credentials = { [required[0]!.name]: opts.key };
      } else {
        throw new Error('Pass --key <key> or --field NAME=value.');
      }
      const saved = await c.put<{ key: AiRouterKey }>(gatewayPath(gateway), { credentials });
      output(opts, saved, (d) => console.log(`saved  ${safeTerm(d.key.gateway)}  ${keyStatus(d.key)}`));
      if (saved.key.status !== 'connected') process.exitCode = 1;
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    gateways
      .command('verify')
      .description("Re-check your stored key and refresh the gateway's cached model catalog (owner/admin)")
      .argument('<gateway>', 'gateway id'),
  ).action(async (gateway: string, opts: CommonOpts) => {
    try {
      const data = await (await client(opts)).post<{ key: AiRouterKey }>(gatewayPath(gateway, '/verify'));
      output(opts, data, (d) => {
        console.log(`${safeTerm(d.key.gateway)}  ${keyStatus(d.key)}`);
        if (d.key.statusDetail) console.log(pc.dim(`  ${safeTerm(d.key.statusDetail)}`));
      });
      if (data.key.status !== 'connected') process.exitCode = 1;
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    gateways
      .command('remove')
      .alias('rm')
      .description('Delete your stored key for a gateway; the router stops sending to it (owner/admin)')
      .argument('<gateway>', 'gateway id')
      .option('-y, --yes', 'skip the confirmation'),
  ).action(async (gateway: string, opts: CommonOpts & { yes?: boolean }) => {
    try {
      await confirmWrite(`Remove the ${gateway} key? The AI router stops sending requests to ${gateway}.`, opts);
      const data = await (await client(opts)).del<{ deleted: boolean }>(gatewayPath(gateway));
      output(opts, data, (d) => console.log(d.deleted ? `deleted  ${safeTerm(gateway)}` : `no key stored for ${safeTerm(gateway)}`));
    } catch (e) {
      fail(e, opts);
    }
  });

  // ── models / quote / requests ──
  common(
    air
      .command('models')
      .description("Models your connected gateways offer, each gateway's price per 1M input/output tokens, cheapest first")
      .option('--search <text>', 'only models whose id or name contains this')
      .option('--free', 'only models with a free offer'),
  ).action(async (opts: CommonOpts & { search?: string; free?: boolean }) => {
    try {
      const data = await (await client(opts)).get<{ models: AiRouterModel[] }>('/api/v1/ai-router/models', {
        search: opts.search,
        free: opts.free ? 'true' : undefined,
      });
      output(opts, data, (d) => {
        if (d.models.length === 0) console.log(pc.dim('No models. Add a gateway key: compute ai-router gateways configure <gateway> --key …'));
        for (const m of d.models) console.log(formatModelRow(m));
      });
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    air
      .command('quote')
      .description('Where a request for a model would go, in the order the router would try, with estimated cost')
      .argument('<model>', 'canonical model id, e.g. anthropic/claude-haiku-4.5')
      .option('--input-tokens <n>', 'estimated input tokens (default 1000)')
      .option('--output-tokens <n>', 'estimated output tokens (default 1024)')
      .option('--free', 'only free offers')
      .option('--strategy <strategy>', 'cheapest or order, instead of the org setting')
      .option('--gateway <id...>', 'only these gateways'),
  ).action(async (model: string, opts: CommonOpts & { inputTokens?: string; outputTokens?: string; free?: boolean; strategy?: string; gateway?: string[] }) => {
    try {
      const data = await (await client(opts)).get<AiRouterQuote>('/api/v1/ai-router/quote', {
        model,
        inputTokens: opts.inputTokens,
        outputTokens: opts.outputTokens,
        free: opts.free ? 'true' : undefined,
        strategy: oneOf(opts.strategy, STRATEGIES, '--strategy'),
        gateway: opts.gateway,
      });
      output(opts, data, (d) => console.log(formatQuote(d)));
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    air
      .command('requests')
      .description('Recent routed requests, newest first: gateway, attempts, tokens and cost (no content)')
      .option('--limit <n>', 'how many (1-200, default 50)'),
  ).action(async (opts: CommonOpts & { limit?: string }) => {
    try {
      const data = await (await client(opts)).get<{ requests: AiRouterRequest[] }>('/api/v1/ai-router/requests', { limit: opts.limit });
      output(opts, data, (d) => {
        if (d.requests.length === 0) console.log(pc.dim('No requests yet.'));
        for (const r of d.requests) console.log(formatRequestRow(r));
      });
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    air
      .command('chat')
      .description('Send one Chat Completions request through the router and print the reply')
      .argument('<model>', 'canonical model id, e.g. google/gemini-3-flash')
      .argument('<prompt...>', 'the user message')
      .option('--system <text>', 'a system message')
      .option('--max-tokens <n>', 'max output tokens')
      .option('--free', 'only free offers; never falls back to paid')
      .option('--gateway <id...>', 'only these gateways'),
  ).action(async (model: string, prompt: string[], opts: CommonOpts & { system?: string; maxTokens?: string; free?: boolean; gateway?: string[] }) => {
    try {
      const messages = [
        ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
        { role: 'user', content: prompt.join(' ') },
      ];
      const routingConstraints = {
        ...(opts.free ? { free: true } : {}),
        ...(opts.gateway ? { gateways: opts.gateway } : {}),
      };
      const reply = await (await client(opts)).post<unknown>('/api/v1/ai-router/chat/completions', {
        model,
        messages,
        ...(opts.maxTokens ? { max_tokens: Number(opts.maxTokens) } : {}),
        ...(Object.keys(routingConstraints).length > 0 ? { ai_router: routingConstraints } : {}),
      });
      output(opts, reply, (r) => console.log(safeTermText(chatText(r))));
    } catch (e) {
      fail(e, opts);
    }
  });
}
