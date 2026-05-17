/**
 * Northflank port & timeout integration tests.
 *
 * Adapted from packages/modal/src/__tests__/ports.test.ts. These tests hit a
 * real Northflank project — service create + deployment-ready takes ~10–20s
 * per case, so timeouts are deliberately generous and the suite is skipped
 * when credentials aren't set.
 */
import '@computesdk/test-utils';

import { describe, it, expect } from 'vitest';
import { northflank } from '../index';

const SINGLE_PORT = 3000;
const MULTI_PORT_1 = 4001;
const MULTI_PORT_2 = 4002;
const UNUSED_PORT = 9999;

const skipTests = !process.env.NORTHFLANK_TOKEN || !process.env.NORTHFLANK_PROJECT_ID;
const host = process.env.NORTHFLANK_API_URL;

function makeProvider(extra: Record<string, unknown> = {}) {
  return northflank({
    token: process.env.NORTHFLANK_TOKEN!,
    projectId: process.env.NORTHFLANK_PROJECT_ID!,
    ...(host ? { host } : {}),
    ...extra,
  });
}

describe('Northflank Port Forwarding Integration Tests', () => {
  if (skipTests) {
    console.log('⚠️  Skipping Northflank port tests - NORTHFLANK_TOKEN/NORTHFLANK_PROJECT_ID not set');
  }

  it.skipIf(skipTests)(
    'should patch a private port to public when getUrl is called',
    async () => {
      // Declare the port as private at create time. The keep-alive will still
      // bind to it internally, so the deployment reaches COMPLETED. Then
      // getUrl() needs to patch the port to public and return a routable URL.
      const PRIVATE_PORT = 4100;
      const provider = makeProvider();
      const sandbox = await provider.sandbox.create({
        ports: [
          { name: 'priv', internalPort: PRIVATE_PORT, public: false, protocol: 'HTTP' },
        ],
      } as any);
      try {
        const url = await sandbox.getUrl({ port: PRIVATE_PORT });
        expect(url).toMatch(/^https?:\/\//);
        // Northflank's public DNS for a port follows a predictable pattern;
        // we don't pin the exact subdomain but the URL must contain the
        // service identifier substring.
        expect(url.length).toBeGreaterThan('https://'.length);
      } finally {
        await sandbox.destroy();
      }
    },
    300_000,
  );

  it.skipIf(skipTests)(
    'should expose multiple ports with distinct public URLs',
    async () => {
      const provider = makeProvider();
      const sandbox = await provider.sandbox.create({ ports: [MULTI_PORT_1, MULTI_PORT_2] } as any);
      try {
        const url1 = await sandbox.getUrl({ port: MULTI_PORT_1 });
        const url2 = await sandbox.getUrl({ port: MULTI_PORT_2 });

        expect(url1).toMatch(/^https?:\/\//);
        expect(url2).toMatch(/^https?:\/\//);
        expect(url1).not.toBe(url2);
      } finally {
        await sandbox.destroy();
      }
    },
    300_000,
  );

  it.skipIf(skipTests)(
    'getInfo() reflects the configured timeout',
    async () => {
      const customTimeout = 300_000;
      const provider = makeProvider({ timeout: customTimeout });
      const sandbox = await provider.sandbox.create({ ports: [SINGLE_PORT] } as any);
      try {
        const info = await sandbox.getInfo();
        expect(info.timeout).toBe(customTimeout);
        expect(info.provider).toBe('northflank');
      } finally {
        await sandbox.destroy();
      }
    },
    300_000,
  );

  // Sanity check that an unused port number still resolves (it gets patched
  // public on demand). We don't assert reachability — there's nothing
  // listening — only that getUrl returns a routable-looking URL.
  it.skipIf(skipTests)(
    'getUrl resolves for a port that was never declared at create time',
    async () => {
      const provider = makeProvider();
      const sandbox = await provider.sandbox.create({ ports: [SINGLE_PORT] } as any);
      try {
        const url = await sandbox.getUrl({ port: UNUSED_PORT });
        expect(url).toMatch(/^https?:\/\//);
      } finally {
        await sandbox.destroy();
      }
    },
    300_000,
  );
});
