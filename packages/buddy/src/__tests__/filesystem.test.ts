import { describe, expect, it, vi } from 'vitest';

import { mkdir, readFile, writeFile } from '../filesystem';
import { runCommand } from '../commands';
import type { BuddySandboxHandle } from '../utils';

vi.mock('../boot', () => ({ whenBooted: (_sandbox: unknown, operation: () => Promise<unknown>) => operation() }));
vi.mock('../commands', () => ({ runCommand: vi.fn() }));

function fakeFilesystem() {
  vi.mocked(runCommand).mockResolvedValue({ stdout: '/buddy/base/file.txt\0', stderr: '', exitCode: 0, durationMs: 0 });
  const fs = {
    createFolder: vi.fn().mockResolvedValue(undefined),
    listFiles: vi.fn().mockResolvedValue([{ name: 'nested', type: 'DIR' }]),
    uploadFile: vi.fn().mockResolvedValue(undefined),
    downloadFile: vi.fn().mockResolvedValue(Buffer.from('content')),
  };
  return { fs, sandbox: { fs } as unknown as BuddySandboxHandle };
}

describe('filesystem directories', () => {
  it('creates a normalized directory without an extra request', async () => {
    const { fs, sandbox } = fakeFilesystem();
    await mkdir(sandbox, 'base/./nested');
    expect(fs.createFolder).toHaveBeenCalledWith('/buddy/base/nested');
    expect(fs.listFiles).not.toHaveBeenCalled();
  });

  it.each(['status', 'statusCode'])('accepts a %s 409 only for an existing directory', async key => {
    const { fs, sandbox } = fakeFilesystem();
    fs.createFolder.mockRejectedValue({ [key]: 409 });
    await mkdir(sandbox, 'base/nested');
    expect(fs.listFiles).toHaveBeenCalledWith('/buddy/base');
  });

  it.each([
    { entries: [{ name: 'nested', type: 'FILE' }] },
    { entries: [] },
    { entries: [{ name: 'other', type: 'DIR' }] },
  ])(
    'preserves conflicts when the target is not a directory: $entries', async ({ entries }) => {
      const { fs, sandbox } = fakeFilesystem();
      const error = { statusCode: 409 };
      fs.createFolder.mockRejectedValue(error);
      fs.listFiles.mockResolvedValue(entries);
      await expect(mkdir(sandbox, 'base/nested')).rejects.toBe(error);
    },
  );

  it.each([400, 401, 403, 404, 500])('does not suppress HTTP %s', async statusCode => {
    const { fs, sandbox } = fakeFilesystem();
    const error = { statusCode };
    fs.createFolder.mockRejectedValue(error);
    await expect(mkdir(sandbox, 'base/nested')).rejects.toBe(error);
    expect(fs.listFiles).not.toHaveBeenCalled();
  });

  it('propagates a directory lookup permission error', async () => {
    const { fs, sandbox } = fakeFilesystem();
    const permission = { statusCode: 403 };
    fs.createFolder.mockRejectedValue({ statusCode: 409 });
    fs.listFiles.mockRejectedValue(permission);
    await expect(mkdir(sandbox, 'base/nested')).rejects.toBe(permission);
  });

  it('checks the root listing for top-level directories', async () => {
    const { fs, sandbox } = fakeFilesystem();
    fs.createFolder.mockRejectedValue({ statusCode: 409 });
    await mkdir(sandbox, '/nested');
    expect(fs.listFiles).toHaveBeenCalledWith('/');
  });

  it('uploads to an existing parent without hiding non-directory conflicts', async () => {
    const { fs, sandbox } = fakeFilesystem();
    const conflict = { statusCode: 409 };
    fs.createFolder.mockRejectedValue(conflict);
    await writeFile(sandbox, 'base/nested/file.txt', 'content');
    expect(fs.uploadFile).toHaveBeenCalledWith(Buffer.from('content'), '/buddy/base/nested/file.txt');
    fs.listFiles.mockResolvedValue([{ name: 'nested', type: 'FILE' }]);
    fs.uploadFile.mockClear();
    await expect(writeFile(sandbox, 'base/nested/file.txt', 'content')).rejects.toBe(conflict);
    expect(fs.uploadFile).not.toHaveBeenCalled();
  });

  it('does not upload after a parent permission failure', async () => {
    const { fs, sandbox } = fakeFilesystem();
    fs.createFolder.mockRejectedValue({ statusCode: 403 });
    await expect(writeFile(sandbox, 'base/nested/file.txt', 'content')).rejects.toEqual({ statusCode: 403 });
    expect(fs.uploadFile).not.toHaveBeenCalled();
  });
});

describe('filesystem reads', () => {
  it('resolves relative and absolute paths consistently', async () => {
    const { fs, sandbox } = fakeFilesystem();
    expect(await readFile(sandbox, './base/file.txt')).toBe('content');
    expect(await readFile(sandbox, '/buddy/base/file.txt')).toBe('content');
    expect(fs.downloadFile.mock.calls).toEqual([['/buddy/base/file.txt'], ['/buddy/base/file.txt']]);
  });

  it('downloads the canonical target rather than the link path', async () => {
    const { fs, sandbox } = fakeFilesystem();
    await readFile(sandbox, 'base/link.txt');
    expect(runCommand).toHaveBeenLastCalledWith(sandbox, 'readlink -e -z -- "/buddy/base/link.txt"');
    expect(fs.downloadFile).toHaveBeenCalledWith('/buddy/base/file.txt');
  });

  it('quotes shell metacharacters and preserves newlines in resolved paths', async () => {
    const { fs, sandbox } = fakeFilesystem();
    vi.mocked(runCommand).mockResolvedValue({ stdout: '/buddy/space and\nnewline\0', stderr: '', exitCode: 0, durationMs: 0 });
    await readFile(sandbox, '/buddy/a "$(touch x)`id`\\.txt');
    expect(runCommand).toHaveBeenLastCalledWith(sandbox, 'readlink -e -z -- "/buddy/a \\"\\$(touch x)\\`id\\`\\\\.txt"');
    expect(fs.downloadFile).toHaveBeenCalledWith('/buddy/space and\nnewline');
  });

  it('rejects missing, dangling, cyclic or inaccessible paths without downloading', async () => {
    const { fs, sandbox } = fakeFilesystem();
    vi.mocked(runCommand).mockResolvedValue({ stdout: '', stderr: 'Permission denied', exitCode: 1, durationMs: 0 });
    await expect(readFile(sandbox, 'link')).rejects.toThrow('Permission denied');
    expect(fs.downloadFile).not.toHaveBeenCalled();
  });

  it.each(['', 'relative\0', '/buddy/file\n', '/buddy/file\0extra\0', '/\0'])(
    'rejects an invalid or root resolution: %j', async stdout => {
      const { fs, sandbox } = fakeFilesystem();
      vi.mocked(runCommand).mockResolvedValue({ stdout, stderr: '', exitCode: 0, durationMs: 0 });
      await expect(readFile(sandbox, 'link')).rejects.toThrow();
      expect(fs.downloadFile).not.toHaveBeenCalled();
    },
  );

  it('does not swallow native download errors', async () => {
    const { fs, sandbox } = fakeFilesystem();
    const error = { statusCode: 403 };
    fs.downloadFile.mockRejectedValue(error);
    await expect(readFile(sandbox, 'base/file.txt')).rejects.toBe(error);
  });
});
