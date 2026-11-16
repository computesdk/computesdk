import { describe, expect, it } from 'vitest';
import { commandArgv, coreweave, createOptions, parseLs } from '../index';

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

  it('refuses snapshot restores', () => {
    expect(() => createOptions({}, { snapshotId: 'snap' })).toThrow(/does not restore snapshots/);
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
