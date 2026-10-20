/**
 * A fake of the Promigence SDK's `PromigenceClient`: the boundary the unit tests replace.
 *
 * It answers the calls the SDK's own `Sandbox` class makes, with in-memory state and a tiny shell
 * that understands what the provider and the shared ComputeSDK suite send. Every call is recorded,
 * so a test can check what was sent, not only what came back. Nothing here touches the network.
 */
import { NotFoundError } from '@promigence/sdk';
import type { PromigenceClient } from '@promigence/sdk';

export interface FakeOptions {
  /** What `authenticated` reports: '' means no key. */
  apiKey?: string;
  /** Sandboxes start queued and become ready on `waitReady`. */
  readyLater?: boolean;
  /** An error to throw from one kind of call. */
  fail?: Partial<Record<'create' | 'exec' | 'get' | 'kill' | 'files', Error>>;
  /** How long each line of the streaming loop takes, in ms (default 40). */
  tickMs?: number;
  snapshots?: Array<Record<string, unknown>>;
}

export interface Call {
  name: string;
  args: unknown[];
}

interface SandboxRow {
  sandbox_id: string;
  run_id: string;
  snapshot_id: string;
  state: string;
  created_at: string;
  timeout_ms?: number;
  outcome?: string;
}

interface Exec {
  execId: string;
  sh: string;
  startedAt: number;
  endsAt: number;
  exitCode: number;
  stdout: string;
  stderr: string;
  chunks: Array<{ at: number; text: string }>;
  timeoutMs?: number;
  killed: boolean;
}

interface FileNode {
  dir?: boolean;
  data?: Uint8Array;
}

