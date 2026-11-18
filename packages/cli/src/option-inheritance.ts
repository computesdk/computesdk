/**
 * Flags given to a parent command reach its subcommand.
 *
 * Several groups declare the shared flags (--org, --api-key, --base-url,
 * --json, …) on the parent as well as on each subcommand, so
 * `compute credits --org team-b topup 50` parses: but commander stores
 * `--org` on `credits`, and `topup`'s action only reads its own options —
 * the checkout would go to the active org instead of team-b. This hook, on
 * the root program, runs before every action and copies each option a parent
 * received (on the command line or from env) onto the subcommand that
 * declares the same option and didn't get it itself. The subcommand's own
 * value always wins, and the nearest parent wins over farther ones.
 */

import type { Command } from 'commander';

const GIVEN = new Set(['cli', 'env']);

export function inheritParentOptions(program: Command): Command {
  return program.hook('preAction', (_hooked, actionCommand) => {
    const declared = new Set(actionCommand.options.map((option) => option.attributeName()));
    for (let parent = actionCommand.parent; parent; parent = parent.parent) {
      for (const [key, value] of Object.entries(parent.opts())) {
        if (!declared.has(key) || value === undefined) continue;
        if (!GIVEN.has(parent.getOptionValueSource(key) ?? '')) continue;
        if (GIVEN.has(actionCommand.getOptionValueSource(key) ?? '')) continue;
        actionCommand.setOptionValueWithSource(key, value, parent.getOptionValueSource(key)!);
      }
    }
  });
}
