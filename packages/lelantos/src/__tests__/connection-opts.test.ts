import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Spies on the e2b SDK's static entry points, so we can assert exactly which
// connection options (apiKey/domain/apiUrl) the provider threads into each
// call — without a real sandbox. These two regressions are what this guards:
//   1. No domain configured → must default to 'lelantos.ai', NOT fall through
//      undefined (which makes the e2b SDK silently target api.e2b.app).
//   2. A native lel_<hex> key → must be re-prefixed to its e2b_<hex> alias,
//      because e2b SDK ≥2.27 rejects non-e2b_ keys client-side.
const { mockCreate, mockConnect } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockConnect: vi.fn(),
}));

vi.mock('e2b', () => {
  class CommandExitError extends Error {}
  class Sandbox {
    sandboxId = 'sbx_test';
    commands = { run: vi.fn() };
    static async create(...args: unknown[]) { mockCreate(...args); return new Sandbox(); }
    static async connect(...args: unknown[]) { mockConnect(...args); return new Sandbox(); }
    static list() { return { nextItems: async () => [] }; }
  }
  return { Sandbox, CommandExitError };
});

import { lelantos } from '../index';

const ENV_KEYS = ['LELANTOS_API_KEY', 'E2B_API_KEY', 'LELANTOS_DOMAIN', 'E2B_DOMAIN', 'LELANTOS_API_URL', 'E2B_API_URL'] as const;
const savedEnv: Record<string, string | undefined> = {};

describe('connection options', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockConnect.mockReset();
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('defaults domain to lelantos.ai when nothing is configured', async () => {
    const provider = lelantos({ apiKey: 'e2b_abc123' });
    await provider.sandbox.create();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ domain: 'lelantos.ai' });
  });

  it('lets an explicit config domain win over the default', async () => {
    const provider = lelantos({ apiKey: 'e2b_abc123', domain: 'staging.example.dev' });
    await provider.sandbox.create();
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ domain: 'staging.example.dev' });
  });

  it('lets LELANTOS_DOMAIN win over the default', async () => {
    process.env.LELANTOS_DOMAIN = 'self-hosted.example.dev';
    const provider = lelantos({ apiKey: 'e2b_abc123' });
    await provider.sandbox.create();
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ domain: 'self-hosted.example.dev' });
  });

  it('threads the default domain into connect-based calls (getById/destroy)', async () => {
    const provider = lelantos({ apiKey: 'e2b_abc123' });
    await provider.sandbox.getById('sbx_test');
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockConnect.mock.calls[0][1]).toMatchObject({ domain: 'lelantos.ai' });
  });

  it('re-prefixes a native lel_<hex> key to its e2b_<hex> alias', async () => {
    const provider = lelantos({ apiKey: 'lel_0a1b2c3d4e5f' });
    await provider.sandbox.create();
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ apiKey: 'e2b_0a1b2c3d4e5f' });
  });

  it('normalizes a lel_<hex> key from LELANTOS_API_KEY too', async () => {
    process.env.LELANTOS_API_KEY = 'lel_deadbeef00';
    const provider = lelantos({});
    await provider.sandbox.create();
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ apiKey: 'e2b_deadbeef00' });
  });

  it('passes e2b_ keys through unchanged', async () => {
    const provider = lelantos({ apiKey: 'e2b_0a1b2c3d4e5f' });
    await provider.sandbox.create();
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ apiKey: 'e2b_0a1b2c3d4e5f' });
  });

  it('passes keys that are not strict lel_<hex> through unchanged', async () => {
    const provider = lelantos({ apiKey: 'lel_NOT-HEX' });
    await provider.sandbox.create();
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ apiKey: 'lel_NOT-HEX' });
  });
});