interface ExecRequest {
  sh: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

const enc = new TextEncoder();
const MTIME_NS = 1_700_000_000_123_000_000;

/** What a double-quoted `escapeShellArg` value stands for. */
const unquote = (s: string): string => s.replace(/\\([\\"$`])/g, '$1');

export class FakeClient {
  readonly calls: Call[] = [];
  readonly store = new Map<string, SandboxRow>();
  readonly execs = new Map<string, Exec>();
  readonly fs = new Map<string, FileNode>();
  readonly snapshotsStore: Array<Record<string, unknown>>;
  apiKey: string;
  readonly credentialsProblem = undefined;
  private nextId = 1;

  constructor(readonly cfg: FakeOptions = {}) {
    this.apiKey = cfg.apiKey ?? 'prom_api_test';
    this.snapshotsStore = cfg.snapshots ?? [];
  }

  get authenticated(): boolean {
    return this.apiKey.length > 0;
  }

  /** This fake, typed as what the provider config takes. */
  asClient(): PromigenceClient {
    return this as unknown as PromigenceClient;
  }

  /** Names of the calls made, in order. */
  names(): string[] {
    return this.calls.map((c) => c.name);
  }

  /** The arguments of the last call with this name. */
  last(name: string): unknown[] {
    const call = [...this.calls].reverse().find((c) => c.name === name);
    if (!call) throw new Error(`no ${name} call was made; calls: ${this.names().join(', ')}`);
    return call.args;
  }

  private record(name: string, ...args: unknown[]): void {
    this.calls.push({ name, args });
  }

  private fail(op: keyof NonNullable<FakeOptions['fail']>): void {
    const err = this.cfg.fail?.[op];
    if (err) throw err;
  }

  private need(sandboxId: string): SandboxRow {
    const s = this.store.get(sandboxId);
    if (!s || s.state === 'ended') throw new NotFoundError(`sandbox ${sandboxId} not found`, 'Check the id.');
    return s;
  }

  private runShell(req: ExecRequest): Exec {
    const startedAt = Date.now();
    const e: Exec = {
      execId: `exec_${this.nextId++}`,
      sh: req.sh,
      startedAt,
      endsAt: startedAt,
      exitCode: 0,
      stdout: '',
      stderr: '',
      chunks: [],
      ...(req.timeoutMs === undefined ? {} : { timeoutMs: req.timeoutMs }),
      killed: false,
    };
    const sh = req.sh;
    let m: RegExpExecArray | null;
    if (sh === 'node -v') e.stdout = 'v22.12.0\n';
    else if ((m = /^echo "(.*)"$/.exec(sh)) || (m = /^echo (.*)$/.exec(sh))) e.stdout = `${m[1]}\n`;
    else if ((m = /^mkdir -p -- "((?:[^"\\]|\\.)*)"$/.exec(sh))) this.fs.set(unquote(m[1]), { dir: true });
    else if ((m = /^rm -rf -- "((?:[^"\\]|\\.)*)"$/.exec(sh))) {
      const target = unquote(m[1]);
      for (const k of [...this.fs.keys()]) if (k === target || k.startsWith(`${target}/`)) this.fs.delete(k);
    } else if ((m = /^exit (\d+)$/.exec(sh))) e.exitCode = Number(m[1]);
    else if (/^sleep \d+$/.test(sh)) e.stdout = '';
    else if (sh === 'pwd') e.stdout = `${req.cwd ?? '/'}\n`;
    else if (sh === 'env') {
      e.stdout = `${Object.entries(req.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n')}\n`;
    } else if (sh === "sh -c 'echo out; echo err 1>&2; exit 3'") {
      e.stdout = 'out\n';
      e.stderr = 'err\n';
      e.exitCode = 3;
    } else if ((m = /^sh -c 'for i in (.*); do echo tick \$i; sleep 1; done'$/.exec(sh))) {
      // Streaming: each tick becomes readable `tickMs` after the one before it.
      const ticks = m[1].split(' ');
      const tickMs = this.cfg.tickMs ?? 40;
      e.chunks = ticks.map((t, i) => ({ at: startedAt + i * tickMs, text: `tick ${t}\n` }));
      e.stdout = e.chunks.map((c) => c.text).join('');
      e.endsAt = startedAt + ticks.length * tickMs;
    } else if (sh === "sh -c 'echo starting; sleep 60'") {
      e.chunks = [{ at: startedAt, text: 'starting\n' }];
      e.stdout = 'starting\n';
      e.endsAt = startedAt + 60_000;
    } else if ((m = /^cat > (\S+) <<'(\S+)'\n([\s\S]*)\n\2\n(.*)$/.exec(sh))) {
      // A heredoc: write the file, then "run" what follows it.
      this.fs.set(m[1], { data: enc.encode(m[3]) });
      e.stdout = `ran: ${m[4]}\n`;
    } else {
      e.stderr = `sh: 1: ${sh.split(' ')[0]}: not found\n`;
      e.exitCode = 127;
    }
    if (e.chunks.length === 0) e.chunks = [{ at: startedAt, text: e.stdout }];
    return e;
  }

  /** A background exec's record as the API reports it now. */
  private recordOf(sandboxId: string, e: Exec): Record<string, unknown> {
    const now = Date.now();
    const pastBound = e.timeoutMs !== undefined && now >= e.startedAt + e.timeoutMs && now < e.endsAt;
    if (pastBound) {
      // Stopped at the bound it was started with, as the API does.
      e.killed = true;
      e.endsAt = e.startedAt + (e.timeoutMs as number);
    }
    const running = now < e.endsAt && !e.killed;
    const rec: Record<string, unknown> = {
      exec_id: e.execId,
      sandbox_id: sandboxId,
      state: running ? 'running' : 'exited',
      argv: e.sh,
      stdout_bytes: 0,
      stderr_bytes: 0,
    };
    if (!running) {
      const atBound = e.timeoutMs !== undefined && e.endsAt - e.startedAt >= e.timeoutMs;
      rec.exit = e.killed
        ? { exit_code: null, signal: 9, wall_ms: e.endsAt - e.startedAt, ...(atBound ? { timed_out: true } : {}) }
        : { exit_code: e.exitCode, signal: null };
    }
    return rec;
  }

  readonly runs = {
    start: async (opts: { snapshot: string; count: number; timeoutMs?: number } & Record<string, unknown>) => {
      this.record('runs.start', opts);
      this.fail('create');
      const runId = `run_${this.nextId++}`;
      const refs: Array<{ sandbox_id: string; state: string }> = [];
      for (let i = 0; i < opts.count; i++) {
        const id = `sbx_${this.nextId++}`;
        const state = this.cfg.readyLater ? 'queued' : 'ready';
        this.store.set(id, {
          sandbox_id: id,
          run_id: runId,
          snapshot_id: opts.snapshot,
          state,
          created_at: '2030-01-02T03:04:05.000Z',
          ...(opts.timeoutMs === undefined ? {} : { timeout_ms: opts.timeoutMs }),
        });
        refs.push({ sandbox_id: id, state });
      }
      return { run_id: runId, state: 'running', sandboxes: refs };
    },
    waitReady: async (runId: string, opts: { onReady?: (ref: { sandbox_id: string; state: string }) => void } = {}) => {
      this.record('runs.waitReady', runId);
      const rows = [...this.store.values()].filter((s) => s.run_id === runId);
      for (const s of rows) {
        s.state = 'ready';
        opts.onReady?.({ sandbox_id: s.sandbox_id, state: 'ready' });
      }
      return { sandboxes: rows.map((s) => ({ sandbox_id: s.sandbox_id, state: 'ready' })), timedOut: false, waitedMs: 1 };
    },
    kill: async (runId: string) => {
      this.record('runs.kill', runId);
      return { ok: true };
    },
  };

  readonly sandboxes = {
    exec: async (sandboxId: string, req: ExecRequest) => {
      this.record('sandboxes.exec', sandboxId, req);
      this.fail('exec');
      this.need(sandboxId);
      const e = this.runShell(req);
      return { exec_id: e.execId, exit_code: e.exitCode, stdout: e.stdout, stderr: e.stderr };
    },
    execBackground: async (sandboxId: string, req: ExecRequest) => {
      this.record('sandboxes.execBackground', sandboxId, req);
      this.fail('exec');
      this.need(sandboxId);
      const e = this.runShell(req);
      this.execs.set(e.execId, e);
      return this.recordOf(sandboxId, e);
    },
    execs: {
      read: async (sandboxId: string, execId: string, stream: 'stdout' | 'stderr', { offset = 0 }: { offset?: number } = {}) => {
        this.record('execs.read', sandboxId, execId, stream, offset);
        const e = this.mustExec(execId);
        const now = Date.now();
        const rec = this.recordOf(sandboxId, e);
        const ended = rec.state !== 'running';
        const text =
          stream === 'stdout'
            ? e.chunks.filter((c) => c.at <= now && (!e.killed || c.at <= e.endsAt)).map((c) => c.text).join('')
            : ended
              ? e.stderr
              : '';
        const data = enc.encode(text).subarray(offset);
        return { data, offset, eof: ended, record: rec };
      },
      get: async (sandboxId: string, execId: string, { waitMs = 0 }: { waitMs?: number } = {}) => {
        this.record('execs.get', sandboxId, execId, waitMs);
        const e = this.mustExec(execId);
        const until = e.timeoutMs === undefined ? e.endsAt : Math.min(e.endsAt, e.startedAt + e.timeoutMs);
        const wait = Math.max(0, Math.min(waitMs, until - Date.now()));
        if (wait > 0 && !e.killed) await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 50)));
        return this.recordOf(sandboxId, e);
      },
      signal: async (sandboxId: string, execId: string, signal: string) => {
        this.record('execs.signal', sandboxId, execId, signal);
        const e = this.mustExec(execId);
        const wasRunning = Date.now() < e.endsAt && !e.killed;
        e.killed = true;
        e.endsAt = Date.now();
        return { ok: true, exec_id: execId, signal: 9, delivered: wasRunning };
      },
      list: async (sandboxId: string) => [...this.execs.values()].map((e) => this.recordOf(sandboxId, e)),
    },
    get: async (sandboxId: string) => {
      this.record('sandboxes.get', sandboxId);
      this.fail('get');
      const s = this.store.get(sandboxId);
      if (!s) throw new NotFoundError(`sandbox ${sandboxId} not found`, 'Check the id.');
      return { ...s };
    },
    kill: async (sandboxId: string) => {
      this.record('sandboxes.kill', sandboxId);
      this.fail('kill');
      const s = this.need(sandboxId);
      s.state = 'ended';
      return { ok: true };
    },
    // Like the API: newest first, filtered by state, `limit` per page, an opaque cursor to the next.
    listPage: async (opts: { limit?: number; state?: string[]; cursor?: string } = {}) => {
      this.record('sandboxes.listPage', opts);
      const all = [...this.store.values()].reverse().filter((s) => !opts.state?.length || opts.state.includes(s.state));
      const at = opts.cursor ? Number(opts.cursor) : 0;
      const limit = opts.limit ?? 50;
      const next = at + limit < all.length ? String(at + limit) : null;
      return { items: all.slice(at, at + limit).map((s) => ({ ...s })), nextCursor: next, limit };
    },
    files: {
      get: async (sandboxId: string, path: string) => {
        this.record('files.get', sandboxId, path);
        this.fail('files');
        this.need(sandboxId);
        const f = this.fs.get(path);
        if (!f || f.dir || !f.data) throw new NotFoundError(`${path}: no such file`, 'Check the path.');
        return f.data;
      },
      put: async (sandboxId: string, path: string, data: string | Uint8Array) => {
        const bytes = typeof data === 'string' ? enc.encode(data) : data;
        this.record('files.put', sandboxId, path, new TextDecoder().decode(bytes));
        this.fail('files');
        this.need(sandboxId);
        this.fs.set(path, { data: bytes });
        return { ok: true, sandbox_id: sandboxId, path, bytes: bytes.length, mode: '644', chunks: 1 };
      },
      stat: async (sandboxId: string, path: string) => {
        this.record('files.stat', sandboxId, path);
        this.need(sandboxId);
        const f = this.fs.get(path);
        if (!f) throw new NotFoundError(`${path}: no such file or directory`, 'Check the path.');
        return { sandbox_id: sandboxId, path, stat: { path, size: f.data?.length ?? 4096, is_dir: !!f.dir } };
      },
      list: async (sandboxId: string, path: string) => {
        this.record('files.list', sandboxId, path);
        this.need(sandboxId);
        const prefix = `${path.replace(/\/$/, '')}/`;
        const entries = [];
        for (const [k, f] of this.fs) {
          if (!k.startsWith(prefix) || k.slice(prefix.length).includes('/')) continue;
          entries.push({
            name: k.slice(prefix.length),
            path: k,
            size: f.dir ? 4096 : (f.data?.length ?? 0),
            mode: f.dir ? '40755' : '100644',
            mtime_unix_ns: MTIME_NS,
            is_dir: !!f.dir,
            is_symlink: false,
          });
        }
        return { sandbox_id: sandboxId, path, entries, truncated: false };
      },
    },
  };

  readonly snapshots = {
    list: async () => {
      this.record('snapshots.list');
      return this.snapshotsStore;
    },
    delete: async (id: string) => {
      this.record('snapshots.delete', id);
      if (!this.snapshotsStore.some((s) => s.snapshot_id === id || s.alias === id)) {
        throw new NotFoundError(`snapshot ${id} not found`, 'Check the id.');
      }
      return { snapshot_id: id, deleted: true };
    },
    create: async (opts: Record<string, unknown>) => {
      this.record('snapshots.create', opts);
      return { build_id: 'bld_1', state: 'verified', snapshot_id: 'snap_img1' };
    },
    waitBuild: async () => ({ timedOut: false, build: { state: 'verified', snapshot_id: 'snap_img1' } }),
  };

  async me() {
    this.record('me');
    return { org_id: 'org_1', default_spend_cap: 2 };
  }

  private mustExec(execId: string): Exec {
    const e = this.execs.get(execId);
    if (!e) throw new NotFoundError(`exec ${execId} not found`, 'Check the id.');
    return e;
  }
}
