import { describe, it, expect } from 'vitest';
import { runProviderTestSuite } from '@computesdk/test-utils';
import * as indexExports from '../index';
import { archil } from '../index';

describe('archil export shape', () => {
  it('is resolvable via camelCase conversion of the hyphenated provider name', () => {
    // Workbench resolves provider names by camelCase conversion. 'archil' is
    // already a single token, so the export must literally be `archil`.
    const exportName = 'archil'.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    expect(typeof (indexExports as Record<string, unknown>)[exportName]).toBe('function');
  });

  it('uses the correct provider name', () => {
    const provider = archil({ apiKey: 'test', region: 'aws-us-east-1' });
    expect(provider.name).toBe('archil');
  });
});

runProviderTestSuite({
  name: 'archil',
  provider: archil({
    apiKey: process.env.ARCHIL_API_KEY,
    region: process.env.ARCHIL_REGION,
  }),
  // Archil filesystem mount points vary by account/runtime and are not yet
  // stable enough for generic provider-test-suite path assumptions.
  // Keep command/runtime integration coverage on, and add dedicated filesystem
  // integration once mount-path behavior is standardized.
  supportsFilesystem: false,
  skipIntegration: !process.env.ARCHIL_API_KEY || !process.env.ARCHIL_REGION,
});
