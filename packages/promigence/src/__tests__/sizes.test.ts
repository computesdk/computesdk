/**
 * `sizeClass` on Promigence, with the Promigence SDK faked at its client (no network, no keys).
 *
 * Ways the mapping could fail, each covered below:
 * - Wrong shape: a class sent to a tier that does not belong to it (e.g. lg to `small`, or md to
 *   `medium`), or `resolved` not naming the tier's listed shape (medium is 4 vCPU / 16 GiB).
 * - Silent default boot: lg/xl without an image starting the built-in base (small, 2 vCPU / 4 GiB),
 *   or a size requested on a snapshot/template that keeps its own build tier.
 * - Dropped field: the resolver's `tier` not reaching `snapshots.create` on the image path, or a
 *   config `tier` winning over the size the caller asked for.
 * - Conflict accepted: `sizeClass` alongside the native `tier` (or a core CPU/RAM field) creating
 *   a sandbox instead of throwing InstanceSizeError('conflict').
 * - Unlisted sizes accepted: xs, sm, 2xl or 3xl booting some tier instead of being refused.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InstanceSizeError } from '@computesdk/provider';
import { promigence, PROMIGENCE_SIZE_TIERS } from '../index';
import type { PromigenceConfig } from '../index';
import { FakeClient } from './fake-client';

let savedEnv: NodeJS.ProcessEnv;
let configHome: string;

beforeEach(() => {
  savedEnv = { ...process.env };
  for (const k of Object.keys(process.env)) if (/^PROMIGENCE_|^XDG_CONFIG_HOME$/.test(k)) delete process.env[k];
  configHome = mkdtempSync(join(tmpdir(), 'promigence-sizes-'));
  process.env.XDG_CONFIG_HOME = configHome;
  process.env.PROMIGENCE_CREDENTIAL_STORE = 'file';
});

afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
  rmSync(configHome, { recursive: true, force: true });
});

function setup(config: Omit<PromigenceConfig, 'client'> = {}) {
  const client = new FakeClient();
  const provider = promigence({ client: client.asClient(), ...config });
  return { client, provider };
}

const image = `registry.example.com/team/app@sha256:${'a'.repeat(64)}`;
const sent = (client: FakeClient, name: string) => client.last(name)[0] as Record<string, unknown>;

describe('Promigence standard sizes (mock-only)', () => {
  it('maps md, lg and xl to the published tiers on the image path and nothing else', () => {
    const { provider } = setup();
    const list = provider.sizes.list({ image });
    expect(list.map((r) => [r.requested.sizeClass, r.status])).toEqual([
      ['xs', 'unknown'], ['sm', 'unknown'], ['md', 'supported'], ['lg', 'supported'],
      ['xl', 'supported'], ['2xl', 'unknown'], ['3xl', 'unknown'],
    ]);
    expect(provider.sizes.resolve('md', { image })).toMatchObject({
      status: 'supported', nativeOptions: { tier: 'small' }, resolved: { vcpus: 2, memoryMiB: 4096 },
    });
    expect(provider.sizes.resolve('lg', { image })).toMatchObject({
      status: 'supported', nativeOptions: { tier: 'medium' }, resolved: { vcpus: 4, memoryMiB: 16384 },
    });
    expect(provider.sizes.resolve('xl', { image })).toMatchObject({
      status: 'supported', nativeOptions: { tier: 'large' }, resolved: { vcpus: 8, memoryMiB: 32768 },
    });
    for (const r of list) {
      if (r.status === 'supported') {
        expect(r.resolved.vcpus).toBeGreaterThanOrEqual(r.requested.vcpus);
        expect(r.resolved.memoryMiB).toBeGreaterThanOrEqual(r.requested.memoryMiB);
        expect(r.resolved).not.toHaveProperty('diskMiB');
        expect(r).not.toHaveProperty('belowStandard');
      } else {
        expect(r.reason).toMatch(/publishes no tier shape/);
      }
    }
    expect(Object.keys(PROMIGENCE_SIZE_TIERS)).toEqual(['md', 'lg', 'xl']);
  });

  it.each([
    ['md', 'small', 2, 4096],
    ['lg', 'medium', 4, 16384],
    ['xl', 'large', 8, 32768],
  ] as const)('create({ image, sizeClass: %s }) builds the image at tier %s', async (sizeClass, tier, vcpus, memoryMiB) => {
    const { client, provider } = setup({ tier: 'xsmall' });
    const sandbox = await provider.instances.create({ image, sizeClass });
    expect(sent(client, 'snapshots.create')).toMatchObject({ image, tier });
    expect(sent(client, 'runs.start').snapshot).toBe('snap_img1');
    expect(sandbox.sizing).toMatchObject({ requested: { sizeClass }, resolved: { vcpus, memoryMiB }, provenance: 'adapter-declared' });
  });

  it('md without an image starts the built-in base, which is small', async () => {
    const { client, provider } = setup();
    const sandbox = await provider.instances.create({ sizeClass: 'md' });
    expect(sent(client, 'runs.start').snapshot).toBe('promigence/base');
    expect(client.names()).not.toContain('snapshots.create');
    expect(sandbox.sizing).toMatchObject({ resolved: { vcpus: 2, memoryMiB: 4096 } });
  });

  it.each(['lg', 'xl'] as const)('%s without an image is refused instead of booting the small base', async (sizeClass) => {
    const { client, provider } = setup();
    await expect(provider.instances.create({ sizeClass })).rejects.toMatchObject({ name: 'InstanceSizeError', code: 'requires-build' });
    expect(client.names()).not.toContain('runs.start');
    expect(client.names()).not.toContain('snapshots.create');
  });

  it.each([
    [{ templateId: 'myapp' }, {}],
    [{ snapshotId: 'snap_abc' }, {}],
    [{}, { snapshot: 'myapp@0123abc' }],
  ])('a snapshot (%o, config %o) keeps its own tier: sizeClass is unsupported', async (options, config) => {
    const { client, provider } = setup(config);
    await expect(provider.instances.create({ ...options, sizeClass: 'md' })).rejects.toMatchObject({ code: 'unsupported' });
    expect(client.names()).not.toContain('runs.start');
  });

  it.each(['xs', 'sm', '2xl', '3xl'] as const)('%s is refused on every path', async (sizeClass) => {
    const { client, provider } = setup();
    await expect(provider.instances.create({ image, sizeClass })).rejects.toMatchObject({ code: 'unknown' });
    await expect(provider.instances.create({ sizeClass })).rejects.toMatchObject({ code: 'unknown' });
    expect(client.names()).not.toContain('snapshots.create');
    expect(client.names()).not.toContain('runs.start');
  });

  it('rejects a native tier or CPU/RAM field alongside sizeClass', async () => {
    const { client, provider } = setup();
    await expect(provider.instances.create({ image, sizeClass: 'lg', tier: 'medium' })).rejects.toBeInstanceOf(InstanceSizeError);
    await expect(provider.instances.create({ image, sizeClass: 'lg', tier: 'medium' })).rejects.toMatchObject({ code: 'conflict' });
    expect(() => provider.sizes.resolve('lg', { image, tier: 'large' })).toThrow(InstanceSizeError);
    await expect(provider.instances.create({ image, sizeClass: 'lg', cpu: 4 })).rejects.toMatchObject({ code: 'conflict' });
    await expect(provider.instances.create({ image, sizeClass: 'lg', memory: 8192 })).rejects.toMatchObject({ code: 'conflict' });
    expect(client.names()).not.toContain('snapshots.create');
    expect(client.names()).not.toContain('runs.start');
  });

  it('without sizeClass the native tier path is unchanged', async () => {
    const { client, provider } = setup();
    const sandbox = await provider.instances.create({ image, tier: 'large' });
    expect(sent(client, 'snapshots.create')).toMatchObject({ tier: 'large' });
    expect(sandbox.sizing).toBeUndefined();
  });
});
