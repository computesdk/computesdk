import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { inheritParentOptions } from '../option-inheritance.js';

/** compute → group (--org --json --only-parent) → leaf (--org --json --limit, default --mode) */
async function parse(args: string[]): Promise<Record<string, unknown>> {
  let seen: Record<string, unknown> = {};
  const program = inheritParentOptions(new Command().exitOverride());
  program.option('--org <slug>');
  const group = program.command('group').option('--org <slug>').option('--json').option('--only-parent <x>');
  group
    .command('leaf')
    .option('--org <slug>')
    .option('--json')
    .option('--limit <n>')
    .option('--mode <m>', 'a default', 'plain')
    .action((opts) => {
      seen = opts;
    });
  await program.parseAsync(args, { from: 'user' });
  return seen;
}

describe('inheritParentOptions', () => {
  it('a flag given to the parent reaches the subcommand that declares it', async () => {
    expect(await parse(['group', '--org', 'team-b', '--json', 'leaf'])).toMatchObject({ org: 'team-b', json: true });
  });

  it("the subcommand's own flag wins", async () => {
    expect((await parse(['group', '--org', 'team-a', 'leaf', '--org', 'team-b'])).org).toBe('team-b');
  });

  it('the nearest parent wins over the root', async () => {
    expect((await parse(['--org', 'root', 'group', '--org', 'near', 'leaf'])).org).toBe('near');
    expect((await parse(['--org', 'root', 'group', 'leaf'])).org).toBe('root');
  });

  it('only fills options the subcommand declares, and leaves defaults alone otherwise', async () => {
    const opts = await parse(['group', '--only-parent', 'x', 'leaf', '--limit', '5']);
    expect(opts).not.toHaveProperty('onlyParent');
    expect(opts).toMatchObject({ limit: '5', mode: 'plain' });
    expect(opts).not.toHaveProperty('org');
  });
});
