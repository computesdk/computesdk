/**
 * Browser Provider Test Suite
 *
 * Tests the core browser session lifecycle using a single shared session
 * to stay within provider rate limits and concurrent session caps.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
// @ts-ignore - workspace reference
import type { BrowserProvider, ProviderBrowserSession } from '@computesdk/provider';

export interface BrowserProviderTestConfig {
  /** The browser provider instance to test */
  provider: BrowserProvider;
  /** Provider name for test descriptions */
  name: string;
  /** Custom test timeout in milliseconds */
  timeout?: number;
  /** Skip tests that require real API calls */
  skipIntegration?: boolean;
}

export function runBrowserProviderTestSuite(config: BrowserProviderTestConfig) {
  const { provider, name, timeout = 60000, skipIntegration = false } = config;

  describe(`${name} Browser Provider`, () => {
    let session: ProviderBrowserSession;

    beforeAll(async () => {
      if (skipIntegration) return;
      session = await provider.session.create();
    }, timeout);

    afterAll(async () => {
      if (skipIntegration || !session) return;
      try {
        await Promise.race([
          provider.session.destroy(session.sessionId),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Cleanup timeout')), 10000)),
        ]);
      } catch {
        // Ignore cleanup errors
      }
    }, timeout);

    it('should create a session with a valid ID and connect URL', () => {
      if (skipIntegration) return;

      expect(session.sessionId).toBeTruthy();
      expect(session.connectUrl).toBeTruthy();
      expect(typeof session.connectUrl).toBe('string');
    });

    it('should retrieve a session by ID', async () => {
      if (skipIntegration) return;

      const retrieved = await provider.session.getById(session.sessionId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.sessionId).toBe(session.sessionId);
    }, timeout);

    it('should return null for nonexistent session', async () => {
      if (skipIntegration) return;

      const result = await provider.session.getById('nonexistent-session-id-12345');
      expect(result).toBeNull();
    }, timeout);

    it('should list sessions including the created one', async () => {
      if (skipIntegration) return;

      const sessions = await provider.session.list();
      expect(Array.isArray(sessions)).toBe(true);
      const found = sessions.find((s: any) => s.sessionId === session.sessionId);
      expect(found).toBeTruthy();
    }, timeout);

    it('should get connect URL for the session', async () => {
      if (skipIntegration) return;

      const url = await provider.getConnectUrl(session.sessionId);
      expect(url).toBeTruthy();
      expect(typeof url).toBe('string');
      expect(url).toMatch(/^(wss?|https?):\/\//);
    }, timeout);

    it('should expose getProvider() and getInstance()', () => {
      if (skipIntegration) return;

      expect(session.getProvider().name).toBe(name);
      expect(session.getInstance()).toBeTruthy();
    });

    it('should destroy a session', async () => {
      if (skipIntegration) return;

      // Create a separate session just for the destroy test
      const tempSession = await provider.session.create();
      await provider.session.destroy(tempSession.sessionId);
    }, timeout);
  });
}
