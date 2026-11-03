// Intentionally do not persist errors, stdout/stderr, env values or raw Vitest
// JSON. Native exceptions can contain headers/credentials. Actions owns logs.
import { writeFileSync } from 'node:fs';

export function summarizeNative(files = [], errors = []) {
  const cases = [];
  const visit = (task, parents = []) => {
    const names = [...parents, task.name || ''];
    if (task.type === 'test') {
      if (names.some(name => name.includes('[native]'))) {
        cases.push({ name: names.join(' > '), title: task.name, state: task.result?.state || task.mode || 'unknown' });
      }
    } else for (const child of task.tasks || []) visit(child, names);
  };
  for (const file of files) visit(file);
  return {
    mode: 'native',
    nativePassed: cases.filter(c => c.state === 'pass').length,
    nativeFailed: cases.filter(c => c.state === 'fail').length,
    nativeSkipped: cases.filter(c => !['pass', 'fail'].includes(c.state)).length,
    failedFiles: files.filter(file => file.result?.state === 'fail').length,
    unhandledErrors: errors.length,
    cases,
  };
}

export default class ComputeConformanceReporter {
  onFinished(files, errors) {
    const output = process.env.COMPUTE_CONFORMANCE_REPORT;
    if (!output) throw new Error('Missing conformance report destination');
    writeFileSync(output, JSON.stringify(summarizeNative(files, errors), null, 2) + '\n');
  }
}
