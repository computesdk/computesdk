/**
 * `compute agents` — managed agents on the platform's `/api/v1/agents` API:
 * an agent is a durable config (name, prompt, harness, model, secrets,
 * provider order, volume); a session is one routed sandbox running it.
 *
 * Auth: identical to `compute actions`/`compute sandboxes` — --api-key /
 * COMPUTE_API_KEY / the stored `compute login` session. Types mirror the wire
 * shapes in benchmarks-platform `lib/agents/types.ts` — keep them in sync by
 * hand; the API is the contract.
 */

import { Command } from 'commander';
import pc from 'picocolors';
import { readFileSync } from 'node:fs';
import { client, fail, output, safeTerm, usageErrorOutput, type CommonOpts } from './actions.js';

// ─── Wire types (mirror benchmarks-platform lib/agents/types.ts) ────────────

export type AgentHarness = 'pi' | 'opencode';
export type AgentSessionStatus = 'starting' | 'running' | 'stopped' | 'failed';
export type AgentEventKind = 'user' | 'turn' | 'status' | 'error';

export interface AgentVolume {
  diskId?: string;
  path?: string;
  bucket?: string;
  prefix?: string;
  region?: string;
  managed?: boolean;
}

export interface AgentSummary {
  id: string;
  name: string;
  harness: AgentHarness;
  model: string | null;
  secrets: string[];
  providerOrder: string[] | null;
  volume: AgentVolume | null;
  sessionCount: number;
  createdAt: string;
}

export interface AgentSessionSummary {
  id: string;
  agentId: string;
  status: AgentSessionStatus;
  sandboxId: string | null;
  error: string | null;
  createdAt: string;
  stoppedAt: string | null;
}

