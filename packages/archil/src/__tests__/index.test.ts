import { describe, it, expect } from 'vitest';
import * as indexExports from '../index';
import { archil } from '../index';

describe('archil provider', () => {
  it('should be resolvable via camelCase conversion of the hyphenated provider name', () => {
    // Workbench resolves provider names by camelCase conversion. 'archil' is
    // already a single token, so the export must literally be `archil`.
    const exportName = 'archil'.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    expect(typeof (indexExports as Record<string, unknown>)[exportName]).toBe('function');
  });

  it('should create a provider with the correct name', () => {
    const provider = archil({ apiKey: 'test', region: 'aws-us-east-1', diskId: 'disk_xyz' });
    expect(provider.name).toBe('archil');
  });

  it('should throw a helpful error when apiKey is missing', async () => {
    const originalKey = process.env.ARCHIL_API_KEY;
    delete process.env.ARCHIL_API_KEY;
    try {
      const provider = archil({ region: 'aws-us-east-1', diskId: 'disk_xyz' });
      await expect(provider.sandbox.create()).rejects.toThrow(/ARCHIL_API_KEY/);
    } finally {
      if (originalKey !== undefined) process.env.ARCHIL_API_KEY = originalKey;
    }
  });

  it('should throw a helpful error when region is missing', async () => {
    const originalRegion = process.env.ARCHIL_REGION;
    delete process.env.ARCHIL_REGION;
    try {
      const provider = archil({ apiKey: 'test', diskId: 'disk_xyz' });
      await expect(provider.sandbox.create()).rejects.toThrow(/ARCHIL_REGION/);
    } finally {
      if (originalRegion !== undefined) process.env.ARCHIL_REGION = originalRegion;
    }
  });

  it('should throw a helpful error when diskId is missing', async () => {
    const provider = archil({ apiKey: 'test', region: 'aws-us-east-1' });
    await expect(provider.sandbox.create()).rejects.toThrow(/diskId/);
  });
});
