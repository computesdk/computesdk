/**
 * rgstr — the terminal front door for rgstr (https://rgstr.org), the package
 * naming registry. Standalone: claim a name, prove it from your next publish,
 * route it, point your installs through it.
 */

import { Command } from 'commander';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { deviceLogin } from './auth.js';
import { clearCredentials, loadConfig, loadCredentials, saveConfig } from './config.js';
import {
  RgstrApiError,
  RgstrClient,
  RgstrCliError,
  assertHostAllowed,
  resolveAuth,
  resolveBaseUrl,
  toErrorEnvelope,
  type GlobalOptions,
} from './client.js';
import { fmtDownloads, kv, printJson, table } from './output.js';
import { detectPackage, findReadme, withBadge, withNpmProof, withPypiProof, type Ecosystem } from './project.js';
import { formatRouteRow, parseRouteSpec, type RouteInput, type RouteRecord } from './routes.js';
import { runUse } from './use.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const program = new Command();
program
  .name('rgstr')
  .description('rgstr — claim, verify and route package names · https://rgstr.org')
  .version(version)
  .option('--base-url <url>', 'rgstr origin (default https://rgstr.org; RGSTR_URL)')
  .option('--allow-untrusted-host', 'allow a base URL that is not rgstr.org / computesdk.com / localhost')
  .option('--org <slug>', 'organization slug (RGSTR_ORG, or `rgstr org use`)')
  .option('--token <token>', 'org API key (RGSTR_TOKEN) instead of a login')
  .option('--json', 'machine-readable output');

const globals = (): GlobalOptions => program.opts<GlobalOptions>();

function fail(err: unknown): never {
  const env = toErrorEnvelope(err);
  if (globals().json) printJson(env);
  else console.error(`Error: ${env.error}`);
  process.exit(err instanceof RgstrApiError && err.status === 401 ? 3 : 1);
}

async function client(optional = false): Promise<RgstrClient> {
  return new RgstrClient(await resolveAuth({ ...globals(), optional }));
}

// ── auth ──────────────────────────────────────────────────────────────────

program
  .command('login')
  .description('sign in with your ComputeSDK account (device code)')
  .action(async () => {
    try {
      const opts = globals();
      const baseUrl = await resolveBaseUrl(opts);
      assertHostAllowed(baseUrl, opts.allowUntrustedHost);
      const creds = await deviceLogin({
        baseUrl,
        onPrompt: (code) => {
          if (opts.json) return;
          console.log('To sign in, visit:');
          console.log(code.verification_uri_complete ?? code.verification_uri);
          console.log(`User code: ${code.user_code}`);
        },
      });
      const me = await new RgstrClient({ baseUrl, token: creds.token, kind: 'device', org: null }).get<MeResponse>('/api/v1/me');
      const cfg = await loadConfig();
      if (!cfg.org && me.organizations.length === 1) await saveConfig({ ...cfg, org: me.organizations[0].slug });
      const org = opts.org || process.env.RGSTR_ORG || (await loadConfig()).org || null;
      if (opts.json) printJson({ ok: true, baseUrl, user: me.user, org, organizations: me.organizations });
      else {
        console.log(`Logged in as ${me.user.email} (${baseUrl})`);
        if (org) console.log(`Active org: ${org}`);
        else if (me.organizations.length > 1) {
          console.log('Pick an org: ' + me.organizations.map((o) => `rgstr org use ${o.slug}`).join(' | '));
        }
      }
    } catch (err) {
      fail(err);
    }
  });

program
  .command('logout')
  .description('forget the stored login')
  .action(async () => {
    await clearCredentials();
    if (globals().json) printJson({ ok: true });
    else console.log('Logged out.');
  });

interface MeResponse {
  user: { id: string; email: string; name?: string | null };
  activeOrganizationId: string | null;
  organizations: Array<{ id: string; name: string; slug: string }>;
}

program
  .command('whoami')
  .description('who you are signed in as, and the active org')
  .action(async () => {
    try {
      const c = await client();
      const base = { baseUrl: c.baseUrl, auth: c.auth.kind, org: c.auth.org };
      if (c.auth.kind === 'api_key') {
        // An org key names its org itself; confirm it works with a cheap authed read.
        const claims = await c.get<{ held: Array<{ name: string }> }>('/api/v1/registry/claims');
        if (globals().json) printJson({ ...base, held: claims.held.length });
        else console.log(kv([['auth', 'org API key'], ['base', c.baseUrl], ['org', c.auth.org ?? '(from key)'], ['names held', String(claims.held.length)]]));
        return;
      }
      const me = await c.get<MeResponse>('/api/v1/me');
      if (globals().json) printJson({ ...base, user: me.user, organizations: me.organizations });
      else {
        console.log(kv([['user', me.user.email], ['base', c.baseUrl], ['org', c.auth.org ?? '(none — rgstr org use <slug>)']]));
        if (me.organizations.length) console.log('\norgs: ' + me.organizations.map((o) => o.slug).join(', '));
      }
    } catch (err) {
      fail(err);
    }
  });

