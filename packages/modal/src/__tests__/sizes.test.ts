/**
 * Modal standard size mapping (mock-only; no API keys, no sandboxes).
 *
 * Ways the mapping could fail, each covered below:
 * 1. Wrong shape: `cpu` taken as vCPUs, but Modal counts physical cores
 *    (1 core = 2 vCPUs), doubling every size; or memory not the profile's MiB.
 * 2. Shape is only a floor: without `cpuLimit`/`memoryLimitMiB` Modal lets the
 *    Sandbox burst (default CPU limit is the request + 16 cores).
 * 3. Silent default boot: the resolver's nativeOptions never reach
 *    `client.sandboxes.create`, on the default image or the snapshot/template branch.
 * 4. Dropped or leaked field: `sizeClass` forwarded to Modal, or the caller's
 *    unrelated options (envs, gpu, runtime) lost.
 * 5. Conflict accepted: a native `cpu`, `cpuLimit`, `memoryMiB`, `memory` or
 *    `memoryLimitMiB` silently overrides or is overridden by `sizeClass`.
 * 6. Hidden shrink: a VM sidecar memory reserve boots the main VM below the size.
 * 7. Discovery side effects: list/resolve constructs a client call or app lookup.
 * 8. Unrequested sizing: creates without `sizeClass` gain resource fields.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const state = { calls: [] as { method: string; args: any[] }[] };
  const record = (method: string, ...args: any[]) => state.calls.push({ method, args });
  const image = (id: string) => ({ imageId: id, build: async () => image(id) });
  class ModalClient {
    apps = { fromName: async (...args: any[]) => { record('apps.fromName', ...args); return { appId: 'ap-1' }; } };
    images = {
      fromId: async (id: string) => { record('images.fromId', id); return image(id); },
      fromRegistry: (tag: string) => { record('images.fromRegistry', tag); return image(tag); },
    };
    sandboxes = {
      create: async (...args: any[]) => { record('sandboxes.create', ...args); return { sandboxId: `sb-${state.calls.length}` }; },
    };
    volumes = { fromName: async () => ({}) };
  }
  class NotFoundError extends Error {}
  class SandboxFilesystemNotFoundError extends Error {}
  return { state, ModalClient, NotFoundError, SandboxFilesystemNotFoundError };
});

vi.mock('modal', () => ({
  ModalClient: h.ModalClient,
  NotFoundError: h.NotFoundError,
  SandboxFilesystemNotFoundError: h.SandboxFilesystemNotFoundError,
}));

import { modal } from '../index';

const DISK_MIB = 524288;
const profiles = [
  ['xs', 1, 1024, 0.5], ['sm', 1, 2048, 0.5], ['md', 2, 4096, 1], ['lg', 4, 8192, 2],
  ['xl', 8, 16384, 4], ['2xl', 16, 32768, 8], ['3xl', 32, 65536, 16],
] as const;

let n = 0;
const provider = () => modal({ tokenId: 't', tokenSecret: 's', appName: `sizes-${n++}` });
const creates = () => h.state.calls.filter(c => c.method === 'sandboxes.create');

describe('Modal standard size mapping (mock-only)', () => {
  beforeEach(() => { h.state.calls.length = 0; });

  it('discovers every standard size without API calls', () => {
    const sizes = provider().sizes;
    const list = sizes.list();
    expect(list.map(r => [r.requested.sizeClass, r.status])).toEqual(profiles.map(([c]) => [c, 'supported']));
    expect(h.state.calls).toEqual([]);
  });

  it.each(profiles)('resolves %s to %i vCPU (%i MiB) as %f physical cores with matching limits', (sizeClass, vcpus, memoryMiB, cores) => {
    expect(provider().sizes.resolve(sizeClass)).toMatchObject({
      status: 'supported',
      nativeOptions: { cpu: cores, cpuLimit: cores, memoryMiB, memoryLimitMiB: memoryMiB },
      resolved: { vcpus, memoryMiB, diskMiB: DISK_MIB },
      provenance: 'adapter-declared',
    });
  });

  it.each(profiles)('forwards %s resources to sandboxes.create', async (sizeClass, vcpus, memoryMiB, cores) => {
    const sandbox = await provider().instances.create({ sizeClass, envs: { A: '1' } });
    const [call] = creates();
    const params = call.args[2];
    expect(params).toMatchObject({ cpu: cores, cpuLimit: cores, memoryMiB, memoryLimitMiB: memoryMiB, runtime: 'vm', env: { A: '1' } });
    expect(params).not.toHaveProperty('sizeClass');
    expect(sandbox.sizing).toEqual({
      requested: { sizeClass, vcpus, memoryMiB }, resolved: { vcpus, memoryMiB, diskMiB: DISK_MIB }, provenance: 'adapter-declared',
    });
  });

  it.each([{ snapshotId: 'im-snap' }, { templateId: 'python:3.13-slim' }])('forwards resources on the image source branch %j', async source => {
    await provider().instances.create({ sizeClass: 'lg', ...source });
    expect(creates()[0].args[2]).toMatchObject({ cpu: 2, cpuLimit: 2, memoryMiB: 8192, memoryLimitMiB: 8192 });
  });

  it('keeps unrelated native options such as gpu/runtime', async () => {
    await provider().instances.create({ sizeClass: 'md', gpu: 'T4' } as any);
    expect(creates()[0].args[2]).toMatchObject({ cpu: 1, memoryMiB: 4096, gpu: 'T4', runtime: 'gvisor' });
  });

  it.each([
    { cpu: 1 }, { cpuLimit: 2 }, { memoryMiB: 2048 }, { memory: 2048 }, { memoryLimitMiB: 4096 },
  ])('rejects conflicting native resource field %j before any API call', async native => {
    await expect(provider().instances.create({ sizeClass: 'sm', ...native } as any))
      .rejects.toMatchObject({ name: 'InstanceSizeError', code: 'conflict', fallback: false });
    expect(h.state.calls).toEqual([]);
  });

  it('refuses a VM sidecar memory reserve that would shrink the main VM', async () => {
    const options = { sizeClass: 'md', experimentalOptions: { vm_sidecar_memory_reserve_mib: '1024' } } as any;
    expect(provider().sizes.resolve('md', options)).toMatchObject({ status: 'unsupported' });
    await expect(provider().instances.create(options)).rejects.toMatchObject({ code: 'unsupported', fallback: false });
    expect(creates()).toEqual([]);
  });

  it('rejects an invalid size class', async () => {
    await expect(provider().instances.create({ sizeClass: 'huge' } as any)).rejects.toMatchObject({ code: 'invalid' });
    expect(creates()).toEqual([]);
  });

  it('adds no resource fields without sizeClass and passes native ones through', async () => {
    const p = provider();
    await p.instances.create();
    await p.instances.create({ cpu: 3, memoryMiB: 1234 } as any);
    const [plain, native] = creates().map(c => c.args[2]);
    for (const key of ['cpu', 'cpuLimit', 'memoryMiB', 'memoryLimitMiB']) expect(plain).not.toHaveProperty(key);
    expect(native).toMatchObject({ cpu: 3, memoryMiB: 1234 });
    expect(native).not.toHaveProperty('cpuLimit');
  });
});
