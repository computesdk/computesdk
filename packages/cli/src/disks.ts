import { Command } from 'commander';
import type { PersistentDisk } from '@computesdk/platform';
import { client, fail, output, type CommonOpts } from './actions.js';
import { randomUUID } from 'node:crypto';
import { safeTerm, safeTermText } from './term.js';
export function registerDiskCommands(program: Command): void {
  const disks = program.command('disks').description('Persistent native storage independent of compute');
  const common = (c: Command) => c.option('--api-key <key>').option('--base-url <url>').option('--org <slug>').option('--allow-untrusted-host').option('--json');
  common(disks.command('create').description('Create retained storage; omitted region uses provider locality then configured fallback')
    .option('--region <region>', 'canonical Archil storage region').option('--provider <provider>', 'expected compute provider for locality inference')
    .option('--compute-region <region>', 'expected compute location; does not allocate compute').option('--idempotency-key <key>', 'stable retry key'))
    .action(async (opts: CommonOpts & { region?: string; provider?: string; computeRegion?: string; idempotencyKey?: string }) => {
      const key = opts.idempotencyKey ?? `cli-disk:${randomUUID()}`;
      try {
        const result = await (await client(opts)).post<{ disk: PersistentDisk }>('/api/v1/disks', { idempotencyKey: key, region: opts.region, provider: opts.provider, computeRegion: opts.computeRegion });
        output(opts, result, r => console.log(safeTerm(r.disk.id)));
      } catch (e) { fail(new Error(`${e instanceof Error ? e.message : String(e)}; retry create with --idempotency-key ${key}`), opts); }
    });
  common(disks.command('list').description('List up to 200 disks')).action(async (opts: CommonOpts) => {
    try { output(opts, await (await client(opts)).get('/api/v1/disks'), r => console.log(safeTermText(JSON.stringify(r, null, 2)))); } catch(e) { fail(e, opts); }
  });
  for (const name of ['get', 'delete'] as const) {
    common(disks.command(`${name} <id>`).description(name === 'get' ? 'Inspect a disk and attachment' : 'Permanently delete an unattached disk'))
      .action(async (id: string, opts: CommonOpts) => {
        try {
          if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Disk ID must be a platform UUID');
          const c = await client(opts), url = `/api/v1/disks/${id}`;
          output(opts, await (name === 'get' ? c.get(url) : c.del(url)), r => console.log(safeTermText(JSON.stringify(r, null, 2))));
        } catch(e) { fail(e, opts); }
      });
  }
}
