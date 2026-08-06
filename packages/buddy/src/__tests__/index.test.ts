import { describe, expect, it } from 'vitest';
import { runProviderTestSuite } from '@computesdk/test-utils';

import { buddy } from '../index';
import { buildShellCommand, runCommand } from '../commands';
import {
  apiUrlForRegion,
  isInstanceNotRunning,
  isNotFound,
  isUnroutableId,
  mapStatus,
  normalizePort,
  normalizeSandboxPath,
  resolveConfig,
  resolveResources,
  toContentPath,
  toIdentifier,
} from '../utils';

runProviderTestSuite({
  name: 'buddy',
  provider: buddy({}),
  supportsFilesystem: true,
  skipIntegration: !process.env.BUDDY_TOKEN
    || !process.env.BUDDY_WORKSPACE
    || !process.env.BUDDY_PROJECT,
});

describe('config resolution', () => {
  it('names the missing credential in the error', () => {
    // The env-var fallbacks have to be out of the way for this to be about the
    // config object alone.
    const saved = {
      BUDDY_TOKEN: process.env.BUDDY_TOKEN,
      BUDDY_WORKSPACE: process.env.BUDDY_WORKSPACE,
      BUDDY_PROJECT: process.env.BUDDY_PROJECT,
    };
    delete process.env.BUDDY_TOKEN;
    delete process.env.BUDDY_WORKSPACE;
    delete process.env.BUDDY_PROJECT;

    try {
      expect(() => resolveConfig({ workspace: 'w', project: 'p' })).toThrow(/token/i);
      expect(() => resolveConfig({ token: 't', project: 'p' })).toThrow(/workspace/i);
      expect(() => resolveConfig({ token: 't', workspace: 'w' })).toThrow(/project/i);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('defaults to the US installation and applies the region host', () => {
    const base = { token: 't', workspace: 'w', project: 'p' };
    expect(resolveConfig({ ...base }).apiUrl).toBe('https://api.buddy.works');
    expect(resolveConfig({ ...base, region: 'EU' }).apiUrl).toBe('https://api.eu.buddy.works');
    expect(apiUrlForRegion('AS')).toBe('https://api.asia.buddy.works');
  });

  it('lets apiUrl override the region and strips trailing slashes', () => {
    const config = resolveConfig({
      token: 't', workspace: 'w', project: 'p', region: 'EU', apiUrl: 'https://buddy.internal/',
    });
    expect(config.apiUrl).toBe('https://buddy.internal');
    // The region still decides where tunnels terminate.
    expect(config.region).toBe('EU');
  });

  it('reuses the resolved config for the same config object', () => {
    const raw = { token: 't', workspace: 'w', project: 'p' };
    expect(resolveConfig(raw)).toBe(resolveConfig(raw));
  });
});

describe('resource presets', () => {
  const cases: Array<[Record<string, unknown>, string | undefined]> = [
    [{}, undefined],
    [{ cpu: 2 }, '2x4'],
    [{ memory: 8192 }, '4x8'],
    // The larger of the two requests wins, since Buddy ties RAM to vCPU.
    [{ cpu: 1, memory: 8192 }, '4x8'],
    [{ cpu: 40 }, '12x24'],
    [{ resources: '3x6' }, '3x6'],
  ];

  it.each(cases)('maps %j to %s', (options, expected) => {
    expect(resolveResources(options)).toBe(expected);
  });

  it('falls back to the provider default', () => {
    expect(resolveResources({}, '2x4')).toBe('2x4');
  });
});

describe('paths', () => {
  it('resolves relative paths against the sandbox home', () => {
    expect(normalizeSandboxPath('app/index.js')).toBe('/buddy/app/index.js');
    expect(normalizeSandboxPath('/etc//hosts')).toBe('/etc/hosts');
  });

  it('rejects the root', () => {
    expect(() => normalizeSandboxPath('/')).toThrow();
  });

  it('drops the leading slash for content endpoints', () => {
    expect(toContentPath('/buddy/a.txt')).toBe('buddy/a.txt');
  });
});

describe('command building', () => {
  it('passes a plain command through', () => {
    expect(buildShellCommand('ls -la')).toBe('ls -la');
  });

  it('prepends cwd and env', () => {
    expect(buildShellCommand('node app.js', { cwd: '/buddy/app', env: { PORT: '3000' } }))
      .toBe('cd "/buddy/app" && export PORT="3000" && node app.js');
  });

  it('neutralises quotes in env values', () => {
    expect(buildShellCommand('echo hi', { env: { A: 'a"b' } })).not.toBe('export A="a"b" && echo hi');
  });

  it('rejects the outdated argument-array call shape', async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runCommand({} as any, 'echo', ['hello-args'] as any),
    ).rejects.toThrow(/not an argument array/);
  });
});

describe('status mapping', () => {
  it('treats a starting sandbox as running, because commands queue', () => {
    expect(mapStatus('STARTING')).toBe('running');
    expect(mapStatus('RESTORING')).toBe('running');
    expect(mapStatus('RUNNING')).toBe('running');
    expect(mapStatus('STOPPED')).toBe('stopped');
    expect(mapStatus('FAILED')).toBe('error');
    expect(mapStatus(undefined)).toBe('stopped');
  });
});

describe('error predicates', () => {
  it('recognises a missing entity from either error shape', () => {
    expect(isNotFound(Object.assign(new Error('HTTP 404: nope'), { status: 404 }))).toBe(true);
    expect(isNotFound(Object.assign(new Error('nope'), { statusCode: 404 }))).toBe(true);
    // The content endpoints report a missing path as 400.
    expect(isNotFound(Object.assign(new Error('Path not find in browser'), { status: 400 }))).toBe(true);
    expect(isNotFound(Object.assign(new Error('boom'), { status: 500 }))).toBe(false);
  });

  it('recognises an id Buddy cannot even route', () => {
    const error = Object.assign(new Error('HTTP 400: Invalid url: /workspaces/w/sandboxes/nope'), { status: 400 });
    expect(isUnroutableId(error)).toBe(true);
    expect(isUnroutableId(Object.assign(new Error('Invalid url'), { status: 404 }))).toBe(false);
  });

  it('recognises the boot race', () => {
    const error = Object.assign(new Error('HTTP 400: Instance is not running'), { status: 400 });
    expect(isInstanceNotRunning(error)).toBe(true);
    expect(isInstanceNotRunning(Object.assign(new Error('other'), { status: 400 }))).toBe(false);
  });
});

describe('ports', () => {
  it('defaults a bare port to an HTTP tunnel in the configured region', () => {
    const config = resolveConfig({ token: 't', workspace: 'w', project: 'p', region: 'EU' });
    expect(normalizePort(3000, config)).toEqual({
      port: 3000, name: 'p3000', type: 'HTTP', region: 'EU',
    });
  });
});

describe('identifiers', () => {
  it('follows the identifier rules Buddy enforces', () => {
    expect(toIdentifier('ComputeSDK Test #1')).toBe('computesdk-test-1');
    expect(toIdentifier('!!!')).toBe('computesdk');
  });
});