export interface AgentEventView {
  seq: number;
  kind: AgentEventKind;
  payload: unknown;
  createdAt: string;
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function formatLocalTime(iso: string | null): string {
  if (iso === null) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function printAgent(a: AgentSummary): void {
  console.log(
    `${pc.cyan(safeTerm(a.name))}  ${a.id.slice(0, 8)}  ${a.harness}${a.model ? `  ${safeTerm(a.model)}` : ''}  sessions: ${a.sessionCount}  created: ${formatLocalTime(a.createdAt)}`,
  );
}

function printAgentDetail(a: AgentSummary): void {
  printAgent(a);
  if (a.providerOrder) console.log(`  order: ${safeTerm(a.providerOrder.join(', '))}`);
  if (a.secrets.length > 0) console.log(`  secrets: ${safeTerm(a.secrets.join(', '))}`);
  if (a.volume) console.log(`  volume: ${a.volume.diskId ?? '—'} at ${a.volume.path ?? '—'}`);
}

function printSession(s: AgentSessionSummary): void {
  // Full session id — `send`, `events` and `stop` all take it as an argument.
  console.log(
    `${pc.cyan(s.id)}  ${s.status}  sandbox: ${s.sandboxId ?? '—'}  ${formatLocalTime(s.createdAt)}${s.error ? `  ${pc.red(safeTerm(s.error))}` : ''}`,
  );
}

/** One journal line: who spoke and what the turn produced. */
function printEvent(e: AgentEventView): void {
  const payload = (e.payload ?? {}) as Record<string, unknown>;
  if (e.kind === 'user') {
    console.log(`${pc.green('you')} #${e.seq}  ${safeTerm(String(payload.message ?? ''))}`);
    return;
  }
  if (e.kind === 'turn') {
    const events = Array.isArray(payload.events) ? payload.events : [payload];
    for (const ev of events) {
      const o = ev as Record<string, unknown>;
      const text = o.text ?? o.message ?? o.content;
      if (typeof text === 'string') console.log(pc.dim(`#${e.seq}`) + ` ${safeTerm(text)}`);
      else console.log(pc.dim(`#${e.seq} ${safeTerm(JSON.stringify(o))}`));
    }
    return;
  }
  console.log(pc.dim(`#${e.seq} ${e.kind} ${safeTerm(JSON.stringify(payload))}`));
}

function authOpts(cmd: Command): Command {
  return cmd
    .option('--api-key <key>', 'platform API key (or COMPUTE_API_KEY)')
    .option('--base-url <url>', 'platform base URL')
    .option('--allow-untrusted-host', 'allow non-computesdk.com base URLs')
    .option('--org <slug>', 'organization slug (or COMPUTE_ORG)')
    .option('--json', 'print the raw response');
}

// ─── Commands ────────────────────────────────────────────────────────────────

export function registerAgentsCommands(program: Command): void {
  const cmd = program
    .command('agents')
    .alias('ag')
    .description('Managed agents: durable agent configs running sessions in routed sandboxes')
    .enablePositionalOptions()
    .configureOutput({ outputError: usageErrorOutput });

  authOpts(cmd.command('list').alias('ls').description('List agents')).action(
    async (opts: CommonOpts) => {
      try {
        const c = await client(opts);
        const agents: AgentSummary[] = [];
        let cursor: string | undefined;
        for (;;) {
          const res = await c.get<{ agents: AgentSummary[]; nextCursor: string | null }>(
            '/api/v1/agents',
            { cursor },
          );
          agents.push(...res.agents);
          if (res.nextCursor === null) break;
          cursor = res.nextCursor;
        }
        output(opts, { agents }, (r) => {
          if (r.agents.length === 0) console.log('No agents yet — `compute agents create`.');
          for (const a of r.agents) printAgent(a);
        });
      } catch (e) {
        fail(e, opts);
      }
    },
  );

  authOpts(
    cmd
      .command('create <name>')
      .description('Create an agent (prompt via --prompt or --prompt-file)')
      .option('--prompt <text>', 'the agent\'s mission / system prompt')
      .option('--prompt-file <path>', 'read the prompt from a file')
      .option('--harness <harness>', 'pi or opencode (default pi)')
      .option('--model <model>', 'model id passed to the harness')
      .option('--secret <name...>', 'vault secret names to inject')
      .option('--order <providers>', 'provider order, comma-separated')
      .option('--volume-disk <diskId>', 'Archil disk id to mount at --volume-path')
      .option('--volume-path <path>', 'volume mount path (default /agent)'),
  ).action(
    async (
      name: string,
      opts: CommonOpts & {
        prompt?: string;
        promptFile?: string;
        harness?: string;
        model?: string;
        secret?: string[];
        order?: string;
        volumeDisk?: string;
        volumePath?: string;
      },
    ) => {
      try {
        const prompt = opts.prompt ?? (opts.promptFile ? readFileSync(opts.promptFile, 'utf8') : undefined);
        if (!prompt?.trim()) fail(new Error('--prompt or --prompt-file is required'), opts);
        const volume =
          opts.volumeDisk !== undefined || opts.volumePath !== undefined
            ? { diskId: opts.volumeDisk, path: opts.volumePath }
            : undefined;
        const c = await client(opts);
        const res = await c.post<{ agent: AgentSummary }>('/api/v1/agents', {
          name,
          prompt,
          harness: opts.harness,
          model: opts.model,
          secrets: opts.secret,
          providerOrder: opts.order?.split(',').map((s) => s.trim()).filter(Boolean),
          volume,
        });
        output(opts, res, (r) => {
          printAgentDetail(r.agent);
          console.error(pc.dim(`agent ${r.agent.name} created — run it with \`compute agents run ${r.agent.name} "…"\``));
        });
      } catch (e) {
        fail(e, opts);
      }
    },
  );

  authOpts(cmd.command('describe <ref>').alias('get').description('Show one agent (id or name)')).action(
    async (ref: string, opts: CommonOpts) => {
      try {
        const c = await client(opts);
        const res = await c.get<{ agent: AgentSummary }>(`/api/v1/agents/${encodeURIComponent(ref)}`);
        output(opts, res, (r) => printAgentDetail(r.agent));
      } catch (e) {
        fail(e, opts);
      }
    },
  );

  authOpts(
    cmd
      .command('update <ref>')
      .description('Update an agent\'s config')
      .option('--name <name>')
      .option('--prompt <text>')
      .option('--prompt-file <path>')
      .option('--harness <harness>')
      .option('--model <model>')
      .option('--secret <name...>')
      .option('--clear-secrets', 'remove all declared vault secrets')
      .option('--order <providers>')
      .option('--volume-disk <diskId>')
      .option('--volume-path <path>'),
  ).action(
    async (
      ref: string,
      opts: CommonOpts & {
        name?: string;
        prompt?: string;
        promptFile?: string;
        harness?: string;
        model?: string;
        secret?: string[];
        clearSecrets?: boolean;
        order?: string;
        volumeDisk?: string;
        volumePath?: string;
      },
    ) => {
      try {
        const prompt = opts.prompt ?? (opts.promptFile ? readFileSync(opts.promptFile, 'utf8') : undefined);
        const body: Record<string, unknown> = {
          name: opts.name,
          prompt,
          harness: opts.harness,
          model: opts.model,
          secrets: opts.clearSecrets ? [] : opts.secret,
          providerOrder: opts.order?.split(',').map((s) => s.trim()).filter(Boolean),
        };
        if (opts.volumeDisk !== undefined || opts.volumePath !== undefined) {
          body.volume = { diskId: opts.volumeDisk, path: opts.volumePath };
        }
        for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
        const c = await client(opts);
        const res = await c.patch<{ agent: AgentSummary }>(
          `/api/v1/agents/${encodeURIComponent(ref)}`,
          body,
        );
        output(opts, res, (r) => printAgentDetail(r.agent));
      } catch (e) {
        fail(e, opts);
      }
    },
  );

  authOpts(
    cmd
      .command('delete <ref>')
      .alias('rm')
      .description('Delete an agent and stop its live sessions')
      .option('-y, --yes', 'skip the confirmation'),
  ).action(async (ref: string, opts: CommonOpts & { yes?: boolean }) => {
    try {
      const c = await client(opts);
      if (!opts.yes) {
        const res = await c.get<{ agent: AgentSummary }>(`/api/v1/agents/${encodeURIComponent(ref)}`);
        console.error(`Deleting agent ${pc.cyan(res.agent.name)} (${res.agent.id}). Pass -y to confirm.`);
        process.exit(1);
      }
      await c.del(`/api/v1/agents/${encodeURIComponent(ref)}`);
      output(opts, { deleted: ref }, () => console.log(`deleted ${ref}`));
    } catch (e) {
      fail(e, opts);
    }
  });

  authOpts(cmd.command('sessions <ref>').description('List an agent\'s sessions')).action(
    async (ref: string, opts: CommonOpts) => {
      try {
        const c = await client(opts);
        const res = await c.get<{ sessions: AgentSessionSummary[] }>(
          `/api/v1/agents/${encodeURIComponent(ref)}/sessions`,
        );
        output(opts, res, (r) => {
          if (r.sessions.length === 0) console.log('No sessions yet.');
          for (const s of r.sessions) printSession(s);
        });
      } catch (e) {
        fail(e, opts);
      }
    },
  );

  authOpts(
    cmd
      .command('run <ref> [message]')
      .description('Start a session on a routed sandbox and optionally send a first message')
      .option('--resume <sessionId>', 'resume a stopped conversation on a new sandbox using its persistent disk')
      .option('--size <size>', 'platform size for the session\'s sandbox'),
  ).action(async (ref: string, message: string | undefined, opts: CommonOpts & { size?: string; resume?: string }) => {
    try {
      const c = await client(opts);
      const res = await c.post<{ session: AgentSessionSummary; events: AgentEventView[] }>(
        `/api/v1/agents/${encodeURIComponent(ref)}/sessions`,
        { message, size: opts.size, resumeSessionId: opts.resume },
      );
      output(opts, res, (r) => {
        printSession(r.session);
        for (const e of r.events) printEvent(e);
        console.error(pc.dim(`session ${r.session.id} — continue with \`compute agents send ${r.session.id} "…"\``));
      });
    } catch (e) {
      fail(e, opts);
    }
  });

  authOpts(cmd.command('session <sessionId>').description('Show one session')).action(
    async (sessionId: string, opts: CommonOpts) => {
      try {
        const c = await client(opts);
        const res = await c.get<{ session: AgentSessionSummary }>(
          `/api/v1/agent-sessions/${encodeURIComponent(sessionId)}`,
        );
        output(opts, res, (r) => printSession(r.session));
      } catch (e) {
        fail(e, opts);
      }
    },
  );

  authOpts(
    cmd.command('send <sessionId> <message>').description('Send a message; the agent runs a turn'),
  ).action(async (sessionId: string, message: string, opts: CommonOpts) => {
    try {
      const c = await client(opts);
      const res = await c.post<{ events: AgentEventView[] }>(
        `/api/v1/agent-sessions/${encodeURIComponent(sessionId)}/events`,
        { message },
      );
      output(opts, res, (r) => {
        for (const e of r.events) printEvent(e);
      });
    } catch (e) {
      fail(e, opts);
    }
  });

  authOpts(
    cmd
      .command('events <sessionId>')
      .description('Show the session event journal; --follow polls for new events')
      .option('--after <seq>', 'only events above this seq')
      .option('--follow', 'poll every 2s until the session settles or Ctrl-C'),
  ).action(
    async (sessionId: string, opts: CommonOpts & { after?: string; follow?: boolean }) => {
      try {
        const c = await client(opts);
        let after = opts.after !== undefined ? Number(opts.after) : undefined;
        const once = async (): Promise<number> => {
          const res = await c.get<{ events: AgentEventView[]; latestSeq: number }>(
            `/api/v1/agent-sessions/${encodeURIComponent(sessionId)}/events`,
            { after: after !== undefined ? String(after) : undefined },
          );
          if (opts.json) {
            output(opts, res, () => {});
          } else {
            for (const e of res.events) printEvent(e);
          }
          after = res.latestSeq;
          return res.events.length;
        };
        if (!opts.follow) {
          await once();
          return;
        }
        // Polling for v1 — SSE replaces this when the API grows a stream.
        for (;;) {
          const status = (
            await c.get<{ session: AgentSessionSummary }>(
              `/api/v1/agent-sessions/${encodeURIComponent(sessionId)}`,
            )
          ).session.status;
          await once();
          if (status !== 'running' && status !== 'starting') break;
          await new Promise((r) => setTimeout(r, 2000));
        }
      } catch (e) {
        fail(e, opts);
      }
    },
  );

  authOpts(
    cmd.command('stop <sessionId>').description('Stop a session and release its sandbox'),
  ).action(async (sessionId: string, opts: CommonOpts) => {
    try {
      const c = await client(opts);
      await c.del(`/api/v1/agent-sessions/${encodeURIComponent(sessionId)}`);
      output(opts, { stopped: sessionId }, () => console.log(`stopped ${sessionId}`));
    } catch (e) {
      fail(e, opts);
    }
  });
}