const org = program.command('org').description('active organization');
org
  .command('use <slug>')
  .description('remember the org to claim and route as')
  .action(async (slug: string) => {
    const cfg = await loadConfig();
    await saveConfig({ ...cfg, org: slug });
    if (globals().json) printJson({ ok: true, org: slug });
    else console.log(`Active org: ${slug}`);
  });
org
  .command('list')
  .description('orgs you belong to')
  .action(async () => {
    try {
      const c = await client();
      const me = await c.get<MeResponse>('/api/v1/me');
      if (globals().json) printJson(me.organizations);
      else console.log(table(me.organizations.map((o) => [o.slug === c.auth.org ? '*' : ' ', o.slug, o.name])));
    } catch (err) {
      fail(err);
    }
  });

// ── use ───────────────────────────────────────────────────────────────────

program
  .command('use')
  .description("point this project's installs at rgstr (writes .npmrc / pip config)")
  .option('--npm', 'JavaScript clients only')
  .option('--pip', 'Python clients only')
  .option('--off', 'remove exactly what `rgstr use` wrote')
  .option('--dry-run', 'show the diff without writing')
  .action(async (opts: { npm?: boolean; pip?: boolean; off?: boolean; dryRun?: boolean }) => {
    try {
      const g = globals();
      const origin = await resolveBaseUrl(g);
      assertHostAllowed(origin, g.allowUntrustedHost);
      const changes = await runUse({ dir: process.cwd(), origin, ...opts });
      if (g.json) {
        printJson({ origin, changes });
        return;
      }
      if (changes.length === 0) {
        console.log('No package.json or pyproject.toml here — pass --npm or --pip to choose.');
        return;
      }
      for (const ch of changes) {
        const who = ch.clients.join(', ');
        if (ch.action === 'unchanged') console.log(`${ch.file}: already set (${who})`);
        else if (ch.action === 'absent') console.log(`${ch.file}: nothing to remove`);
        else {
          console.log(`${ch.file}: ${ch.action}${opts.dryRun ? ' (dry run)' : ''} (${who})`);
          if (ch.diff) console.log(ch.diff);
        }
      }
      if (!opts.off && changes.some((c) => c.action === 'written')) {
        console.log(`\nInstalls now resolve through ${origin}. Undo with \`rgstr use --off\`.`);
      }
    } catch (err) {
      fail(err);
    }
  });

// ── claim ─────────────────────────────────────────────────────────────────

interface ClaimResponse {
  request: { id: string; name: string; status: string; verification: string };
  dispute: { holder: string; via: string } | null;
  proof: { token: string; packageJson: string; pyproject: string; badge: string } | null;
  url: string;
}
interface ClaimsList {
  pending: Array<{ id: string; name: string; status: string; verification: string; createdAt: string }>;
  held: Array<{ id: string; name: string; kind: string; status: string }>;
}
type ProofOutcome =
  | { kind: 'verified'; detail: string; autoApproved: boolean; reviewReason?: string; sighting: { version: string; ecosystem: string; placement: string } }
  | { kind: 'not_found'; checked: string[]; failed: string[] }
  | { kind: 'error'; message: string };

