/**
 * The "current instance" — the instance a directory's commands default to.
 *
 * One global setting would be unsafe (two agents or terminals would stomp on
 * each other), so the entry is scoped twice: to the working directory's git
 * root (the cwd itself outside a repo) and to the org the command runs as.
 * `COMPUTE_INSTANCE` always wins for agents and CI; an explicit ID argument
 * wins over everything.
 *
 * The file lives next to `credentials.json` (`~/.benchsdk/current-instances.json`,
 * mode 0600). Nothing is written into the user's project.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Resolved lazily so tests can point BENCHSDK_STATE_DIR at a tmp dir. */
function stateDir(): string {
  return process.env.BENCHSDK_STATE_DIR ?? join(homedir(), '.benchsdk');
}

function statePath(): string {
  return join(stateDir(), 'current-instances.json');
}

/** `[dirKey][orgKey] = sandboxId`. */
type Store = Record<string, Record<string, string>>;

export type InstanceSource = 'argument' | 'env' | 'file';

export interface ResolvedInstance {
  id: string;
  source: InstanceSource;
  /** The directory key the `file` hit came from — shown in the dim line. */
  dir?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The platform validates sandbox ids as UUIDs; only a UUID may take the id slot. */
export function isUuid(value: string | undefined): value is string {
  return value !== undefined && UUID_RE.test(value);
}

/** The git root when inside a repo, else the working directory itself. */
export function dirKey(cwd = process.cwd()): string {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() !== '' ? r.stdout.trim() : cwd;
}

/** A stable org discriminator: the slug override, else a hash of the bearer key. */
export function orgKey(opts: { org?: string; apiKey?: string }): string {
  const slug = opts.org || process.env.COMPUTE_ORG;
  if (slug) return `org:${slug}`;
  const key = opts.apiKey || process.env.COMPUTE_API_KEY || process.env.BENCHMARKS_PLATFORM_API_KEY;
  if (key) return `key:${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
  // OAuth login: key the pick to the org recorded by the last `org use` on
  // this machine (a cache — the consent row is the truth), so switching orgs
  // doesn't silently reuse the previous org's instance.
  try {
    const raw = JSON.parse(readFileSync(join(stateDir(), 'credentials.json'), 'utf8')) as {
      orgId?: string;
      orgSlug?: string;
    };
    const org = raw?.orgId ?? raw?.orgSlug;
    if (org) return `org:${org}`;
  } catch {
    // No stored login — unauthenticated commands share 'default'.
  }
  return 'default';
}

function readStore(): Store {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as Store;
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  mkdirSync(stateDir(), { recursive: true });
  // tmp+rename: readers never see a truncated file, and the rename lands with
  // the fresh file's 0600 mode even when replacing a permissive old one.
  const tmp = `${statePath()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, statePath());
}

/**
 * mkdir is atomic: the first creator wins. Writers serialize their
 * read-modify-write so two commands updating different picks can't clobber
 * each other; gives up after ~1s rather than hang on a stale lock dir.
 */
function withStoreLock<T>(fn: () => T): T {
  const lock = `${statePath()}.lock`;
  for (let attempt = 0; ; attempt++) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      if (attempt === 99) return fn();
      const until = Date.now() + 10;
      while (Date.now() < until) {
        // spin — writes take microseconds, so a short busy wait suffices
      }
    }
  }
  try {
    return fn();
  } finally {
    try {
      rmSync(lock, { recursive: true, force: true });
    } catch {
      // Already gone — another process took over a stale lock.
    }
  }
}

/** Persist `sandboxId` as the current instance for this directory + org. */
export function setCurrentInstance(sandboxId: string, org: string, dir = dirKey()): void {
  withStoreLock(() => {
    const store = readStore();
    (store[dir] ??= {})[org] = sandboxId;
    writeStore(store);
  });
}

/** Forget this directory + org's current instance; returns the forgotten id. */
export function clearCurrentInstance(org: string, dir = dirKey()): string | undefined {
  return withStoreLock(() => {
    const store = readStore();
    const prev = store[dir]?.[org];
    if (prev === undefined) return undefined;
    delete store[dir][org];
    if (Object.keys(store[dir]).length === 0) delete store[dir];
    writeStore(store);
    return prev;
  });
}

/** What `use --clear` and destroyed-instance cleanup report on. */
export function readFileCurrent(org: string, dir = dirKey()): string | undefined {
  return readStore()[dir]?.[org];
}

/**
 * The instance a command targets: the explicit argument if it is a UUID, else
 * `COMPUTE_INSTANCE`, else this directory's stored pick. `undefined` when none
 * apply — the caller prints the no-instance hint.
 */
export function resolveInstanceId(
  arg: string | undefined,
  opts: { org?: string; apiKey?: string },
  dir = dirKey(),
): ResolvedInstance | undefined {
  if (isUuid(arg)) return { id: arg, source: 'argument' };
  const env = process.env.COMPUTE_INSTANCE;
  if (env) return { id: env, source: 'env' };
  const file = readFileCurrent(orgKey(opts), dir);
  if (file) return { id: file, source: 'file', dir };
  return undefined;
}

/** `3f2a…` — the short id form used in informational lines. */
export function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 4)}…` : id;
}

/** Delete the state file wholesale (logout-style hygiene; not wired today). */
export function _resetStateFileForTests(): void {
  const p = statePath();
  if (existsSync(p)) rmSync(p);
}
