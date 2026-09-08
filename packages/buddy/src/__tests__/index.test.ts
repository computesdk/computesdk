import { describe, expect, it, vi } from 'vitest';
import { runProviderTestSuite } from '@computesdk/test-utils';

import { buddy, ensureTimeout, toSeconds } from '../index';
import { TIMEOUT_EXIT_CODE, buildShellCommand, killCommand, runCommand, waitForExitCode } from '../commands';
import {
  getClient,
  isInstanceNotRunning,
  isNotFound,
  isUnroutableId,
  mapStatus,
  normalizePort,
  normalizeSandboxPath,
  resolveConfig,
  resolveResources,
  toContentPath,
  toEndpointUpdate,
  toIdentifier,
} from '../utils';

runProviderTestSuite({
  name: 'buddy',
  provider: buddy({}),
  supportsFilesystem: true,
  skipIntegration: !process.env.BUDDY_TOKEN
    || !process.env.BUDDY_WORKSPACE
    || !process.env.BUDDY_PROJECT,
});

describe('config resolution', () => {
  it('names the missing credential in the error', () => {
    // The env-var fallbacks have to be out of the way for this to be about the
    // config object alone.
    const saved = {
      BUDDY_TOKEN: process.env.BUDDY_TOKEN,
      BUDDY_WORKSPACE: process.env.BUDDY_WORKSPACE,
      BUDDY_PROJECT: process.env.BUDDY_PROJECT,
    };
    delete process.env.BUDDY_TOKEN;
    delete process.env.BUDDY_WORKSPACE;
    delete process.env.BUDDY_PROJECT;

    try {
      expect(() => resolveConfig({ workspace: 'w', project: 'p' })).toThrow(/token/i);
      expect(() => resolveConfig({ token: 't', project: 'p' })).toThrow(/workspace/i);
      expect(() => resolveConfig({ token: 't', workspace: 'w' })).toThrow(/project/i);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('defaults to the US installation and applies the region host', () => {
    const base = { token: 't', workspace: 'w', project: 'p' };
    expect(resolveConfig({ ...base }).apiUrl).toBe('https://api.buddy.works');
    expect(resolveConfig({ ...base, region: 'EU' }).apiUrl).toBe('https://api.eu.buddy.works');
  });

  it('lets apiUrl override the region and strips trailing slashes', () => {
    const config = resolveConfig({
      token: 't', workspace: 'w', project: 'p', region: 'EU', apiUrl: 'https://buddy.internal/',
    });
    expect(config.apiUrl).toBe('https://buddy.internal');
    // The region still decides where tunnels terminate.
    expect(config.region).toBe('EU');
  });

  it('re-reads the environment when called without a config', () => {
    const saved = {
      BUDDY_TOKEN: process.env.BUDDY_TOKEN,
      BUDDY_WORKSPACE: process.env.BUDDY_WORKSPACE,
      BUDDY_PROJECT: process.env.BUDDY_PROJECT,
    };
    try {
      Object.assign(process.env, { BUDDY_TOKEN: 'first', BUDDY_WORKSPACE: 'w', BUDDY_PROJECT: 'p' });
      const first = resolveConfig();
      expect(first.token).toBe('first');
      expect(resolveConfig()).toBe(first);
      process.env.BUDDY_TOKEN = 'rotated';
      expect(resolveConfig().token).toBe('rotated');
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('reuses the resolved config for the same config object', () => {
    const raw = { token: 't', workspace: 'w', project: 'p' };
    expect(resolveConfig(raw)).toBe(resolveConfig(raw));
  });
});

describe('resource presets', () => {
  const cases: Array<[Record<string, unknown>, string | undefined]> = [
    [{}, undefined],
    [{ cpu: 2 }, '2x4'],
    [{ memory: 8192 }, '4x8'],
    // The larger of the two requests wins, since Buddy ties RAM to vCPU.
    [{ cpu: 1, memory: 8192 }, '4x8'],
    [{ cpu: 40 }, '12x24'],
    [{ resources: '3x6' }, '3x6'],
  ];

  it.each(cases)('maps %j to %s', (options, expected) => {
    expect(resolveResources(options)).toBe(expected);
  });

  it('falls back to the provider default', () => {
    expect(resolveResources({}, '2x4')).toBe('2x4');
  });
});

describe('paths', () => {
  it('resolves relative paths against the sandbox home', () => {
    expect(normalizeSandboxPath('app/index.js')).toBe('/buddy/app/index.js');
    expect(normalizeSandboxPath('/etc//hosts')).toBe('/etc/hosts');
  });

  it('rejects the root', () => {
    expect(() => normalizeSandboxPath('/')).toThrow();
  });

  it('drops the leading slash for content endpoints', () => {
    expect(toContentPath('/buddy/a.txt')).toBe('buddy/a.txt');
  });
});

describe('command building', () => {
  it('passes a plain command through', () => {
    expect(buildShellCommand('ls -la')).toBe('ls -la');
  });

  it('prepends cwd and env', () => {
    expect(buildShellCommand('node app.js', { cwd: '/buddy/app', env: { PORT: '3000' } }))
      .toBe('cd "/buddy/app" && export PORT="3000" && node app.js');
  });

  it('neutralises quotes in env values', () => {
    expect(buildShellCommand('echo hi', { env: { A: 'a"b' } })).not.toBe('export A="a"b" && echo hi');
  });

  it('rejects env names that are not shell identifiers', () => {
    for (const name of ['A; rm -rf /', 'FOO=bar', '$(id)', '1ABC', 'a-b', '']) {
      expect(() => buildShellCommand('echo hi', { env: { [name]: 'x' } }))
        .toThrow(/Invalid environment variable name/);
    }
    expect(buildShellCommand('echo hi', { env: { _OK_1: 'x', lower: 'y' } }))
      .toBe('export _OK_1="x" lower="y" && echo hi');
  });

  it('rejects the outdated argument-array call shape', async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runCommand({} as any, 'echo', ['hello-args'] as any),
    ).rejects.toThrow(/not an argument array/);
  });
});

/** Fakes the SDK client surface `runCommand` touches. */
function fakeCommandClient(
  logs: Array<{ type: 'STDOUT' | 'STDERR'; data: string }>,
  details: Array<{ exit_code?: number; status?: string }>,
) {
  const pending = [...details];
  const client = {
    executeCommand: vi.fn(async () => ({ id: 'cmd-1' })),
    getCommandLogs: vi.fn(),
    getCommandDetails: vi.fn(async () => pending.length > 1 ? pending.shift()! : pending[0]),
    terminateCommand: vi.fn(async () => {}),
  };
  const sandbox = { sandboxId: 'sb-1', client } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  return { client, sandbox, logs };
}

describe('command execution', () => {
  it('streams over its own API instead of the daemon fallback', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((buddy({}).sandbox as any).methods.streamCommand).toBe(runCommand);
  });

  it('terminates every log record with a newline', async () => {
    const { sandbox, logs } = fakeCommandClient(
      [{ type: 'STDOUT', data: 'one' }, { type: 'STDOUT', data: 'two' }, { type: 'STDERR', data: 'warn' }],
      [{ exit_code: 0, status: 'SUCCESSFUL' }],
    );
    const { Command } = await import('@buddy-works/sandbox-sdk');
    vi.spyOn(Command.prototype, 'logs').mockImplementation(async function* () { yield* logs; });

    const chunks: string[] = [];
    const result = await runCommand(sandbox, 'printf "one\\ntwo"', { onStdout: chunk => chunks.push(chunk) });

    expect(result.stdout).toBe('one\ntwo\n');
    expect(result.stderr).toBe('warn\n');
    expect(chunks.join('')).toBe(result.stdout);
    expect(result.exitCode).toBe(0);
  });

  it('returns the timeout exit code without waiting for the stream to close', async () => {
    const { sandbox, client } = fakeCommandClient([], [{ status: 'INPROGRESS' }]);
    const { Command } = await import('@buddy-works/sandbox-sdk');
    // The stream never ends: the kill is what would normally close it.
    vi.spyOn(Command.prototype, 'logs').mockImplementation(async function* () { await new Promise(() => {}); });

    const started = Date.now();
    const result = await runCommand(sandbox, 'sleep 60', { timeout: 20 });

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(client.terminateCommand).toHaveBeenCalledTimes(1);
    expect(client.getCommandDetails).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(TIMEOUT_EXIT_CODE);
  });

  it('still times out when the kill itself fails', async () => {
    const { sandbox, client } = fakeCommandClient([], [{ status: 'INPROGRESS' }]);
    const { Command } = await import('@buddy-works/sandbox-sdk');
    client.terminateCommand.mockImplementation(async () => { throw new Error('gateway timeout'); });
    vi.spyOn(Command.prototype, 'logs').mockImplementation(async function* () { await new Promise(() => {}); });

    const result = await runCommand(sandbox, 'sleep 60', { timeout: 20 });
    expect(result.exitCode).toBe(TIMEOUT_EXIT_CODE);
  });

  it('counts a slow submission against the timeout', async () => {
    const { sandbox, client } = fakeCommandClient([], [{ status: 'INPROGRESS' }]);
    const { Command } = await import('@buddy-works/sandbox-sdk');
    // Buddy holds the submission (e.g. while the sandbox boots) past the deadline.
    client.executeCommand.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 60));
      return { id: 'cmd-1' };
    });
    vi.spyOn(Command.prototype, 'logs').mockImplementation(async function* () { await new Promise(() => {}); });

    const started = Date.now();
    const result = await runCommand(sandbox, 'sleep 60', { timeout: 30 });

    expect(result.exitCode).toBe(TIMEOUT_EXIT_CODE);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('returns the timeout result while Buddy still holds the submission', async () => {
    const { sandbox, client } = fakeCommandClient([], [{ status: 'INPROGRESS' }]);
    let accept!: (value: { id: string }) => void;
    client.executeCommand.mockImplementation(() => new Promise<{ id: string }>(resolve => { accept = resolve; }));

    const started = Date.now();
    const result = await runCommand(sandbox, 'sleep 60', { timeout: 20 });
    expect(result.exitCode).toBe(TIMEOUT_EXIT_CODE);
    expect(Date.now() - started).toBeLessThan(500);

    // Once Buddy finally reports the command, it is killed.
    accept({ id: 'cmd-late' });
    await vi.waitFor(() => expect(client.terminateCommand).toHaveBeenCalledTimes(1));
  });

  it('stops forwarding output after the timeout result was returned', async () => {
    const { sandbox } = fakeCommandClient([], [{ status: 'INPROGRESS' }]);
    const { Command } = await import('@buddy-works/sandbox-sdk');
    let release!: () => void;
    vi.spyOn(Command.prototype, 'logs').mockImplementation(async function* () {
      await new Promise<void>(resolve => { release = resolve; });
      yield { type: 'STDOUT', data: 'late' } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      yield { type: 'STDOUT', data: 'later' } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    });

    const onStdout = vi.fn();
    const result = await runCommand(sandbox, 'sleep 60', { timeout: 20, onStdout });
    expect(result.exitCode).toBe(TIMEOUT_EXIT_CODE);

    release();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(onStdout).not.toHaveBeenCalled();
  });

  it('keeps the output collected before the deadline in the timeout result', async () => {
    const { sandbox } = fakeCommandClient([], [{ status: 'INPROGRESS' }]);
    const { Command } = await import('@buddy-works/sandbox-sdk');
    vi.spyOn(Command.prototype, 'logs').mockImplementation(async function* () {
      yield { type: 'STDOUT', data: 'step 1' } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      yield { type: 'STDERR', data: 'warn' } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      await new Promise(() => {}); // the command never finishes
    });

    const result = await runCommand(sandbox, 'sleep 60', { timeout: 30 });
    expect(result.exitCode).toBe(TIMEOUT_EXIT_CODE);
    expect(result.stdout).toBe('step 1\n');
    expect(result.stderr).toBe('warn\n');
  });

  it('retries a failed kill before giving up', async () => {
    const kill = vi.fn()
      .mockRejectedValueOnce(new Error('gateway timeout'))
      .mockResolvedValue(undefined);
    await expect(killCommand({ kill })).resolves.toBe(true);
    expect(kill).toHaveBeenCalledTimes(2);

    const hopeless = vi.fn().mockRejectedValue(new Error('gateway timeout'));
    await expect(killCommand({ kill: hopeless })).resolves.toBe(false);
    expect(hopeless).toHaveBeenCalledTimes(3);
  });

  it('kills the command when its log stream breaks mid-run', async () => {
    const { sandbox, client } = fakeCommandClient([], [{ status: 'INPROGRESS' }]);
    const { Command } = await import('@buddy-works/sandbox-sdk');
    vi.spyOn(Command.prototype, 'logs').mockImplementation(async function* () { throw new Error('stream reset'); });

    await expect(runCommand(sandbox, 'sleep 60', { timeout: 5_000 })).rejects.toThrow(/stream reset/);
    expect(client.terminateCommand).toHaveBeenCalledTimes(1);
    expect(client.getCommandDetails).not.toHaveBeenCalled();
  });

  it('waits for the exit code instead of assuming success while in progress', async () => {
    const { sandbox, client } = fakeCommandClient([], [
      { status: 'INPROGRESS' },
      { status: 'INPROGRESS' },
      { exit_code: 3, status: 'FAILED' },
    ]);
    await expect(waitForExitCode(sandbox, 'cmd-1', 5_000)).resolves.toBe(3);
    expect(client.getCommandDetails).toHaveBeenCalledTimes(3);
  });

  it('gives up on a command that never reports a result', async () => {
    const { sandbox } = fakeCommandClient([], [{ status: 'INPROGRESS' }]);
    await expect(waitForExitCode(sandbox, 'cmd-1', 0)).rejects.toThrow(/no exit code/);
  });
});

describe('snapshots as templates', () => {
  it('honours the limit on template.list', async () => {
    const { BuddyApiClient } = await import('@buddy-works/sandbox-sdk');
    vi.spyOn(BuddyApiClient.prototype, 'getProjectSnapshots').mockResolvedValue({
      snapshots: [{ id: 's1', name: 'a' }, { id: 's2', name: 'b' }, { id: 's3', name: 'c' }],
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    const provider = buddy({ token: 't', workspace: 'w', project: 'p' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const templates = await (provider.template as any).list({ limit: 2 });
    expect(templates.map((t: { id: string }) => t.id)).toEqual(['s1', 's2']);
  });
});

describe('sandbox timeout', () => {
  const config = resolveConfig({ token: 't', workspace: 'w', project: 'p' });
  const handle = (timeoutMs: number) => ({
    sandboxId: 'sb-1', timeout: timeoutMs, config, client: getClient(config),
  }) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  it('leaves a sandbox alone when Buddy already applied the requested timeout', async () => {
    const { BuddyApiClient } = await import('@buddy-works/sandbox-sdk');
    const update = vi.spyOn(BuddyApiClient.prototype, 'updateSandbox');
    await ensureTimeout(handle(300_000), 300_000);
    expect(update).not.toHaveBeenCalled();
  });

  it('never shortens a lifetime when converting to whole seconds', () => {
    expect(toSeconds(1_499)).toBe(2);
    expect(toSeconds(300_000)).toBe(300);
    expect(toSeconds(1)).toBe(1);
  });

  it('patches the timeout a snapshot restore did not accept', async () => {
    const { BuddyApiClient } = await import('@buddy-works/sandbox-sdk');
    vi.spyOn(BuddyApiClient.prototype, 'getSandboxById')
      .mockResolvedValue({ id: 'sb-1', status: 'RUNNING', setup_status: 'SUCCESS' } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    const update = vi.spyOn(BuddyApiClient.prototype, 'updateSandbox')
      .mockImplementation(async ({ body }: any) => ({ timeout: body.timeout }) as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    const sandbox = handle(3_600_000);
    await ensureTimeout(sandbox, 300_000);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ body: { timeout: 300 } }));
    expect(sandbox.timeout).toBe(300_000);
  });
});

describe('sandbox creation', () => {
  it('deletes the sandbox when post-create setup fails, keeping the original error', async () => {
    const { BuddyApiClient } = await import('@buddy-works/sandbox-sdk');
    vi.spyOn(BuddyApiClient.prototype, 'addSandbox')
      .mockResolvedValue({ id: 'sb-new', identifier: 'sb-new', timeout: 3600 } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.spyOn(BuddyApiClient.prototype, 'getSandboxById')
      .mockResolvedValue({ id: 'sb-new', status: 'RUNNING', setup_status: 'SUCCESS' } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.spyOn(BuddyApiClient.prototype, 'updateSandbox').mockRejectedValue(new Error('quota exceeded'));
    // The cleanup retries transient failures the same way destroy does.
    const remove = vi.spyOn(BuddyApiClient.prototype, 'deleteSandboxById')
      .mockRejectedValueOnce(Object.assign(new Error('HTTP 503'), { status: 503 }))
      .mockResolvedValue(undefined as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    const provider = buddy({ token: 't', workspace: 'w', project: 'p' });
    await expect(provider.sandbox.create({ snapshotId: 'snap', timeout: 300_000 }))
      .rejects.toThrow(/quota exceeded/);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledWith({ path: { id: 'sb-new' } });
  });
});

describe('status mapping', () => {
  it('treats a starting sandbox as running, because commands queue', () => {
    expect(mapStatus('STARTING')).toBe('running');
    expect(mapStatus('RESTORING')).toBe('running');
    expect(mapStatus('RUNNING')).toBe('running');
    expect(mapStatus('STOPPED')).toBe('stopped');
    expect(mapStatus('FAILED')).toBe('error');
    expect(mapStatus(undefined)).toBe('stopped');
  });
});

describe('error predicates', () => {
  it('recognises a missing entity from either error shape', () => {
    expect(isNotFound(Object.assign(new Error('HTTP 404: nope'), { status: 404 }))).toBe(true);
    expect(isNotFound(Object.assign(new Error('nope'), { statusCode: 404 }))).toBe(true);
    // The content endpoints report a missing path as 400.
    expect(isNotFound(Object.assign(new Error('Path not find in browser'), { status: 400 }))).toBe(true);
    expect(isNotFound(Object.assign(new Error('boom'), { status: 500 }))).toBe(false);
  });

  it('recognises an id Buddy cannot even route', () => {
    const error = Object.assign(new Error('HTTP 400: Invalid url: /workspaces/w/sandboxes/nope'), { status: 400 });
    expect(isUnroutableId(error)).toBe(true);
    expect(isUnroutableId(Object.assign(new Error('Invalid url'), { status: 404 }))).toBe(false);
  });

  it('recognises the boot race', () => {
    const error = Object.assign(new Error('HTTP 400: Instance is not running'), { status: 400 });
    expect(isInstanceNotRunning(error)).toBe(true);
    expect(isInstanceNotRunning(Object.assign(new Error('other'), { status: 400 }))).toBe(false);
  });
});

describe('ports', () => {
  it('defaults a bare port to an HTTP tunnel in the configured region', () => {
    const config = resolveConfig({ token: 't', workspace: 'w', project: 'p', region: 'EU' });
    expect(normalizePort(3000, config)).toEqual({
      port: 3000, name: 'p3000', type: 'HTTP', region: 'EU',
    });
  });

  it('keeps writable tunnel settings and drops read-only ones when sending endpoints back', () => {
    expect(toEndpointUpdate({
      name: 'web', endpoint: '3000', type: 'HTTP', region: 'EU',
      whitelist: ['10.0.0.0/8'], timeout: 30, http: { auth_type: 'BASIC' }, tls: { tls_ca: 'x' },
      endpoint_url: 'https://web.example', active: true, target_latency: 12,
    })).toEqual({
      name: 'web', endpoint: '3000', type: 'HTTP', region: 'EU',
      whitelist: ['10.0.0.0/8'], timeout: 30, http: { auth_type: 'BASIC' }, tls: { tls_ca: 'x' },
    });
  });
});

describe('identifiers', () => {
  it('follows the identifier rules Buddy enforces', () => {
    expect(toIdentifier('ComputeSDK Test #1')).toBe('computesdk-test-1');
    expect(toIdentifier('!!!')).toBe('computesdk');
  });

  it('never leaves a hyphen at the end after truncating', () => {
    const name = `${'a'.repeat(59)}-tail`;
    const identifier = toIdentifier(name);
    expect(identifier).toBe('a'.repeat(59));
    expect(identifier.length).toBeLessThanOrEqual(60);
  });
});
