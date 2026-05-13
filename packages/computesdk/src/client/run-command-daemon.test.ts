import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Sandbox } from './index';

const daemonSeedScriptCommand = vi.fn();
const parseSeedInvocationOutput = vi.fn();

vi.mock('daemond', () => ({
  daemonSeedScriptCommand,
  parseSeedInvocationOutput,
}));

describe('Sandbox.runCommand with daemon mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createSandboxWithRunCommandMock(runCommandResult: {
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
  }) {
    const sandbox = new Sandbox({
      sandboxId: 'sbx_123',
      provider: 'test',
      sandboxUrl: 'https://sandbox-123.sandbox.computesdk.com',
      token: 'token_123',
    });

    const runCommandMock = vi.fn().mockResolvedValue(runCommandResult);
    (sandbox as any).run.command = runCommandMock;
    return { sandbox, runCommandMock };
  }

  it('routes command through daemond and returns parsed command result', async () => {
    const { sandbox, runCommandMock } = createSandboxWithRunCommandMock({
      stdout: 'raw stdout with json line',
      stderr: '',
      exitCode: 0,
      durationMs: 42,
    });

    daemonSeedScriptCommand.mockReturnValue('node -e "seed" "pwd"');
    parseSeedInvocationOutput.mockReturnValue({
      token: 'tok',
      requestId: 'req_1',
      daemon: { reused: true, pid: 1234, sseUrl: 'http://127.0.0.1/events?token=tok' },
      command: {
        exitCode: 0,
        signal: null,
        stdout: '/workspace\n',
        stderr: '',
        combined: '/workspace\n',
      },
    });

    const result = await sandbox.runCommand('pwd', { daemon: true, cwd: '/workspace' });

    expect(daemonSeedScriptCommand).toHaveBeenCalledWith(undefined, {
      command: 'pwd',
      cwd: '/workspace',
      env: undefined,
      timeoutMs: undefined,
    });
    expect(runCommandMock).toHaveBeenCalledWith('node -e "seed" "pwd"');
    expect(parseSeedInvocationOutput).toHaveBeenCalledWith('raw stdout with json line');
    expect(result).toEqual({
      stdout: '/workspace\n',
      stderr: '',
      exitCode: 0,
      durationMs: 42,
    });
  });

  it('passes daemon config object and timeout to seed payload', async () => {
    const { sandbox } = createSandboxWithRunCommandMock({
      stdout: 'raw',
      stderr: '',
      exitCode: 0,
      durationMs: 7,
    });

    daemonSeedScriptCommand.mockReturnValue('node -e "seed" "npm test"');
    parseSeedInvocationOutput.mockReturnValue({
      token: 'tok',
      requestId: 'req_2',
      daemon: { reused: false, pid: 999, sseUrl: 'http://127.0.0.1/events?token=tok' },
      command: {
        exitCode: 12,
        signal: null,
        stdout: '',
        stderr: 'failed\n',
        combined: 'failed\n',
      },
    });

    await sandbox.runCommand('npm test', {
      daemon: { name: 'seed-control', socket: '/tmp/seed.sock' },
      timeout: 12,
      env: { NODE_ENV: 'test' },
    });

    expect(daemonSeedScriptCommand).toHaveBeenCalledWith(
      { name: 'seed-control', socket: '/tmp/seed.sock' },
      {
        command: 'npm test',
        cwd: undefined,
        env: { NODE_ENV: 'test' },
        timeoutMs: 12000,
      }
    );
  });

  it('rejects daemon mode with background execution', async () => {
    const { sandbox } = createSandboxWithRunCommandMock({
      stdout: '',
      stderr: '',
      exitCode: 0,
      durationMs: 0,
    });

    await expect(
      sandbox.runCommand('npm install', { daemon: true, background: true })
    ).rejects.toThrow('runCommand({ daemon: true }) does not support background mode.');
  });

  it('rejects daemon mode with streaming callbacks', async () => {
    const { sandbox } = createSandboxWithRunCommandMock({
      stdout: '',
      stderr: '',
      exitCode: 0,
      durationMs: 0,
    });

    await expect(
      sandbox.runCommand('npm install', {
        daemon: true,
        onStdout: () => {},
      })
    ).rejects.toThrow('runCommand({ daemon: true }) does not support WebSocket streaming callbacks.');
  });
});
