/** Terminal-safe text and status labels shared by the `compute actions` modules. */

import pc from 'picocolors';

// Job and step names come from workflow files — potentially attacker-controlled
// in a PR context — so strip control characters before writing to the terminal.
export function safeTerm(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001F\u007F-\u009F]/g, '�');
}

/**
 * `safeTerm` for multi-line text (error messages, hints): newlines and tabs
 * stay, every other control character is replaced.
 */
export function safeTermText(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '�');
}

export function conclusionLabel(conclusion: string): string {
  switch (conclusion) {
    case 'passed': return pc.green('passed');
    case 'failed': return pc.red('failed');
    case 'running': return pc.yellow('running');
    case 'cancelled': return pc.gray('cancelled');
    case 'none': return pc.yellow('queued');
    // Anything else is the server's string verbatim.
    default: return safeTerm(conclusion);
  }
}
