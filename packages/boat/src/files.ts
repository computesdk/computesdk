import { posix } from 'node:path';
import type { BoatSandbox } from './index';
import { checked, quote } from './commands';

function signedPath(path: string): boolean {
  const absolute = posix.resolve('/home/user', path);
  return absolute.startsWith('/home/user/') || absolute.startsWith('/tmp/');
}

/** Binary download. Signed URLs support files under /home/user and /tmp. */
export async function readBoatFile(sandbox: BoatSandbox, path: string): Promise<Uint8Array> {
  if (!signedPath(path)) {
    return new Uint8Array(Buffer.from(await checked(sandbox, `base64 < ${quote(path)}`), 'base64'));
  }
  const signed = await sandbox.api.createDownloadUrl({ sandboxId: sandbox.id, fileUrlRequest: { path } });
  const response = await fetch(signed.url);
  // Do not include the signed URL in errors or send the account bearer token to it.
  if (!response.ok) throw new Error(`Boat file download failed (HTTP ${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Binary or UTF-8 upload, without embedding the file in a command argument. */
export async function writeBoatFile(sandbox: BoatSandbox, path: string, content: string | Uint8Array): Promise<void> {
  if (!signedPath(path)) {
    // The signed API confines paths. Preserve shell access elsewhere with bounded command payloads.
    const encoded = Buffer.from(content).toString('base64');
    await checked(sandbox, `: > ${quote(path)}`);
    for (let offset = 0; offset < encoded.length; offset += 48 * 1024) {
      await checked(sandbox, `printf %s ${quote(encoded.slice(offset, offset + 48 * 1024))} | base64 -d >> ${quote(path)}`);
    }
    return;
  }
  const signed = await sandbox.api.createUploadUrl({ sandboxId: sandbox.id, fileUrlRequest: { path } });
  const response = await fetch(signed.url, { method: signed.method, body: Buffer.from(content) });
  if (!response.ok) throw new Error(`Boat file upload failed (HTTP ${response.status}).`);
  await response.body?.cancel();
}
