import { describe, expect, it } from 'vitest';
import { resolveKubeConfigSource } from '../index';

describe('resolveKubeConfigSource', () => {
  it('prefers kubeConfigRaw over env and path', () => {
    const source = resolveKubeConfigSource(
      { kubeConfigRaw: 'raw-config', kubeConfigPath: '/tmp/config' },
      { KUBECONFIG_B64: Buffer.from('env-config', 'utf8').toString('base64') },
    );
    expect(source).toEqual({ type: 'raw', value: 'raw-config' });
  });

  it('uses KUBECONFIG_B64 when raw is not provided', () => {
    const source = resolveKubeConfigSource(
      { kubeConfigPath: '/tmp/config' },
      { KUBECONFIG_B64: Buffer.from('env-config', 'utf8').toString('base64') },
    );
    expect(source).toEqual({ type: 'env', value: 'env-config' });
  });

  it('falls back to kubeConfigPath when env is absent', () => {
    const source = resolveKubeConfigSource({ kubeConfigPath: '/tmp/config' }, {});
    expect(source).toEqual({ type: 'path', value: '/tmp/config' });
  });

  it('uses default source when no input is provided', () => {
    const source = resolveKubeConfigSource({}, {});
    expect(source).toEqual({ type: 'default' });
  });
});
