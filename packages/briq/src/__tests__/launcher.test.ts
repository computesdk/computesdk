import { createHash } from 'node:crypto';
import { daemonSeedScript, daemonSeedScriptCommand } from 'daemond';
import { expect, it } from 'vitest';
import { DAEMON_SHA256, NODE_SHA256, daemonPayload, launch } from '../launcher';
it('recognizes both exact official factory envelopes without interpreting user shell', () => {
  const payload = {
    stdin: 'job',
    data: Buffer.from("雪\n'\0").toString('base64'),
    encoding: 'base64' as const,
  };
  for (const argvEncoding of [undefined, 'base64'] as const) {
    const command = daemonSeedScriptCommand(
      { ssePort: 38989 },
      payload,
      argvEncoding ? { argvEncoding } : undefined,
    );
    expect(JSON.parse(daemonPayload(command)!)).toEqual(payload);
  }
  expect(daemonPayload('printf hello')).toBeUndefined();
});
it('moves oversized official bootstrap into finite stdin and fixes the effective launcher environment', () => {
  const command = daemonSeedScriptCommand(
    { ssePort: 38989 },
    {
      command: 'sh',
      args: ['-lc', 'echo fixture'],
      env: { DAEMOND_NODE_SKIP_SHA256: '1', DAEMOND_NODE_DIST_URL: 'http://untrusted.invalid' },
    },
  );
  expect(Buffer.byteLength(command)).toBeGreaterThan(32768);
  const request = launch('bq_owned', daemonPayload(command)!, 'a'.repeat(64));
  expect(request.cmd.every((arg) => Buffer.byteLength(arg) < 32768)).toBe(true);
  expect(request.stdin).toContain(NODE_SHA256);
  expect(request.stdin).toContain('os.lstat');
  expect(request.stdin).toContain('s.st_mode&0o077');
  expect(request.stdin).toContain('umask 077');
  expect(request.stdin).toContain('daemon.cjs');
  expect(request.env).toEqual({});
  expect(request.cmd).toContain('-i');
  expect(request.cmd.join(' ')).not.toContain('SKIP_SHA256');
  expect(request.cmd.join(' ')).not.toContain('untrusted.invalid');
});
it('pins the hash of the daemon source that daemond persists', () => {
  const script = daemonSeedScript({ name: 'hash-check', ssePort: 38989 });
  const source = /DAEMON_SOURCE=Buffer\.from\('([^']+)'/.exec(script)?.[1];
  expect(source).toBeDefined();
  const bytes = Buffer.from(source as string, 'base64');
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(DAEMON_SHA256);
});
