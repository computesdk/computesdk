import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult } from '@computesdk/provider';
import { sprites, SpritesCommandProtocolError } from '../index';

// Exercise the real adapter with a loopback-only WebSocket peer and mocked
// lifecycle HTTP. Bash is bounded and local; never contact a provider.
let execBody: ((script: string) => string) | undefined;
let execFrames: ((script: string, socket: WebSocket) => void) | undefined;
let server: WebSocketServer;
let baseUrl: string;
let handshake: { url?: string; authorization?: string };
const roots: string[] = [];
const stderrFiles: string[] = [];

function bytes(data: RawData): Buffer {
  return Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
}

function frame(socket: WebSocket, channel: number, payload: string | Buffer = '') {
  socket.send(Buffer.concat([Buffer.from([channel]), Buffer.from(payload)]));
}

function runScript(script: string): Buffer {
  // Sprites feeds bash its script on stdin, unlike an exec API using -c.
  const result = spawnSync('/bin/bash', ['--noprofile', '--norc'], {
    input: script, timeout: 2_000, env: { PATH: '/usr/bin:/bin' },
  });
  if (result.error) throw result.error;
  expect(result.status).toBe(0);
  expect(result.stderr.length).toBe(0);
  return result.stdout;
}

beforeEach(async () => {
  execBody = undefined;
  execFrames = undefined;
  handshake = {};
  server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing loopback port');
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
  server.on('connection', (socket, request) => {
    handshake = { url: request.url, authorization: request.headers.authorization };
    const input: Buffer[] = [];
    socket.on('error', () => {});
    socket.on('message', (data, isBinary) => {
      const message = bytes(data);
      expect(isBinary).toBe(true);
      if (message[0] === 0) { input.push(message.subarray(1)); return; }
      expect(message).toEqual(Buffer.from([4]));
      const script = Buffer.concat(input).toString('utf8');
      const stderrFile = script.match(/\/tmp\/\.computesdk-stderr-[A-Za-z0-9_]+/)?.[0];
      if (stderrFile) stderrFiles.push(stderrFile);
      if (execFrames) { execFrames(script, socket); return; }
      frame(socket, 1, execBody ? execBody(script) : runScript(script));
      frame(socket, 3, Buffer.from([0]));
    });
  });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (new URL(url).pathname.endsWith('/exec')) throw new Error('HTTP exec must not be used');
    return new Response(JSON.stringify({ id: 'local', name: 'local' }));
  }));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const socket of server.clients) socket.terminate();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const file of stderrFiles.splice(0)) rmSync(file, { force: true });
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function instance() {
  return sprites({ apiKey: 'mock-only', baseUrl }).instances.create();
}

