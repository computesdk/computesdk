import { describe, expect, it } from 'vitest';
import { lelantos as make } from '../index';

describe('lelantos standard sizes', () => {
  it('is unconfigured until a template is set for the size', () => {
    expect(make({ apiKey: 'k' }).sizes!.resolve('md').status).toBe('unconfigured');
  });

  it('boots the configured size template', () => {
    const provider = make({ apiKey: 'k', sizeTemplates: { md: 'tpl-2cpu-4gb' } });
    expect(provider.sizes!.resolve('md')).toMatchObject({ status: 'supported', nativeOptions: { templateId: 'tpl-2cpu-4gb' } });
    expect(provider.sizes!.resolve('lg').status).toBe('unconfigured');
  });

  it('refuses sizeClass with an explicit template', () => {
    const provider = make({ apiKey: 'k', sizeTemplates: { md: 'tpl' } });
    expect(provider.sizes!.resolve('md', { templateId: 'other' }).status).toBe('unsupported');
  });
});
