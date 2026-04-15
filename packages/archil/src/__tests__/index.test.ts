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
    const provider = archil({ apiKey: 'test', region: 'aws-us-east-1', diskId: 'disk_xyz' });
    expect(provider.name).toBe('archil');
  });
});

runProviderTestSuite({
  name: 'archil',
  provider: archil({
    apiKey: process.env.ARCHIL_API_KEY,
    region: process.env.ARCHIL_REGION,
    diskId: process.env.ARCHIL_DISK_ID,
  }),
  supportsFilesystem: true,
  skipIntegration:
    !process.env.ARCHIL_API_KEY || !process.env.ARCHIL_REGION || !process.env.ARCHIL_DISK_ID,
});
