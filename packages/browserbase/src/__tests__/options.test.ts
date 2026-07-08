import { describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: 'session-id', connectUrl: 'wss://browserbase.example', status: 'RUNNING' })),
}));

vi.mock('@browserbasehq/sdk', () => ({
  default: class Browserbase {
    sessions = {
      create: sdk.create,
    };
  },
}));

import { browserbase } from '../index';

describe('browserbase option mapping', () => {
  it('preserves explicit false stealth and proxy values', async () => {
    const provider = browserbase({ apiKey: 'test', projectId: 'project-id' });

    await provider.session.create({
      stealth: false,
      proxies: false,
      viewport: { width: 1920, height: 1080 },
    });

    expect(sdk.create).toHaveBeenCalledWith({
      projectId: 'project-id',
      proxies: false,
      browserSettings: {
        viewport: { width: 1920, height: 1080 },
        advancedStealth: false,
      },
    });
  });
});
