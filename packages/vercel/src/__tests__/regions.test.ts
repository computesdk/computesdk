import { describe, expect, it } from 'vitest';
import type { RegionManager } from 'computesdk';
import { vercel } from '../index';

describe('vercel regionClass declaration', () => {
  const { regions } = vercel({}) as unknown as { regions: RegionManager };

  it('is selectable with no or an empty failover list', () => {
    expect(regions.support()).toMatchObject({ placement: 'selectable' });
    expect(regions.support({ failoverRegions: [] } as never)).toMatchObject({ placement: 'selectable' });
    expect(regions.resolve('us-west', { failoverRegions: [] } as never)).toMatchObject({ status: 'supported', region: 'sfo1' });
  });

  it('is unknown when failover regions are set', () => {
    expect(regions.support({ failoverRegions: ['fra1'] } as never)).toMatchObject({ placement: 'unknown' });
  });
});
