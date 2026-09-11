import { describe, it, expect, vi } from 'vitest';
import { namespace } from '../index';
import type { NamespaceSandbox } from '../index';
import type { CommandResult, RunCommandOptions } from '@computesdk/provider';

function makeSandbox(): NamespaceSandbox {
  return {
    instanceId: 'i-123',
    name: 'test',
    commandServiceEndpoint: 'https://cmd.example',
    token: 'token',
    targetContainerName: 'main-container',
    createdAt: new Date(),
  };
}

type MockRunCommand = (
  sandbox: NamespaceSandbox,
  command: string,
  options?: RunCommandOptions,
) => Promise<CommandResult>;

function captureRunCommand(): {
  calls: string[];
  runCommand: MockRunCommand;
} {
  const calls: string[] = [];
  const runCommand = vi.fn(async (_sandbox: NamespaceSandbox, command: string): Promise<CommandResult> => {
    calls.push(command);
    return { exitCode: 0, stdout: '', stderr: '', durationMs: 0 };
  });
  return { calls, runCommand };
}

describe('namespace filesystem methods', () => {
  it('normalizes dash-leading paths', async () => {
    const sandbox = makeSandbox();
    const { calls, runCommand } = captureRunCommand();
    const fs = namespace({}).sandbox.methods.filesystem!;

    await fs.mkdir(sandbox, '-v', runCommand);
    expect(calls[0]).toBe('mkdir -p "./-v"');

    calls.length = 0;
    await fs.remove(sandbox, '-v', runCommand);
    expect(calls[0]).toBe('rm -rf "./-v"');

    calls.length = 0;
    await fs.exists(sandbox, '-v', runCommand);
    expect(calls[0]).toBe('test -e "./-v"');

    calls.length = 0;
    await fs.readFile(sandbox, '-v', runCommand);
    expect(calls[0]).toBe('cat "./-v"');
  });

  it('writes content in base64 chunks', async () => {
    const sandbox = makeSandbox();
    const { calls, runCommand } = captureRunCommand();
    const fs = namespace({}).sandbox.methods.filesystem!;

    const content = 'x'.repeat(100 * 1024);
    await fs.writeFile(sandbox, '/tmp/bench/file.txt', content, runCommand);

    const encoded = Buffer.from(content, 'utf8').toString('base64');
    // 48,000-character base64 chunks; 100 KiB raw yields three chunks.
    expect(calls.length).toBe(3);

    // First command uses >, subsequent commands append with >>.
    expect(calls[0]).toContain('> "/tmp/bench/file.txt"');
    expect(calls[1]).toContain('>> "/tmp/bench/file.txt"');
    expect(calls[2]).toContain('>> "/tmp/bench/file.txt"');

    // Verify the full encoded content is spread across the three commands.
    const reconstructed = calls
      .map((cmd) => {
        const match = cmd.match(/printf '%s' "(.*?)" \| base64 -d/);
        return match?.[1] ?? '';
      })
      .join('');
    expect(reconstructed).toBe(encoded);
  });

  it('readdir decodes base64 names and classifies directories', async () => {
    const sandbox = makeSandbox();
    const calls: string[] = [];
    const runCommand = vi.fn(async (_sandbox: NamespaceSandbox, command: string): Promise<CommandResult> => {
      calls.push(command);
      const dirName = 'foo';
      const fileName = 'bar';
      const dir64 = Buffer.from(dirName, 'utf8').toString('base64');
      const file64 = Buffer.from(fileName, 'utf8').toString('base64');
      return {
        exitCode: 0,
        stdout: `d\t${dir64}\0f\t${file64}\0`,
        stderr: '',
        durationMs: 0,
      };
    });
    const fs = namespace({}).sandbox.methods.filesystem!;

    const entries = await fs.readdir(sandbox, '/tmp/dir', runCommand);
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('find "/tmp/dir"');
    expect(entries).toEqual([
      { name: 'foo', type: 'directory' },
      { name: 'bar', type: 'file' },
    ]);
  });
});
