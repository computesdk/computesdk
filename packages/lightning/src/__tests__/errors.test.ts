import { describe, it, expect, vi } from 'vitest';

vi.mock('@lightningai/sdk', () => {
  class Sandbox {
    static configure(): void {}
    static async create(): Promise<never> {
      throw new Error(
        'Lightning API error 403: <!DOCTYPE html><html><body><div class="element-heading">Coming soon</div>' +
          '<p class="element-label">Lightning AI is not available in your region, yet.</p></body></html>'
      );
    }
  }
  return { Sandbox };
});

import { lightning } from '../index';

describe('lightning create errors', () => {
  it('reports a region-blocked 403 without the HTML page', async () => {
    const provider = lightning({ apiKey: 'test-key' });
    const message = await provider.sandbox.create().then(
      () => '',
      (e: unknown) => (e instanceof Error ? e.message : String(e))
    );
    expect(message).toContain('not available in your region');
    expect(message).toContain('403');
    expect(message).not.toContain('<!DOCTYPE');
  });
});
