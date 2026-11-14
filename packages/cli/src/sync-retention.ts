/** Retain full project captures before applying a selected view to the destination. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import type { ActionsClient } from './actions-client.js';
import type { SnapshotSession, EngineEndpoint } from './snapshot-engine.js';
export interface RetainedSnapshot { id: string; expiresAt: string }
interface Upload { objects: { key: string; url: string }[]; manifestPutUrl: string; manifestJson: string }

/** Self-contained so remote sources upload directly from their private scratch. */
async function publish(input: { store: string; upload: Upload; manifest: unknown }, requireModule: NodeRequire): Promise<void> {
  const fs = requireModule('node:fs') as typeof import('node:fs');
  const path = requireModule('node:path') as typeof import('node:path');
  const crypto = requireModule('node:crypto') as typeof import('node:crypto');
  const checkUrl = (value: string) => {
    const url = new URL(value);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Insecure retained snapshot upload URL.');
  };
  for (const object of input.upload.objects) {
    if (!/^blobs\/[a-f0-9]{64}$/.test(object.key)) throw new Error('Invalid retained snapshot object key.');
    checkUrl(object.url);
    const file = path.join(input.store, object.key);
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    if (hash.digest('hex') !== object.key.slice(6)) throw new Error('Retained snapshot blob digest mismatch.');
    const response = await fetch(object.url, {
      method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(290_000),
      headers: { 'content-length': String(fs.statSync(file).size) },
      // @ts-expect-error Node streams require duplex, which DOM fetch types omit.
      body: fs.createReadStream(file), duplex: 'half',
    });
    if (!response.ok) throw new Error(`Retained snapshot upload failed (${response.status}).`);
    await response.body?.cancel();
  }
  checkUrl(input.upload.manifestPutUrl);
  const response = await fetch(input.upload.manifestPutUrl, {
    method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(290_000),
    headers: { 'content-type': 'application/json' }, body: input.upload.manifestJson,
  });
  if (!response.ok) throw new Error(`Retained snapshot manifest upload failed (${response.status}).`);
  await response.body?.cancel();
}

export async function retainCapture(c: ActionsClient, session: SnapshotSession, source: EngineEndpoint, sourceStore: string, metadataStore: string, manifestKey: string, anchorId: string, paths: string[]): Promise<RetainedSnapshot> {
  const manifest = JSON.parse(fs.readFileSync(path.join(metadataStore, manifestKey), 'utf8'));
  const registered = await c.post<{ snapshot: RetainedSnapshot; upload: Upload }>(`/api/v1/sandboxes/${anchorId}/sync-snapshots`, { manifest, paths });
  const input = { store: sourceStore, upload: registered.upload, manifest };
  if ('local' in source) await publish(input, createRequire(import.meta.url));
  else {
    const payload = path.posix.join(await session.remoteRoot(source.id), 'retained-upload.json');
    await session.write(source.id, payload, JSON.stringify(input));
    await session.command(source.id, `(${publish.toString()})(JSON.parse(require('node:fs').readFileSync(${JSON.stringify(payload)},'utf8')),require).catch(e=>{console.error(e.message);process.exitCode=1})`);
  }
  const completed = await c.post<{ snapshot: RetainedSnapshot }>(`/api/v1/snapshots/${registered.snapshot.id}/sync`, {});
  return { id: completed.snapshot.id, expiresAt: completed.snapshot.expiresAt };
}
