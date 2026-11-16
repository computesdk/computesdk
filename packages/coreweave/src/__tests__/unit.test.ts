import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandArgv, coreweave, createOptions, parseLs, templateBody } from '../index';

describe('coreweave create options', () => {
  it('maps image, cpu, memory, lifetime, env, name and ports', () => {
    expect(
      createOptions({ image: 'ubuntu:24.04' }, { cpu: 2, memory: 4096, timeout: 90_500, envs: { A: '1' }, name: 'demo', ports: [3000] })
    ).toEqual({
      containerImage: 'ubuntu:24.04',
      resources: { cpu: '2', memory: '4096Mi' },
      maxLifetimeSeconds: 91,
      environmentVariables: { A: '1' },
      annotations: { name: 'demo' },
      services: [{ port: 3000, visibility: 'public', endpoint: { kind: 'https', auth: 'open' } }],
      tags: ['computesdk'],
    });
  });

  it('leaves the SDK defaults alone when nothing is set', () => {
    expect(createOptions({}, {})).toEqual({ tags: ['computesdk'] });
  });

  it('lets a template bring its own image', () => {
    expect(createOptions({ image: 'ubuntu:24.04' }, { templateId: 'tpl' }).containerImage).toBeUndefined();
  });

  it('mounts a snapshot volume when asked', () => {
    expect(createOptions({ snapshotVolumeSize: '10Gi' }, { snapshotVolume: true } as any).fileSystemSnapshot).toEqual({ mountPath: '/work', size: '10Gi' });
    expect(createOptions({ snapshotVolume: true, snapshotMountPath: '/data' }, {}).fileSystemSnapshot).toEqual({ mountPath: '/data' });
  });

  it('restores a snapshot into the snapshot volume', () => {
    expect(createOptions({}, { snapshotId: 'fss_1' }).fileSystemSnapshot).toEqual({ mountPath: '/work', restoreFromSnapshotId: 'fss_1' });
  });
});

describe('coreweave commands', () => {
  it('runs through sh -c, passing env as separate env arguments', () => {
    expect(commandArgv('echo hi')).toEqual(['/bin/sh', '-c', 'echo hi']);
    expect(commandArgv('echo "$X"', { env: { X: `a b $y 'q'` } })).toEqual(['/usr/bin/env', `X=a b $y 'q'`, '/bin/sh', '-c', 'echo "$X"']);
  });

  it('detaches background commands', () => {
    expect(commandArgv('sleep 1', { background: true })).toEqual(['/bin/sh', '-c', 'nohup sh -c "sleep 1" >/dev/null 2>&1 &']);
  });

  it('rejects invalid environment variable names', () => {
    expect(() => commandArgv('true', { env: { 'BAD-NAME': '1' } })).toThrow(/Invalid environment variable name/);
  });
});

describe('coreweave readdir parsing', () => {
  it('parses ls -la output', () => {
    const out = [
      'total 8',
      'drwxr-xr-x 2 root root 4096 Jan  1 00:00 .',
      'drwxr-xr-x 3 root root 4096 Jan  1 00:00 ..',
      '-rw-r--r-- 1 root root    8 Jan  1 00:00 file 1.txt',
      'drwxr-xr-x 2 root root 4096 Jan  1 00:00 sub',
    ].join('\n');
    expect(parseLs(out)).toEqual([
      { name: 'file 1.txt', type: 'file', size: 8 },
      { name: 'sub', type: 'directory', size: 4096 },
    ]);
  });
});

describe('coreweave snapshots', () => {
  it('declares volume-scoped, forkable snapshots that keep the source', () => {
    expect(coreweave({}).snapshot?.capabilities).toMatchObject({
      scope: 'volume', path: '/work', memory: false, destroysSource: false, source: 'kept', fork: true,
      createOptions: { snapshotVolume: true },
    });
  });
});

describe('coreweave templates', () => {
  const record = { sandboxTemplateId: 'tpl-1', displayName: 'py', revision: '1', createTime: '2026-01-01T00:00:00Z', spec: { tags: ['x'] } };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds the template document', () => {
    expect(templateBody({ name: ' py ', image: 'python:3.12', spec: { maxLifetimeSeconds: 60 } })).toEqual({
      displayName: 'py',
      spec: { maxLifetimeSeconds: 60, containers: [{ name: 'main', image: 'python:3.12' }] },
    });
    expect(() => templateBody({ name: '' })).toThrow(/name is required/);
    expect(() => templateBody({ name: 'a', description: 'd' })).toThrow(/no description or metadata/);
    expect(() => templateBody({ name: 'a', image: 'x', spec: { containers: [] } })).toThrow(/not both/);
  });

  it('creates a template on the control plane', async () => {
    const fetch = vi.fn(async () => json(record));
    vi.stubGlobal('fetch', fetch);
    const tpl = await coreweave({ apiKey: 'k' }).template!.create({ name: 'py', image: 'python:3.12', requestId: 'r 1' } as any);
    expect(tpl).toEqual({ id: 'tpl-1', name: 'py', provider: 'coreweave', revision: '1', createdAt: new Date('2026-01-01T00:00:00Z'), spec: { tags: ['x'] } });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.coreweave.com/v1/sandboxTemplates?requestId=r%201');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer k', 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ displayName: 'py', spec: { containers: [{ name: 'main', image: 'python:3.12' }] } });
  });

  it('pages through templates and honours limit', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ sandboxTemplates: [record], nextPageToken: 'next' }))
      .mockResolvedValueOnce(json({ sandboxTemplates: [{ ...record, sandboxTemplateId: 'tpl-2' }] }));
    vi.stubGlobal('fetch', fetch);
    const all = await coreweave({ apiKey: 'k', controlPlaneUrl: 'https://cp.test/' }).template!.list();
    expect(all.map((t) => t.id)).toEqual(['tpl-1', 'tpl-2']);
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(['https://cp.test/v1/sandboxTemplates', 'https://cp.test/v1/sandboxTemplates?pageToken=next']);

    fetch.mockReset().mockResolvedValueOnce(json({ sandboxTemplates: [record], nextPageToken: 'next' }));
    expect((await coreweave({ apiKey: 'k' }).template!.list({ limit: 1 })).map((t) => t.id)).toEqual(['tpl-1']);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://api.coreweave.com/v1/sandboxTemplates?pageSize=1');
  });

  it('deletes templates idempotently and surfaces API errors', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ code: 5, message: 'not found' }, 404))
      .mockResolvedValueOnce(json({ code: 7, message: 'requires sandbox_admin' }, 403));
    vi.stubGlobal('fetch', fetch);
    const provider = coreweave({ apiKey: 'k' });
    await expect(provider.template!.delete('tpl-1')).resolves.toBeUndefined();
    expect(fetch.mock.calls[0][0]).toBe('https://api.coreweave.com/v1/sandboxTemplates/tpl-1');
    expect((fetch.mock.calls[0][1] as RequestInit).method).toBe('DELETE');
    await expect(provider.template!.delete('tpl-1')).rejects.toThrow(/403.*requires sandbox_admin/);
  });
});

describe('coreweave config', () => {
  it('asks for an API key when none is set', async () => {
    const saved = process.env.CWSANDBOX_API_KEY;
    delete process.env.CWSANDBOX_API_KEY;
    try {
      await expect(coreweave({}).sandbox.create()).rejects.toThrow(/CWSANDBOX_API_KEY/);
    } finally {
      if (saved !== undefined) process.env.CWSANDBOX_API_KEY = saved;
    }
  });
});
