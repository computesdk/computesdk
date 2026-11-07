import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ArkerError, type Arker, type VM } from '@arker-ai/sdk';
import { describe, expect, it } from 'vitest';
import { arker } from '../index';

function errorText(error: unknown): string {
  return error instanceof ArkerError ? `${error.status} ${error.code}: ${error.message}` : String(error);
}

async function observe<T>(label: string, operation: () => Promise<T>) {
  try {
    const value = await operation();
    console.log('ARKER_FINAL', label, JSON.stringify({ ok: true, value }));
    return { ok: true, value } as const;
  } catch (error) {
    const detail = errorText(error);
    console.log('ARKER_FINAL', label, JSON.stringify({ ok: false, error: detail }));
    return { ok: false, error: detail } as const;
  }
}

async function status(client: Arker, id: string): Promise<string> {
  return client.getVm(id).then(() => 'exists', (error: unknown) => {
    if (error instanceof ArkerError && error.status === 404) return '404';
    throw error;
  });
}

async function cleanup(client: Arker, ids: Iterable<string>) {
  for (const id of ids) {
    console.log('ARKER_FINAL before cleanup', id);
    const deleted = await observe(`delete ${id}`, async () => {
      try { await client.vm(id).delete(); } catch (error) {
        if (!(error instanceof ArkerError) || error.status !== 404) throw error;
      }
      return true;
    });
    const state = await observe(`cleanup status ${id}`, () => status(client, id));
    expect.soft(deleted.ok).toBe(true);
    expect.soft(state).toEqual({ ok: true, value: '404' });
  }
}

