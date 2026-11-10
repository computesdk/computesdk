import http2, { type ClientHttp2Session, type ClientHttp2Stream } from 'node:http2';
import type { Duplex } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { modal } from '../index';

const skip = !process.env.MODAL_PROFILE && (!process.env.MODAL_TOKEN_ID || !process.env.MODAL_TOKEN_SECRET);

function dropOutputConnections() {
  const connections: { session: ClientHttp2Session; socket?: Duplex; reads: ClientHttp2Stream[] }[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  const seen = new Set<string>();
  const dropped: ClientHttp2Session[] = [];
  const errors: string[] = [];
  const connect = http2.connect;
  const spy = vi.spyOn(http2, 'connect').mockImplementation((authority, options, listener) => {
    let socket: Duplex | undefined;
    const session = connect(authority, {
      ...options,
      ...(options?.createConnection && {
        createConnection: (...args: Parameters<NonNullable<typeof options.createConnection>>) => {
          socket = options.createConnection!(...args);
          return socket;
        },
      }),
    }, listener);
    const connection = { session, socket, reads: [] as ClientHttp2Stream[] };
    connections.push(connection);
    const request = session.request.bind(session);
    session.request = (headers, requestOptions) => {
      const stream = request(headers, requestOptions);
      if (String(headers?.[':path']).endsWith('/TaskExecStdioRead')) {
        connection.reads.push(stream);
        let tail = Buffer.alloc(0);
        stream.on('data', (chunk: Buffer) => {
          const data = Buffer.concat([tail, chunk]);
          for (const marker of ['before🌍\n', 'before-error🌍\n']) {
            if (data.includes(Buffer.from(marker))) seen.add(marker);
          }
          tail = data.subarray(-64);
          if (seen.size === 2 && timers.length === 0) {
            // Drop the actual TLS sockets while both output reads are pending.
            // Only this test process's exec-output connections are affected.
            for (const delay of [5000, 15000, 30000]) {
              timers.push(setTimeout(() => {
                const active = connections.filter(c => c.reads.some(s => !s.closed && !s.destroyed));
                if (active.length !== 1 || !active[0].socket || active[0].socket.destroyed) {
                  errors.push(`No unique live output connection at ${delay} ms`);
                  return;
                }
                dropped.push(active[0].session);
                active[0].socket.destroy(new Error('Injected quiet-interval disconnect'));
              }, delay));
            }
          }
        });
      }
      return stream;
    };
    return session;
  });
  return {
    verify() {
      expect(errors).toEqual([]);
      expect(dropped).toHaveLength(3);
      expect(new Set(dropped).size).toBe(3);
      expect(connections.filter(c => c.reads.length >= 2).length).toBeGreaterThanOrEqual(4);
    },
    restore() {
      timers.forEach(clearTimeout);
      spy.mockRestore();
    },
  };
}

describe.skipIf(skip)('Modal command output over a quiet interval', () => {
  it.each([
    { runtime: 'gvisor', disconnect: false },
    { runtime: 'vm', disconnect: false },
    { runtime: 'gvisor', disconnect: true },
    { runtime: 'vm', disconnect: true },
  ])('keeps all output on $runtime with disconnect=$disconnect', async ({ runtime, disconnect }) => {
    const provider = modal({ appName: 'libmodal-test', environment: process.env.MODAL_ENVIRONMENT, timeout: 180000 });
    const sandbox = await provider.sandbox.create(runtime === 'vm' ? { runtime: 'vm' } : {});
    const faults = disconnect ? dropOutputConnections() : undefined;
    try {
      // Leave both streams quiet longer than the interval that exposed output
      // loss in CPU benchmarks, then write more than a pipe buffer to each.
      const command = `
printf 'before🌍\\n'
printf 'before-error🌍\\n' >&2
sleep 35
printf 'middle🌍\\n'
printf 'middle-error🌍\\n' >&2
head -c 1048576 /dev/zero | tr '\\000' x
head -c 1048576 /dev/zero | tr '\\000' e >&2
printf '\\nend🌍\\n'
printf '\\nend-error🌍\\n' >&2
exit 7
`;
      const result = await sandbox.runCommand(command, { timeout: 90000 });
      expect(result.exitCode).toBe(7);
      expect(result.stdout).toBe('before🌍\nmiddle🌍\n' + 'x'.repeat(1048576) + '\nend🌍\n');
      expect(result.stderr).toBe('before-error🌍\nmiddle-error🌍\n' + 'e'.repeat(1048576) + '\nend-error🌍\n');
      faults?.verify();
    } finally {
      faults?.restore();
      await sandbox.getInstance().instance.terminate({ wait: true });
    }
  }, 180000);
});
