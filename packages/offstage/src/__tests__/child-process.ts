import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface ChildResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Still running at the limit, and killed. */
  killed: boolean;
  ms: number;
}

const entry = pathToFileURL(resolve(__dirname, '../index.ts')).href;

/**
 * Runs `script` in a fresh Node process that imports the provider's source
 * and has its exports in scope as `provider` (`provider.offstage`), and
 * reports how the process ended. Whether pooled sessions hold a process open
 * can only be seen from outside it. `env` replaces every OFFSTAGE_* variable
 * of this process, so the child never reaches anything it was not pointed at.
 */
export function runWithProvider(script: string, env: Record<string, string>, limitMs = 20_000): Promise<ChildResult> {
  const childEnv: Record<string, string | undefined> = { ...process.env };
  for (const name of Object.keys(childEnv)) if (name.startsWith('OFFSTAGE_')) delete childEnv[name];
  Object.assign(childEnv, env);
  const started = Date.now();
  const child = spawn(
    process.execPath,
    [
      '--import', 'tsx', '--input-type=module', '-e',
      // tsx loads the package's CommonJS source as a module whose exports may sit under `default`.
      `const loaded = await import(${JSON.stringify(entry)});\nconst provider = loaded.offstage ? loaded : loaded.default;\n${script}`,
    ],
    { cwd: resolve(__dirname, '../..'), env: childEnv },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  let killed = false;
  const timer = setTimeout(() => {
    killed = true;
    child.kill('SIGKILL');
  }, limitMs);
  return new Promise((done) => {
    child.on('exit', (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr, killed, ms: Date.now() - started });
    });
  });
}
