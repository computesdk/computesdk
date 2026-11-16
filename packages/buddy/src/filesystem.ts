/**
 * Filesystem operations.
 *
 * These go through the SDK's `FileSystem`, which talks to Buddy's `content/`
 * endpoints — binary-safe, unlike shelling out to `cat`/`tee`. Reads first
 * resolve links because Buddy downloads a link's target path, not its bytes.
 *
 * Every call goes through the boot gate in `boot.ts`, because unlike commands
 * these endpoints do not queue against a sandbox that is still starting.
 */

import type { FileEntry } from '@computesdk/provider';
import { escapeShellArg } from '@computesdk/provider';

import { whenBooted } from './boot.js';
import { runCommand } from './commands.js';
import {
  isNotFound,
  normalizeSandboxPath,
  statusOf,
  toContentPath,
  type BuddySandboxHandle,
} from './utils.js';

export async function readFile(sandbox: BuddySandboxHandle, path: string): Promise<string> {
  const target = normalizeSandboxPath(path);
  const buffer = await whenBooted(sandbox, async () => {
    const resolved = await runCommand(sandbox, `readlink -e -z -- "${escapeShellArg(target)}"`);
    if (resolved.exitCode !== 0) {
      throw new Error(`Failed to resolve file ${target}: ${resolved.stderr || 'path is missing or inaccessible'}`);
    }
    const output = resolved.stdout;
    if (!output.startsWith('/') || !output.endsWith('\0') || output.indexOf('\0') !== output.length - 1) {
      throw new Error(`Buddy returned an invalid resolved path for ${target}.`);
    }
    return sandbox.fs.downloadFile(normalizeSandboxPath(output.slice(0, -1)));
  });
  return buffer.toString('utf-8');
}

export async function writeFile(
  sandbox: BuddySandboxHandle,
  path: string,
  content: string,
): Promise<void> {
  const target = normalizeSandboxPath(path);
  const parent = target.slice(0, target.lastIndexOf('/'));

  await whenBooted(sandbox, async () => {
    // Buddy will not create missing parents for an upload, and mirroring
    // `fs.writeFile` here is what callers expect.
    if (parent) {
      await createFolder(sandbox, parent);
    }
    await sandbox.fs.uploadFile(Buffer.from(content, 'utf-8'), target);
  });
}

export async function mkdir(sandbox: BuddySandboxHandle, path: string): Promise<void> {
  const target = normalizeSandboxPath(path);
  await whenBooted(sandbox, () => createFolder(sandbox, target));
}

async function createFolder(sandbox: BuddySandboxHandle, target: string): Promise<void> {
  try {
    await sandbox.fs.createFolder(target);
  } catch (error) {
    if (statusOf(error) !== 409) throw error;
    const separator = target.lastIndexOf('/');
    const entries = await sandbox.fs.listFiles(target.slice(0, separator) || '/');
    if (!entries.some(entry => entry.name === target.slice(separator + 1) && entry.type === 'DIR')) {
      throw error;
    }
  }
}

export async function readdir(sandbox: BuddySandboxHandle, path: string): Promise<FileEntry[]> {
  const target = normalizeSandboxPath(path);
  const entries = await whenBooted(sandbox, () => sandbox.fs.listFiles(target));

  return entries.map(entry => ({
    name: entry.name ?? '',
    type: entry.type === 'DIR' ? 'directory' as const : 'file' as const,
    // The API reports sizes as bigint; ComputeSDK wants a number.
    ...(entry.size == null ? {} : { size: Number(entry.size) }),
  }));
}

export async function exists(sandbox: BuddySandboxHandle, path: string): Promise<boolean> {
  const target = toContentPath(path);
  try {
    await whenBooted(sandbox, () =>
      sandbox.client.getSandboxContent({ path: { sandbox_id: sandbox.sandboxId, path: target } }));
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

export async function remove(sandbox: BuddySandboxHandle, path: string): Promise<void> {
  const target = normalizeSandboxPath(path);
  try {
    await whenBooted(sandbox, () => sandbox.fs.deleteFile(target));
  } catch (error) {
    // Removing something that is already gone is not an error for callers.
    if (!isNotFound(error)) throw error;
  }
}