describe('Sprites real-adapter command contract (local native boundary)', () => {
  it('preserves distinct output messages without leaking channel SOH into quoted stdout', async () => {
    execFrames = (script, socket) => {
      const output = runScript(script);
      const footer = output.indexOf('__COMPUTESDK_EXIT_');
      expect(footer).toBeGreaterThan(0);
      // Synthetic official protocol, NOT a native wire capture. The equivalent
      // HTTP chunks reproduced "\u0001hello world\n\u0001" before the fix.
      // Emit consecutive messages in one tick; the WebSocket layer retains
      // message boundaries regardless of TCP splitting/coalescing.
      frame(socket, 1, output.subarray(0, footer));
      frame(socket, 1, output.subarray(footer));
      frame(socket, 3, Buffer.from([0]));

    };
    const result = await (await instance()).runCommand('echo "hello world"');
    expect(result).toMatchObject({ stdout: 'hello world\n', stderr: '', exitCode: 0 });
    expect(handshake.authorization).toBe('Bearer mock-only');
    expect(handshake.url).not.toContain('mock-only');
    expect(handshake.url).toContain('/v1/sprites/local/exec?');
    expect(handshake.url).toContain('stdin=true');
  });

  it('reassembles fragmented messages and split UTF-8 without stripping payload controls or mixing streams', async () => {
    const nativeStderr = Buffer.from('native\0\x01\x02\x03 café🚀');
    execFrames = (script, socket) => {
      const output = runScript(script);
      // Public ws fragmentation: a channel prefix belongs to the MESSAGE,
      // never to each underlying WebSocket continuation/TCP fragment.
      socket.send(Buffer.from([1]), { binary: true, fin: false });
      socket.send(output.subarray(0, 1), { binary: true, fin: true });
      // One output byte per distinct message splits multi-byte UTF-8, shell
      // footer tokens, NUL and literal channel-valued user bytes.
      for (let i = 1; i < output.length; i++) frame(socket, 1, output.subarray(i, i + 1));
      for (const byte of nativeStderr) frame(socket, 2, Buffer.from([byte]));
      frame(socket, 3, Buffer.from([0]));
    };
    const result = await (await instance()).runCommand(
      "printf 'A\\000\\001\\002\\003 café🚀'; printf 'err\\000\\001\\002\\003 café🚀' >&2; exit 7",
    );
    expect(result).toMatchObject({
      stdout: 'A\0\x01\x02\x03 café🚀',
      stderr: `err\0\x01\x02\x03 café🚀${nativeStderr.toString('utf8')}`,
      exitCode: 7,
    });
  });

  it('accepts documented text metadata and a valid text transport exit without inventing child zero', async () => {
    execFrames = (script, socket) => {
      socket.send('control: notification');
      socket.send(JSON.stringify({ type: 'session_info', session_id: 'local', tty: false }));
      frame(socket, 1, runScript(script));
      socket.send(JSON.stringify({ type: 'exit', exit_code: 0 }));
    };
    expect(await (await instance()).runCommand('exit 9')).toMatchObject({ stdout: '', stderr: '', exitCode: 9 });
  });

  it.each([
    ['known error', { type: 'error', error: 'private-error' }, 'error'],
    ['unexpected TTY', { type: 'session_info', tty: true }, 'session_info'],
    ['camelCase exit', { type: 'exit', exitCode: 0 }, 'exit'],
  ])('reports only safe allowlisted shapes for %s without accepting an unknown completion', async (_name, message, kind) => {
    execFrames = (_script, socket) => socket.send(JSON.stringify(message));
    let caught: unknown;
    try { await (await instance()).runCommand('echo private-command'); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(SpritesCommandProtocolError);
    const error = caught as SpritesCommandProtocolError;
    expect(error.diagnostic).toMatchObject({
      phase: 'text-kind', kind, afterExit: false,
      fields: { type: { present: true, type: 'string' } },
    });
    if (_name === 'camelCase exit') {
      expect(error.diagnostic?.fields?.exitCode).toEqual({ present: true, type: 'number', numericRange: 'zero' });
      expect(error.diagnostic?.fields?.exit_code).toEqual({ present: false, type: 'undefined' });
    }
    expect(`${error.message}\n${JSON.stringify(error)}`).not.toContain('private-');
    expect(error.message).toContain('"phase":"text-kind"');
  });

  it('ignores unknown string-typed JSON notifications before and after real output/completion', async () => {
    execFrames = (script, socket) => {
      // Synthetic fixture matching Native's safe observed shape (type:string,
      // exit_code/exitCode/code/tty/error absent), NOT captured native JSON.
      socket.send(JSON.stringify({ type: 'provider-notification' }));
      frame(socket, 1, runScript(script));
      frame(socket, 3, Buffer.from([0]));
      socket.send(JSON.stringify({ type: 'another-notification', 'private-key': 'private-value' }));
      socket.send(JSON.stringify({ type: 'session_info', tty: false }));
      socket.send('control: notification');
    };
    expect(await (await instance()).runCommand("printf 'echo\\000\\001 café🚀'; printf 'err\\002' >&2; exit 7"))
      .toMatchObject({ stdout: 'echo\0\x01 café🚀', stderr: 'err\x02', exitCode: 7 });
  });

  it.each(['text then binary', 'binary then text', 'repeated binary'])(
    'accepts agreeing zero completion confirmations (%s) without replacing the child status',
    async (order) => {
      execFrames = (script, socket) => {
        socket.send(JSON.stringify({ type: 'provider-notification' }));
        frame(socket, 1, runScript(script));
        frame(socket, 2, 'native-stderr\0\x01 café🚀');
        const textExit = () => socket.send(JSON.stringify({ type: 'exit', exit_code: 0 }));
        if (order === 'text then binary') textExit();
        frame(socket, 3, Buffer.from([0]));
        if (order === 'binary then text') textExit();
        if (order === 'repeated binary') {
          frame(socket, 3, Buffer.from([0]));
          frame(socket, 3, Buffer.from([0]));
        }
        socket.send(JSON.stringify({ type: 'provider-notification' }));
      };
      expect(await (await instance()).runCommand("printf 'out\\000\\001 café🚀'; printf 'err\\002' >&2; exit 7"))
        .toMatchObject({
          stdout: 'out\0\x01 café🚀', stderr: 'err\x02native-stderr\0\x01 café🚀', exitCode: 7,
        });
    },
  );

  it('does not treat unknown metadata alone as command output or completion', async () => {
    execFrames = (_script, socket) => {
      socket.send(JSON.stringify({ type: 'provider-notification' }));
      socket.close();
    };
    await expect((await instance()).runCommand('true')).rejects.toMatchObject({
      code: 'SPRITES_COMMAND_PROTOCOL_ERROR', reason: 'missing-completion',
    });
  });

  it.each([
    [Buffer.from([3]), 'missing', undefined],
    [Buffer.from([3, 1]), 'one-byte', 'nonzero-byte'],
    [Buffer.from([3, 0, 97, 98, 99]), 'oversized', undefined],
  ])('reports bounded binary exit shape without exposing bytes (%s)', async (packet, exitPayload, exitRange) => {
    execFrames = (_script, socket) => socket.send(packet as Buffer);
    let caught: unknown;
    try { await (await instance()).runCommand('true'); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(SpritesCommandProtocolError);
    expect((caught as SpritesCommandProtocolError).diagnostic).toEqual({
      phase: 'binary-frame', afterExit: false, channel: 'exit', exitPayload,
      ...(exitRange ? { exitRange } : {}),
    });
    expect(String(caught)).not.toContain('abc');
  });

  it('rejects a missing transport exit even with a complete valid shell footer', async () => {
    execFrames = (script, socket) => {
      frame(socket, 1, runScript(script));
      socket.close();
    };
    await expect((await instance()).runCommand('true')).rejects.toBeInstanceOf(SpritesCommandProtocolError);
  });

  it('bounds close-handshake cleanup when a peer stops reading after a valid exit', async () => {
    execFrames = (script, socket) => {
      frame(socket, 1, runScript(script));
      frame(socket, 3, Buffer.from([0]));
      // Public ws pause(): this local peer deliberately never reads/replies to
      // the client's close frame. Remote execution itself is already complete.
      socket.pause();
    };
    expect(await (await instance()).runCommand('printf done')).toMatchObject({
      stdout: 'done', stderr: '', exitCode: 0,
    });
  });

  it.each([
    ['empty exit', [Buffer.from([3])]],
    ['oversized exit', [Buffer.from([3, 0, 0])]],
    ['nonzero wrapper exit', [Buffer.from([3, 1])]],
    ['contradictory exit', [Buffer.from([3, 0]), Buffer.from([3, 7])]],
    ['contradictory text confirmation', [Buffer.from([3, 0]), '{"type":"exit","exit_code":7}']],
    ['data after exit', [Buffer.from([3, 0]), Buffer.from([1, 65])]],
    ['missing text exit code', ['{"type":"exit"}']],
    ['out-of-range text exit', ['{"type":"exit","exit_code":256}']],
    ['fractional text exit', ['{"type":"exit","exit_code":0.5}']],
    ['string text exit', ['{"type":"exit","exit_code":"0"}']],
    ['empty binary message', [Buffer.alloc(0)]],
    ['unknown binary channel', [Buffer.from([99, 0])]],
    ['malformed text', ['not-json-secret']],
    ['absent text type', ['{"secret":"do-not-leak"}']],
    ['non-string text type', ['{"type":42,"secret":"do-not-leak"}']],
    ['array text', ['["do-not-leak"]']],
    ['server error', ['{"type":"error","error":"do-not-leak"}']],
    ['unexpected TTY', ['{"type":"session_info","tty":true}']],
  ])('rejects %s without exposing server data', async (_name, messages) => {
    execFrames = (script, socket) => {
      frame(socket, 1, runScript(script));
      for (const message of messages) socket.send(message);
    };
    let caught: unknown;
    try { await (await instance()).runCommand('true'); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(SpritesCommandProtocolError);
    expect(String(caught)).not.toMatch(/secret|do-not-leak/);
  });

  it('sanitizes constructor/transport failures instead of echoing URL credentials', async () => {
    const sandbox = await sprites({
      apiKey: 'mock-only',
      baseUrl: 'http://secret-user:secret-password@127.0.0.1:0/v1',
    }).instances.create();
    expect(await sandbox.runCommand('echo secret-command')).toMatchObject({
      stdout: '', stderr: 'Sprites command transport failed.', exitCode: 127,
    });
  });

  it.each([
    ['trailing comment', "printf 'out\\n'; printf 'err\\n' >&2 # trailing comment", 'out\n', 'err\n', 0],
    ['heredoc', "cat <<'PAYLOAD'\nquoted \"$HOME\" `literal`\nPAYLOAD", 'quoted "$HOME" `literal`\n', '', 0],
    ['top-level exit', "printf 'out\\n'; printf 'err\\n' >&2; exit 3", 'out\n', 'err\n', 3],
    ['trailing ampersand', 'true &', '', '', 0],
    ['exact output bytes', "printf 'out\\n\\n'; printf 'err\\n\\n' >&2", 'out\n\n', 'err\n\n', 0],
    ['control bytes', "printf 'out\\001\\r\\n'; printf 'err\\002\\r\\n' >&2", 'out\x01\r\n', 'err\x02\r\n', 0],
    ['quoted newlines', "printf '%s' 'line one\nline two'; printf 'err' >&2", 'line one\nline two', 'err', 0],
  ])('%s is safely framed', async (_name, command, stdout, stderr, exitCode) => {
    const result = await (await instance()).runCommand(command as string);
    expect(result).toMatchObject({ stdout, stderr, exitCode });
  });

  it.each([
    ['cat', 'cat', 0],
    ['read', 'read line', 1],
    ['stdin-reading interpreter', `"${process.execPath}" -e 'process.stdin.pipe(process.stdout)'`, 0],
  ])('%s sees EOF, not protocol source, and the exact stderr file is removed', async (_name, command, exitCode) => {
    let result: CommandResult | undefined;
    let caught: unknown;
    try { result = await (await instance()).runCommand(command as string); } catch (error) { caught = error; }
    const stderrFile = stderrFiles[stderrFiles.length - 1];
    expect(stderrFile).toBeTruthy();
    expect(existsSync(stderrFile)).toBe(false);
    expect(caught).toBeUndefined();
    expect(result).toMatchObject({ stdout: '', stderr: '', exitCode });
    expect(result?.stdout).not.toContain('__sp_ec');
    expect(result?.stdout).not.toContain('computesdk-stderr');
  });

  it('quotes cwd and exports literal env for the entire command list', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sprites-contract-'));
    roots.push(root);
    const cwd = join(root, 'space " $literal\npath');
    mkdirSync(cwd);
    const value = 'a "quote" $HOME `literal` \\ slash\nsecond line';
    const result = await (await instance()).runCommand(
      'printf \'%s\\n\' "$PAYLOAD"; printf \'%s\\n\' "$PAYLOAD"; pwd',
      { cwd, env: { PAYLOAD: value } },
    );
    expect(result).toMatchObject({ stdout: `${value}\n${value}\n${cwd}\n`, stderr: '', exitCode: 0 });
  });

  it.each(['missing', 'malformed', 'out-of-range', 'fractional', 'numeric-prefix', 'missing-stderr'])(
    'rejects %s completion without inventing a child exit status or leaking output',
    async (kind) => {
      execBody = (script) => {
        const exit = script.match(/__COMPUTESDK_EXIT_[A-Za-z0-9_]+__/)?.[0];
        const stderr = script.match(/__COMPUTESDK_STDERR_[A-Za-z0-9_]+__/)?.[0];
        expect(exit).toBeTruthy();
        expect(stderr).toBeTruthy();
        if (kind === 'missing') return 'secret-output-without-completion';
        if (kind === 'missing-stderr') return `secret-output${exit}0\n`;
        const statuses: Record<string, string> = {
          malformed: 'no-status', 'out-of-range': '999', fractional: '3.5', 'numeric-prefix': '0trailing',
        };
        const status = statuses[kind];
        return `secret-output${exit}${status}\n${stderr}\n`;
      };
      let caught: unknown;
      try { await (await instance()).runCommand('true'); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(SpritesCommandProtocolError);
      expect(caught).toMatchObject({ code: 'SPRITES_COMMAND_PROTOCOL_ERROR', provider: 'sprites' });
      expect(String(caught)).not.toContain('secret-output');
      expect(JSON.stringify(caught)).not.toContain('secret-output');
    },
  );
});