program
  .command('claim [name]')
  .description('claim this package\'s name for your org and write the publish-proof token')
  .option('--check', 'check the published package for the token (after `npm publish`)')
  .option('--badge', 'write the README badge instead of the manifest field')
  .option('--npm', 'treat the package as npm')
  .option('--pip', 'treat the package as PyPI')
  .option('--statement <text>', 'a sentence for the reviewer (disputes)')
  .action(async (nameArg: string | undefined, opts: { check?: boolean; badge?: boolean; npm?: boolean; pip?: boolean; statement?: string }) => {
    try {
      const g = globals();
      const dir = process.cwd();
      const prefer: Ecosystem | undefined = opts.pip ? 'pypi' : opts.npm ? 'npm' : undefined;
      const detected = await detectPackage(dir, prefer);
      const name = nameArg ?? detected?.name;
      if (!name) throw new RgstrCliError('invalid_argument', 'No package.json or pyproject.toml here — pass the name: rgstr claim <name>');
      const ecosystem: Ecosystem = prefer ?? detected?.ecosystem ?? 'npm';
      const c = await client();

      if (opts.check) {
        const list = await c.get<ClaimsList>('/api/v1/registry/claims');
        const pending = list.pending.find((p) => p.name === name);
        if (!pending) {
          const held = list.held.find((h) => h.name === name);
          const whois = await c.get<WhoisResponse>(`/api/v1/registry/whois/${encodeURIComponent(name)}`);
          if (g.json) printJson({ name, checked: false, held: held ?? null, whois });
          else if (held?.status === 'verified') console.log(`${name}: verified — your org holds it. ${whois.url}`);
          else if (whois.holder) console.log(`${name}: held by ${whois.holder.name} (${whois.holder.slug}) — file a claim with \`rgstr claim\` to dispute it.`);
          else console.log(`${name}: no application from your org yet — run \`rgstr claim\` first.`);
          return;
        }
        const res = await c.post<{ outcome: ProofOutcome; request: ClaimsList['pending'][number] }>(`/api/v1/registry/claims/${pending.id}/check-proof`);
        if (g.json) {
          printJson({ name, ...res });
          return;
        }
        const o = res.outcome;
        if (o.kind === 'verified') {
          console.log(`${name}: verified — ${o.detail}`);
          console.log(o.autoApproved ? `Approved: your org now holds ${name}.` : `Proof recorded; ${o.reviewReason ?? 'held by someone else'} → a reviewer decides.`);
        } else if (o.kind === 'not_found') {
          const where = o.checked.length ? o.checked.join(' and ') : 'npm or PyPI';
          console.log(`${name}: token not found yet on ${where}${detected?.version ? ` (checked up to your local ${detected.version})` : ''}.`);
          if (o.failed.length) console.log(`Could not reach: ${o.failed.join(', ')}.`);
          console.log('Publish a patch that carries the token, then run `rgstr claim --check` again.');
        } else console.log(`${name}: check failed — ${o.message}`);
        return;
      }

      let claim: ClaimResponse;
      try {
        claim = await c.post<ClaimResponse>('/api/v1/registry/claims', { name, statement: opts.statement });
      } catch (err) {
        if (!(err instanceof RgstrApiError && err.status === 409)) throw err;
        // Already applied: keep going so the token still gets written.
        const list = await c.get<ClaimsList>('/api/v1/registry/claims');
        const pending = list.pending.find((p) => p.name === name);
        if (!pending) throw err;
        if (g.json) printJson({ name, request: pending, alreadyPending: true });
        else console.log(`${name}: your org already has an application under review (${pending.id.slice(0, 8)}). Run \`rgstr claim --check\` after publishing.`);
        return;
      }

      let wrote: string | null = null;
      if (claim.proof) {
        if (opts.badge) {
          const readme = await findReadme(dir);
          const current = await fs.readFile(readme, 'utf8').catch(() => null);
          const { next, changed } = withBadge(current, claim.proof.badge);
          if (changed) await fs.writeFile(readme, next);
          wrote = path.relative(dir, readme) || readme;
        } else if (detected && detected.ecosystem === ecosystem && detected.name === name) {
          const source = await fs.readFile(detected.manifest, 'utf8');
          const { next, changed } =
            ecosystem === 'npm' ? withNpmProof(source, claim.proof.token) : withPypiProof(source, claim.proof.pyproject);
          if (changed) await fs.writeFile(detected.manifest, next);
          wrote = path.relative(dir, detected.manifest);
        }
      }

      if (g.json) {
        printJson({ name, ecosystem, ...claim, wrote });
        return;
      }
      console.log(`Filed: ${name} for ${c.auth.org ?? 'your org'} (${claim.url})`);
      if (claim.dispute) console.log(`Held by ${claim.dispute.holder} via ${claim.dispute.via} — this is a dispute; a reviewer decides.`);
      if (claim.proof) {
        if (wrote) console.log(`Wrote the publish-proof token to ${wrote}.`);
        else {
          console.log('Add the publish-proof token to the package you publish:');
          console.log(`  package.json:    ${claim.proof.packageJson}`);
          console.log(`  pyproject.toml:  [project.urls] ${claim.proof.pyproject}`);
          console.log(`  README badge:    ${claim.proof.badge}`);
        }
        console.log('Publish a patch, then `rgstr claim --check`.');
      } else console.log('Namespace claims are reviewed on identity + evidence; nothing to publish.');
    } catch (err) {
      fail(err);
    }
  });

// ── whois ─────────────────────────────────────────────────────────────────

interface WhoisResponse {
  name: string;
  url: string;
  trust: 'unclaimed' | 'claimed' | 'verified';
  state: 'unclaimed' | 'pending' | 'held' | 'disputed';
  holder: { name: string; slug: string; url: string; via: string; kind: string; status: string } | null;
  routes: RouteRecord[];
  hiddenCopies: number | null;
}

