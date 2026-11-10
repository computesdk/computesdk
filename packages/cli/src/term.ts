/** Terminal-safe text and status labels shared by the `compute actions` modules. */

import pc from 'picocolors';

// Job and step names come from workflow files — potentially attacker-controlled
// in a PR context — so strip control characters before writing to the terminal.
export function safeTerm(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001F\u007F-\u009F]/g, '�');
}

export function conclusionLabel(conclusion: string): string {
  switch (conclusion) {
    case 'passed': return pc.green('passed');
    case 'failed': return pc.red('failed');
    case 'running': return pc.yellow('running');
    case 'cancelled': return pc.gray('cancelled');
    case 'none': return pc.yellow('queued');
    default: return conclusion;
  }
}
