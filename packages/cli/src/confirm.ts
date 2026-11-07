/**
 * Confirmation for CLI writes that hide, remove or change shared state.
 * `-y/--yes` skips it; an interactive terminal is asked; anything else
 * (scripts, agents, CI) is refused with a hint, so a write never happens
 * because nobody was there to say no.
 */

import { createInterface } from 'node:readline/promises';
import { ActionsCliError } from './actions-client.js';

/**
 * Resolve when the write may go ahead. Throws `confirmation_required` when
 * stdin is not a TTY and `--yes` was not passed, and `cancelled` when the
 * prompt is answered with anything but y/yes.
 */
export async function confirmWrite(question: string, opts: { yes?: boolean }): Promise<void> {
  if (opts.yes) return;
  if (!process.stdin.isTTY) {
    throw new ActionsCliError('confirmation_required', `${question} Pass -y to confirm.`);
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  let answer: string;
  try {
    answer = await rl.question(`${question} [y/N] `);
  } finally {
    rl.close();
  }
  if (!/^y(es)?$/i.test(answer.trim())) {
    throw new ActionsCliError('cancelled', 'Cancelled; nothing was changed.');
  }
}