program
  .command('whois <name>')
  .description('who holds a name, how much to trust it, and where it routes')
  .action(async (name: string) => {
    try {
      const c = await client(true);
      const w = await c.get<WhoisResponse>(`/api/v1/registry/whois/${encodeURIComponent(name)}`);
      if (globals().json) {
        printJson(w);
        return;
      }
      const routes = w.routes.length
        ? w.routes.map((r) => `${r.versionRange} → ${r.upstreamKind}:${r.upstreamName ?? w.name}${r.upstreamKind === 'npm' && r.upstream === 'https://registry.npmjs.org' ? '' : ` (${r.upstream})`}`).join('\n' + ' '.repeat(9))
        : w.holder
          ? `* → npm:${w.name} (default)`
          : 'upstream passthrough (npm, then PyPI)';
      console.log(
        kv([
          ['name', w.name],
          ['trust', w.trust + (w.state === 'disputed' ? ' (disputed — an application is under review)' : w.state === 'pending' ? ' (application pending)' : '')],
          ['holder', w.holder ? `${w.holder.name} (${w.holder.slug}) ${w.holder.url}${w.holder.via !== w.name ? ` via ${w.holder.via}` : ''}` : 'nobody'],
          ['routes', routes],
          ['hidden', w.hiddenCopies ? `${w.hiddenCopies} copies hidden under this name` : null],
          ['page', w.url],
        ]),
      );
    } catch (err) {
      fail(err);
    }
  });

// ── route ─────────────────────────────────────────────────────────────────

interface OrgPackage {
  id: string;
  name: string;
  status: string;
}

async function heldPackage(c: RgstrClient, name: string): Promise<OrgPackage> {
  const res = await c.get<{ packages: OrgPackage[] }>('/api/v1/packages');
  const pkg = res.packages.find((p) => p.name === name);
  if (!pkg) throw new RgstrCliError('not_holder', `${c.auth.org ?? 'Your org'} does not hold ${name} — see \`rgstr whois ${name}\`.`);
  return pkg;
}

program
  .command('route <name>')
  .description('list, add (--to) or remove (--rm) upstream routes for a name you hold')
  .option('--to <spec>', 'add a route, e.g. npm:tsc-rs@^0.7 or jsr:@scope/pkg@^1')
  .option('--rm <id>', 'remove a route by id (prefix ok)')
  .action(async (name: string, opts: { to?: string; rm?: string }) => {
    try {
      const c = await client();
      const pkg = await heldPackage(c, name);
      const path = `/api/v1/packages/${pkg.id}/routes`;
      const current = (await c.get<{ routes: RouteRecord[] }>(path)).routes;
      let routes = current;
      if (opts.to || opts.rm) {
        let next: RouteInput[] = current.map(({ versionRange, upstreamKind, upstream, upstreamName }) => ({ versionRange, upstreamKind, upstream, upstreamName }));
        if (opts.rm) {
          const victim = current.find((r) => r.id === opts.rm || r.id.startsWith(opts.rm!));
          if (!victim) throw new RgstrCliError('not_found', `No route ${opts.rm} on ${name}`);
          next = next.filter((_, i) => current[i].id !== victim.id);
        }
        if (opts.to) {
          const parsed = parseRouteSpec(opts.to, name);
          next.push(parsed);
        }
        routes = (await c.put<{ routes: RouteRecord[] }>(path, { routes: next })).routes;
      }
      if (globals().json) {
        printJson({ name, packageId: pkg.id, routes });
        return;
      }
      if (routes.length === 0) console.log(`${name}: no routes (default: npm:${name})`);
      else console.log(table(routes.map((r) => formatRouteRow(r, name)), ['id', 'range', 'target', 'upstream']));
    } catch (err) {
      fail(err);
    }
  });

// ── search ────────────────────────────────────────────────────────────────

interface SearchObject {
  package: { name: string; version?: string; description?: string };
  rgstr: { trust: string; owner?: { name?: string; slug?: string } | null; tier: string; demotion?: unknown; weeklyDownloads?: number | null };
}

program
  .command('search <query>')
  .description('search names in rgstr\'s order, with trust and weekly downloads')
  .option('--size <n>', 'rows', '10')
  .action(async (query: string, opts: { size: string }) => {
    try {
      const c = await client(true);
      const res = await c.get<{ objects: SearchObject[]; total: number }>(`/api/registry/-/v1/search?text=${encodeURIComponent(query)}&size=${Number(opts.size) || 10}`);
      if (globals().json) {
        printJson(res);
        return;
      }
      if (res.objects.length === 0) {
        console.log(`No results for "${query}".`);
        return;
      }
      console.log(
        table(
          res.objects.map((o) => [
            o.package.name,
            o.package.version ?? '',
            o.rgstr.trust + (o.rgstr.owner?.slug ? ` (${o.rgstr.owner.slug})` : ''),
            fmtDownloads(o.rgstr.weeklyDownloads),
            (o.package.description ?? '').slice(0, 60),
          ]),
          ['name', 'version', 'trust', 'downloads', 'description'],
        ),
      );
    } catch (err) {
      fail(err);
    }
  });

program.parseAsync(process.argv).catch(fail);
