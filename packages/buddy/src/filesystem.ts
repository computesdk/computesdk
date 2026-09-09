/**
 * Filesystem operations.
 *
 * These go through the SDK's `FileSystem`, which talks to Buddy's `content/`
 * endpoints — one round trip per operation and binary-safe, unlike shelling out
 * to `cat`/`tee`.
 *
 * Every call goes through the boot gate in `boot.ts`, because unlike commands
 * these endpoints do not queue against a sandbox that is still starting.
 */

import type { FileEntry } from '@computesdk/provider';

import { whenBooted } from './boot.js';
import {
  isNotFound,
  normalizeSandboxPath,
  toContentPath,
  type BuddySandboxHandle,
} from './utils.js';

export async function readFile(sandbox: BuddySandboxHandle, path: string): Promise<string> {
  const target = normalizeSandboxPath(path);
  const buffer = await whenBooted(sandbox, () => sandbox.fs.downloadFile(target));
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
      await sandbox.fs.createFolder(parent).catch(() => {});
    }
    await sandbox.fs.uploadFile(Buffer.from(content, 'utf-8'), target);
  });
}

export async function mkdir(sandbox: BuddySandboxHandle, path: string): Promise<void> {
  const target = normalizeSandboxPath(path);
  await whenBooted(sandbox, () => sandbox.fs.createFolder(target));
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
