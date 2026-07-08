/**
 * Focused unit tests for Lightning port-URL support.
 *
 * These drive the real provider code (create -> getUrl / getInfo) against a
 * mocked `@lightningai/sdk`, so they run without a live LIGHTNING_API_KEY and
 * verify the `getPortUrl` wiring (shipped in `@lightningai/sdk` 2026.7.8).
 */

import { describe, it, expect, vi } from 'vitest';

// The provider loads the ESM-only SDK via dynamic `import('@lightningai/sdk')`.
// The factory is hoisted above imports, so the fake is defined entirely inside
// it to avoid touching un-initialized outer bindings.
vi.mock('@lightningai/sdk', () => {
  const makeNative = () => ({
    sandboxId: 'sb-123',
    name: 'url-test',
    status: 'running',
    ports: ['8080', '3000'],
    portUrls: {
      '8080': 'https://8080-sb-123-s.cloudspaces.litng.ai',
      '3000': 'https://3000-sb-123-s.cloudspaces.litng.ai',
    } as Record<string, string>,
    instanceType: 'cpu-1',
    runtime: 'node24',
    timeout: 0,
    createdAt: new Date('2026-07-08T00:00:00.000Z'),
    getPortUrl(port: number | string): string {
      const url = this.portUrls[String(port)];
      if (!url) {
        const exposed = this.ports.length ? this.ports.join(', ') : 'none';
        throw new Error(
          `Sandbox ${this.sandboxId} has no URL for port ${port}. Exposed ports: ${exposed}.`
        );
      }
      return url;
    },
    runCommand: async () => ({ output: '', exitCode: 0 }),
    writeFile: async () => {},
    readFile: async () => null,
    delete: async () => {},
    fs: {
      mkdir: async () => {},
      exists: async () => true,
      readdir: async () => [],
      stat: async () => ({ fileType: 'file', size: 0, mtime: new Date(), mode: '' }),
      rm: async () => {},
    },
  });

  class Sandbox {
    static configure(): void {}
    static async create() {
      return makeNative();
    }
    static async get() {
      return makeNative();
    }
    static async list() {
      return { sandboxes: [makeNative()] };
    }
  }

  return { Sandbox };
});

// Imported after the mock so the dynamic import resolves to the fake SDK.
import { lightning } from '../index';

describe('lightning port URLs', () => {
  it('returns the public HTTPS URL for an exposed port', async () => {
    const provider = lightning({ apiKey: 'test-key' });
    const sandbox = await provider.sandbox.create({ ports: [8080] });

    const url = await sandbox.getUrl({ port: 8080 });

    expect(url).toBe('https://8080-sb-123-s.cloudspaces.litng.ai');
  });

  it('honors a caller-requested protocol while keeping the proxy host', async () => {
    const provider = lightning({ apiKey: 'test-key' });
    const sandbox = await provider.sandbox.create({ ports: [3000] });

    const url = await sandbox.getUrl({ port: 3000, protocol: 'wss' });

    expect(url).toBe('wss://3000-sb-123-s.cloudspaces.litng.ai');
  });

  it('surfaces portUrls in sandbox info metadata', async () => {
    const provider = lightning({ apiKey: 'test-key' });
    const sandbox = await provider.sandbox.create({ ports: [8080] });

    const info = await sandbox.getInfo();

    expect(info.metadata?.portUrls).toEqual({
      '8080': 'https://8080-sb-123-s.cloudspaces.litng.ai',
      '3000': 'https://3000-sb-123-s.cloudspaces.litng.ai',
    });
  });

  it('throws a helpful error for a port that was not exposed', async () => {
    const provider = lightning({ apiKey: 'test-key' });
    const sandbox = await provider.sandbox.create();

    await expect(sandbox.getUrl({ port: 9999 })).rejects.toThrow(/no URL for port 9999/i);
  });
});
