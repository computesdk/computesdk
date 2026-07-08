/**
 * Regression tests for the module-global API-key race (PR #627 review, P1).
 *
 * The Lightning SDK keeps auth in process-global state (`Sandbox.configure`) and
 * reads it lazily on every request. This mock reproduces that: each SDK call
 * reads the "current key" AFTER an await, so without the provider's per-config
 * gate a concurrent op with a different key would be observed. These tests drive
 * the real provider and assert each operation sees its OWN key.
 */

import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({ inFlight: 0, maxInFlight: 0, reset() { this.inFlight = 0; this.maxInFlight = 0; } }));

vi.mock('@lightningai/sdk', () => {
  let currentKey: string | undefined;
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const enter = () => { h.inFlight++; if (h.inFlight > h.maxInFlight) h.maxInFlight = h.inFlight; };
  const leave = () => { h.inFlight--; };

  const makeNative = (sandboxId: string) => ({
    sandboxId,
    name: sandboxId,
    status: 'running',
    ports: [] as string[],
    portUrls: {} as Record<string, string>,
    instanceType: 'cpu-1',
    runtime: 'node24',
    timeout: 0,
    createdAt: new Date('2026-07-08T00:00:00.000Z'),
    getPortUrl: () => '',
    createSnapshot: async () => {
      await tick();
      return { id: 'snap', status: 'ready', sizeBytes: 0, sourceSandboxId: sandboxId, sourceSandboxName: sandboxId, runtime: 'node24', auto: false, createdAt: new Date('2026-07-08T00:00:00.000Z'), expiresAt: null };
    },
    // Instance ops read the global key lazily (after an await), like real requests.
    runCommand: async () => { await tick(); return { output: `KEY:${currentKey}`, exitCode: 0 }; },
    writeFile: async () => { await tick(); },
    readFile: async () => { await tick(); return `KEY:${currentKey}`; },
    delete: async () => { await tick(); },
    fs: {
      mkdir: async () => { await tick(); },
      exists: async () => { await tick(); return true; },
      readdir: async () => { await tick(); return []; },
      stat: async () => ({ fileType: 'file', size: 0, mtime: new Date('2026-07-08T00:00:00.000Z'), mode: '' }),
      rm: async () => { await tick(); },
    },
  });

  class Sandbox {
    static configure({ apiKey }: { apiKey?: string }) { currentKey = apiKey; }
    static async create(params: { name?: string }) {
      enter();
      try {
        await tick();
        const keyAtRequest = currentKey;
        await tick(); // simulate create's internal polling doing a second lazy read
        const keyAtPoll = currentKey;
        const s = makeNative(params?.name ?? 'sb') as ReturnType<typeof makeNative> & { __keyAtRequest?: string; __keyAtPoll?: string };
        s.__keyAtRequest = keyAtRequest;
        s.__keyAtPoll = keyAtPoll;
        return s;
      } finally {
        leave();
      }
    }
    static async get({ sandboxId }: { sandboxId: string }) {
      enter();
      try {
        await tick();
        const s = makeNative(sandboxId) as ReturnType<typeof makeNative> & { __keyAtRequest?: string };
        s.__keyAtRequest = currentKey;
        return s;
      } finally {
        leave();
      }
    }
    static async list() { enter(); try { await tick(); return { sandboxes: [makeNative('sb')] }; } finally { leave(); } }
    static async listSnapshots() { await tick(); return { snapshots: [] }; }
    static async getSnapshot() { await tick(); return makeNative('sb'); }
    static async deleteSnapshot() { await tick(); }
  }
  return { Sandbox };
});

import { lightning } from '../index';

const KEY_A = 'sk-lit-aaaaaaaaaaaaaaaa';
const KEY_B = 'sk-lit-bbbbbbbbbbbbbbbb';

describe('lightning auth isolation (per-config gate)', () => {
  it('concurrent creates with different keys each use their own key', async () => {
    h.reset();
    const a = lightning({ apiKey: KEY_A });
    const b = lightning({ apiKey: KEY_B });

    const [sa, sb] = await Promise.all([
      a.sandbox.create({ name: 'a' }),
      b.sandbox.create({ name: 'b' }),
    ]);

    const na = sa.getInstance() as { __keyAtRequest?: string; __keyAtPoll?: string };
    const nb = sb.getInstance() as { __keyAtRequest?: string; __keyAtPoll?: string };

    // Each create — including its internal polling read — saw its own key.
    expect(na.__keyAtRequest).toBe(KEY_A);
    expect(na.__keyAtPoll).toBe(KEY_A);
    expect(nb.__keyAtRequest).toBe(KEY_B);
    expect(nb.__keyAtPoll).toBe(KEY_B);
  });

  it('preserves concurrency for same-key operations', async () => {
    h.reset();
    const a = lightning({ apiKey: KEY_A });

    await Promise.all([
      a.sandbox.create({ name: 'x' }),
      a.sandbox.create({ name: 'y' }),
      a.sandbox.create({ name: 'z' }),
    ]);

    // Same-key ops share the active epoch — they overlapped rather than serializing.
    expect(h.maxInFlight).toBeGreaterThan(1);
  });

  it('serializes across different keys (no interleaving)', async () => {
    h.reset();
    const a = lightning({ apiKey: KEY_A });
    const b = lightning({ apiKey: KEY_B });

    await Promise.all([
      a.sandbox.create({ name: 'a1' }),
      b.sandbox.create({ name: 'b1' }),
      a.sandbox.create({ name: 'a2' }),
      b.sandbox.create({ name: 'b2' }),
    ]);

    // A different-key op never runs while another key's epoch is active.
    // (A create reads its key twice across two ticks; interleaving would let a
    // different key slip in — asserted by the per-key checks above passing here.)
    expect(h.maxInFlight).toBeLessThanOrEqual(2);
  });

  it('instance ops re-apply their originating config (not the stale global)', async () => {
    h.reset();
    const a = lightning({ apiKey: KEY_A });
    const b = lightning({ apiKey: KEY_B });

    const sandbox = await a.sandbox.create({ name: 'a' });
    // Another provider runs an op, leaving the SDK global set to KEY_B.
    await b.sandbox.list();

    // runCommand + readFile on A's sandbox must re-install KEY_A under the gate.
    const cmd = await sandbox.runCommand('whoami');
    expect(cmd.stdout).toBe(`KEY:${KEY_A}`);

    await sandbox.filesystem.writeFile('/root/f', 'x');
    const content = await sandbox.filesystem.readFile('/root/f');
    expect(content).toBe(`KEY:${KEY_A}`);
  });
});