function fingerprint(content: string | Uint8Array) {
  return {
    bytes: typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength,
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}

describe.skipIf(!process.env.ARKER_API_KEY)('Arker focused final verification (live)', () => {
  it('roundtrips the isolated 128 MiB-labelled payload with native, relative and absolute read hashes', async () => {
    const box = await arker({ platforms: ['graviton4'] }).instances.create({ templateId: 'ubuntu-small' });
    const vm = box.getInstance();
    console.log('ARKER_FINAL filesystem source', vm.id);
    try {
      const dir = `/root/arker-filesystem-${randomUUID()}`;
      const path = `${dir}/adapter`;
      await box.filesystem.mkdir(dir);
      await box.runCommand(`cd ${dir}`);
      const expected = await (async () => {
        const payload = randomBytes(128 * 1024 * 1024).toString('base64');
        const digest = fingerprint(payload);
        console.log('ARKER_FINAL before adapter write', vm.id, JSON.stringify(digest));
        await box.filesystem.writeFile('adapter', payload);
        return digest;
      })();
      console.log('ARKER_FINAL upload scope released before reads', vm.id, JSON.stringify(process.memoryUsage()));
      expect(expected.bytes).toBe(178_956_972);
      const guest = await box.runCommand(`sha256sum ${path}; wc -c < ${path}`);
      console.log('ARKER_FINAL guest write hash', vm.id, JSON.stringify(guest));
      expect(guest.exitCode).toBe(0);
      expect(guest.stdout).toBe(`${expected.sha256}  ${path}\n${expected.bytes}\n`);

      const native = await observe('native large read', async () => fingerprint(await vm.sync(path)));
      expect.soft(native).toEqual({ ok: true, value: expected });
      const relative = await observe('adapter relative large read', async () => fingerprint(await box.filesystem.readFile('adapter')));
      expect.soft(relative).toEqual({ ok: true, value: expected });
      const absolute = await observe('adapter absolute large read', async () => fingerprint(await box.filesystem.readFile(path)));
      expect.soft(absolute).toEqual({ ok: true, value: expected });
      await box.filesystem.remove('adapter');
      expect(await box.filesystem.exists('adapter')).toBe(false);
      console.log('ARKER_FINAL filesystem result', JSON.stringify({ id: vm.id, expected, native, relative, absolute }));
    } finally {
      await cleanup(vm._client, [vm.id]);
    }
  }, 300_000);

  it('verifies five concurrent restores after source deletion through both adapter and native fork', async () => {
    const provider = arker({ platforms: ['graviton4'] });
    const source = await provider.instances.create({ templateId: 'ubuntu-small' });
    const sourceVm = source.getInstance();
    console.log('ARKER_FINAL fanout source', sourceVm.id);
    const ids = new Set([sourceVm.id]);
    try {
      const runId = randomUUID();
      const dir = `/root/bench-snapshot-fanout-${runId}`;
      const marker = `${dir}/marker.txt`;
      const content = `verify-content-${runId}`;
      await source.filesystem.mkdir(dir);
      await source.filesystem.writeFile(marker, content);
      expect(await source.filesystem.readFile(marker)).toBe(content);
      const loop = 'echo "$$" > "$2"; while :; do t=$(date +%s%3N); case "$t" in *N*) t=$(($(date +%s)*1000));; esac; echo "$t" >> "$1"; sleep 0.1; done';
      const heartbeat = await source.runCommand(
        `f="\${TMPDIR:-/tmp}/bench-src-hb-${runId}"; p="$f.pid"; : > "$f"; : > "$p"; ` +
        'S=; command -v setsid >/dev/null 2>&1 && S=setsid; ' +
        `$S nohup sh -c '${loop}' hb "$f" "$p" >/dev/null 2>&1 < /dev/null & ` +
        'i=0; while [ ! -s "$p" ] && [ "$i" -lt 50 ]; do sleep 0.1; i=$((i+1)); done; cat "$p"; rm -f "$p"; echo "$f"',
      );
      const [pidText, heartbeatFile] = heartbeat.stdout.trim().split('\n');
      const pid = Number(pidText);
      console.log('ARKER_FINAL source heartbeat', sourceVm.id, JSON.stringify({ pid, heartbeatFile, exitCode: heartbeat.exitCode }));
      expect(heartbeat.exitCode).toBe(0);
      expect(Number.isInteger(pid) && pid > 0).toBe(true);
      expect(heartbeatFile.startsWith('/')).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const before = await source.runCommand(`kill -0 ${pid} && wc -l < "${heartbeatFile}"`);
      expect.soft(before.exitCode).toBe(0);
      expect.soft(Number(before.stdout.trim())).toBeGreaterThan(0);
      console.log('ARKER_FINAL before snapshot', JSON.stringify({ source: sourceVm.id, marker, content }));
      const snapshot = await provider.snapshot!.create(sourceVm.id);
      console.log('ARKER_FINAL snapshot', JSON.stringify({ source: sourceVm.id, snapshot: snapshot.id }));
      ids.add(snapshot.id);
      expect(snapshot.id).not.toBe(sourceVm.id);
      expect(await source.filesystem.readFile(marker)).toBe(content);
      const first = await source.runCommand(`kill -0 ${pid} && wc -l < "${heartbeatFile}"`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const second = await source.runCommand(`kill -0 ${pid} && wc -l < "${heartbeatFile}"`);
      console.log('ARKER_FINAL source heartbeat after snapshot', sourceVm.id, JSON.stringify({ pid, first, second }));
      expect.soft(first.exitCode).toBe(0);
      expect.soft(second.exitCode).toBe(0);
      expect.soft(Number(second.stdout.trim())).toBeGreaterThan(Number(first.stdout.trim()));
      console.log('ARKER_FINAL before source deletion', sourceVm.id);
      await source.destroy();
      const sourceState = await status(sourceVm._client, sourceVm.id);
      console.log('ARKER_FINAL source deleted before restores', sourceVm.id, sourceState);
      expect(sourceState).toBe('404');
      await observe('snapshot metadata after source deletion', async () => {
        const vm = await sourceVm._client.getVm(snapshot.id);
        return { id: vm.id, state: vm.state, rootSource: vm.root_source_vm_id ?? null };
      });

      for (const mode of ['adapter', 'native'] as const) {
        const started = Date.now();
        console.log('ARKER_FINAL before five concurrent restores', JSON.stringify({ mode, snapshot: snapshot.id, count: 5 }));
        const launches = await Promise.allSettled(Array.from({ length: 5 }, async (_, index) => {
          console.log('ARKER_FINAL restore start', JSON.stringify({ mode, index, snapshot: snapshot.id }));
          const box = mode === 'adapter' ? await provider.instances.create({ snapshotId: snapshot.id }) : undefined;
          const vm: VM = box ? box.getInstance() : await sourceVm._client.fork({ source_vm_id: snapshot.id, name: null });
          console.log('ARKER_FINAL clone', JSON.stringify({ mode, index, id: vm.id, sdkId: box?.instanceId ?? null, snapshot: snapshot.id, ms: Date.now() - started, state: vm.state, rootSource: vm.root_source_vm_id ?? null }));
          expect.soft(ids.has(vm.id)).toBe(false);
          ids.add(vm.id);
          return { vm, box, index };
        }));
        const clones = launches.flatMap((launch, index) => {
          if (launch.status === 'fulfilled') return [launch.value];
          console.log('ARKER_FINAL restore failed', JSON.stringify({ mode, index, snapshot: snapshot.id, error: errorText(launch.reason) }));
          return [];
        });
        const checks = await Promise.all(clones.map(async ({ vm, box, index }) => {
          const primary = await observe(`${mode} clone ${index} first marker read ${vm.id}`, () => box ? box.filesystem.readFile(marker) : vm.sync(marker).then((bytes) => new TextDecoder().decode(bytes)));
          const native = mode === 'native' ? primary : await observe(`native read of adapter clone ${vm.id}`, () => vm.sync(marker).then((bytes) => new TextDecoder().decode(bytes)));
          if (!primary.ok || primary.value !== content) {
            await observe(`native cat diagnostic ${vm.id}`, () => vm.run(`pwd -P; ls -ld ${dir}; cat ${marker}`));
            await observe(`late native marker diagnostic ${vm.id}`, () => vm.sync(marker).then((bytes) => new TextDecoder().decode(bytes)));
          }
          return { id: vm.id, index, primary, native, verified: primary.ok && primary.value === content };
        }));
        const verifiedCount = checks.filter((check) => check.verified).length;
        console.log('ARKER_FINAL fanout result', JSON.stringify({ mode, source: sourceVm.id, sourceState, snapshot: snapshot.id, launchedCount: clones.length, verifiedCount, checks }));
        expect.soft(clones.length).toBe(5);
        expect.soft(verifiedCount).toBe(5);
        for (const check of checks) expect.soft(check.native).toEqual({ ok: true, value: content });
        await cleanup(sourceVm._client, clones.map(({ vm }) => vm.id));
      }
    } finally {
      await cleanup(sourceVm._client, Array.from(ids).reverse());
    }
  }, 300_000);
});
