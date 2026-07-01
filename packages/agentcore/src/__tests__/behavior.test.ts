/**
 * AgentCore-specific behavior tests.
 *
 * These lock in correctness fixes that the generic provider suite doesn't cover:
 * byte-exact output with LF line endings (AgentCore runs commands through a PTY),
 * true stdout/stderr/exit-code separation on failure, shell-safe handling of
 * paths/values with `$`, spaces, and quotes, directory listing, and env passing.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { agentcore } from '../index';
import type { ProviderSandbox } from '@computesdk/provider';

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
const hasCredentials = Boolean(
  region &&
    (process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE || process.env.AWS_SESSION_TOKEN),
);

const describeFn = hasCredentials ? describe : describe.skip;

describeFn('agentcore behavior', () => {
  const provider = agentcore({ region });
  let sandbox: ProviderSandbox;

  const getSandbox = async () => {
    if (!sandbox) sandbox = await provider.sandbox.create();
    return sandbox;
  };

  afterAll(async () => {
    if (sandbox) await sandbox.destroy().catch(() => {});
  });

  it('normalizes CRLF output to LF', async () => {
    const sb = await getSandbox();
    const result = await sb.runCommand('printf "a\\nb\\nc\\n"');
    expect(result.stdout).toBe('a\nb\nc\n');
    expect(result.stdout).not.toContain('\r');
  }, 60000);

  it('handles paths containing $ and spaces without expansion', async () => {
    const sb = await getSandbox();
    const path = '/tmp/agentcore test/da$h.txt';
    await sb.filesystem.writeFile(path, 'literal');
    expect(await sb.filesystem.readFile(path)).toBe('literal');
    expect(await sb.filesystem.exists(path)).toBe(true);
  }, 60000);

  it('round-trips file content exactly, including special characters', async () => {
    const sb = await getSandbox();
    const content = 'line1\nline2\t"quoted" $VAR `cmd` \'single\'\n';
    await sb.filesystem.writeFile('/tmp/special.txt', content);
    expect(await sb.filesystem.readFile('/tmp/special.txt')).toBe(content);
  }, 60000);

  it('passes environment variables to the command', async () => {
    const sb = await getSandbox();
    const result = await sb.runCommand('printenv GREETING', { env: { GREETING: 'hi there$x' } });
    expect(result.stdout).toBe('hi there$x\n');
  }, 60000);

  it('reports a non-zero exit code for failing commands', async () => {
    const sb = await getSandbox();
    const result = await sb.runCommand('exit 42');
    expect(result.exitCode).toBe(42);
  }, 60000);

  it('preserves stdout and separates stderr even when the command fails', async () => {
    // AgentCore's PTY otherwise merges streams and drops stdout on non-zero exit.
    const sb = await getSandbox();
    const result = await sb.runCommand('echo to-out; echo to-err >&2; exit 7');
    expect(result.stdout).toBe('to-out\n');
    expect(result.stderr).toBe('to-err\n');
    expect(result.exitCode).toBe(7);
  }, 60000);

  it('lists directory entries with spaces and correct types', async () => {
    const sb = await getSandbox();
    await sb.filesystem.writeFile('/tmp/listdir/my file.txt', 'a');
    await sb.filesystem.mkdir('/tmp/listdir/sub');
    const entries = await sb.filesystem.readdir('/tmp/listdir');
    const byName = Object.fromEntries(entries.map((e) => [e.name, e.type]));
    expect(byName['my file.txt']).toBe('file');
    expect(byName['sub']).toBe('directory');
  }, 60000);

  it('lists filenames containing control characters byte-exactly', async () => {
    // The NUL-delimited find output must survive names with tabs (a byte the
    // raw structuredContent stream would otherwise mangle to '?').
    const sb = await getSandbox();
    await sb.runCommand(`mkdir -p /tmp/ctrldir && cd /tmp/ctrldir && : > "$(printf 'a\\tb')"`);
    const names = (await sb.filesystem.readdir('/tmp/ctrldir')).map((e) => e.name);
    expect(names).toContain('a\tb');
  }, 60000);

  it('writes a large file that exceeds the single-command size limit', async () => {
    // >128KB base64 would hang the PTY in a single command; writeFile chunks it.
    const sb = await getSandbox();
    const content = 'A'.repeat(500_000) + '\nΩ end';
    await sb.filesystem.writeFile('/tmp/large.txt', content);
    expect(await sb.filesystem.readFile('/tmp/large.txt')).toBe(content);
  }, 120000);

  it('does not corrupt concurrent writes to the same path', async () => {
    // Per-call UUID staging must prevent parallel writes from interleaving.
    const sb = await getSandbox();
    const candidates = ['A'.repeat(200_000), 'B'.repeat(200_000), 'C'.repeat(200_000)];
    await Promise.all(candidates.map((c) => sb.filesystem.writeFile('/tmp/concurrent.txt', c)));
    const final = await sb.filesystem.readFile('/tmp/concurrent.txt');
    expect(candidates).toContain(final); // one writer wins intact; no interleave
  }, 120000);
});
