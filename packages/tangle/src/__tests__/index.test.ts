import { describe, expect, it } from 'vitest';
import { tangle } from '../index';

describe('Tangle configuration', () => {
  it.each(['', '   '])('rejects an explicitly empty API key before contacting the SDK', (apiKey) => {
    expect(() => tangle({ apiKey })).toThrow(/TANGLE_API_KEY/);
  });
});
