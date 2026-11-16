import { describe, expect, it } from 'vitest';
import { maritime } from '../index';

describe('maritime templates', () => {
  const provider = maritime({ apiKey: 'mk_test' });

  it('requires exactly one of image or dockerfile', async () => {
    await expect(provider.template!.create({ name: 'tpl' })).rejects.toThrow('exactly one of `image` or `dockerfile`');
    await expect(provider.template!.create({ name: 'tpl', image: 'python:3.12', dockerfile: 'FROM python:3.12' } as never))
      .rejects.toThrow('exactly one of `image` or `dockerfile`');
  });

  it('rejects options Maritime does not store', async () => {
    await expect(provider.template!.create({ name: 'tpl', image: 'python:3.12', description: 'x' } as never))
      .rejects.toThrow('do not support description or metadata');
  });

  it('returns nothing for a zero limit without calling the API', async () => {
    expect(await provider.template!.list({ limit: 0 })).toEqual([]);
  });
});
