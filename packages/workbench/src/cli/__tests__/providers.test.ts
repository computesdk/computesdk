import { afterEach, describe, expect, it, vi } from 'vitest';

import { getProviderConfig, getProviderStatus } from '../providers.js';

describe('microsandbox Workbench configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('requires cloud credentials by default', () => {
    vi.stubEnv('MSB_API_KEY', '');
    vi.stubEnv('MSB_PROFILE', '');

    expect(getProviderStatus('microsandbox')).toMatchObject({
      isComplete: false,
      present: [],
      missing: ['MSB_API_KEY'],
    });
  });

  it('accepts an API key and forwards its optional endpoint', () => {
    vi.stubEnv('MSB_API_KEY', 'msb_test');
    vi.stubEnv('MSB_API_URL', 'https://cloud.example.test');
    vi.stubEnv('MSB_PROFILE', '');

    expect(getProviderStatus('microsandbox')).toMatchObject({
      isComplete: true,
      present: ['MSB_API_KEY'],
      missing: [],
    });
    expect(getProviderConfig('microsandbox')).toEqual({
      apiKey: 'msb_test',
      apiUrl: 'https://cloud.example.test',
    });
  });

  it('accepts a named cloud profile', () => {
    vi.stubEnv('MSB_API_KEY', '');
    vi.stubEnv('MSB_API_URL', '');
    vi.stubEnv('MSB_PROFILE', 'production');

    expect(getProviderStatus('microsandbox')).toMatchObject({
      isComplete: true,
      present: ['MSB_PROFILE'],
      missing: [],
    });
    expect(getProviderConfig('microsandbox')).toEqual({ profile: 'production' });
  });

  it('prefers an explicit API key when a profile is also set', () => {
    vi.stubEnv('MSB_API_KEY', 'msb_test');
    vi.stubEnv('MSB_API_URL', 'https://cloud.example.test');
    vi.stubEnv('MSB_PROFILE', 'production');

    expect(getProviderConfig('microsandbox')).toEqual({
      apiKey: 'msb_test',
      apiUrl: 'https://cloud.example.test',
    });
  });
});
