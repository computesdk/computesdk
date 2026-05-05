import { describe, it, expect, vi } from 'vitest';
import { defineSetup, deps } from '../setup';
import { applySetup } from '../apply-setup';
import { compute, type DirectProvider } from '../compute';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

function makeSandbox(overrides: { runCommand?: any; filesystem?: any } = {}) {
  return {
    sandboxId: 'sb-1',
    provider: 'mock',
    filesystem: {
      readFile: vi.fn(),
      writeFile: vi.fn(async () => {}),
      mkdir: vi.fn(async () => {}),
      readdir: vi.fn(),
      exists: vi.fn(),
      remove: vi.fn(),
      ...overrides.filesystem,
    },
    runCommand: overrides.runCommand ?? vi.fn(async () => ({
      stdout: '', stderr: '', exitCode: 0, durationMs: 1,
    })),
    getInfo: vi.fn(),
    getUrl: vi.fn(),
    destroy: vi.fn(async () => {}),
  } as any;
}

describe('defineSetup', () => {
  it('returns a frozen value object', () => {
    const setup = defineSetup({
      deps: [deps.python],
      install: 'pip install foo',
      env: { API_KEY: 'k' },
    });
    expect(Object.isFrozen(setup)).toBe(true);
    expect(Object.isFrozen(setup.deps)).toBe(true);
    expect(Object.isFrozen(setup.env)).toBe(true);
    expect(() => {
      (setup as any).install = 'mutated';
    }).toThrow();
  });

  it('freezes nested source and resources', () => {
    const setup = defineSetup({
      source: { type: 'github', repo: 'a/b', ref: 'main' },
      resources: { cpu: 2, memory: '4gb' },
    });
    expect(Object.isFrozen(setup.source)).toBe(true);
    expect(Object.isFrozen(setup.resources)).toBe(true);
  });

  it('preserves install as string vs array', () => {
    expect(defineSetup({ install: 'a' }).install).toBe('a');
    const arr = defineSetup({ install: ['a', 'b'] }).install;
    expect(arr).toEqual(['a', 'b']);
    expect(Object.isFrozen(arr)).toBe(true);
  });
});

describe('deps registry', () => {
  it('exposes curated deps as frozen values', () => {
    expect(deps.python).toEqual({ name: 'python', nixPkg: 'python3' });
    expect(deps.ffmpeg).toEqual({ name: 'ffmpeg', nixPkg: 'ffmpeg' });
    expect(Object.isFrozen(deps.python)).toBe(true);
  });

  it('exposes deps.nix as escape hatch for arbitrary nix packages', () => {
    const dep = deps.nix('imagemagickBig');
    expect(dep).toEqual({ name: 'imagemagickBig', nixPkg: 'imagemagickBig' });
    expect(Object.isFrozen(dep)).toBe(true);
  });
});

describe('applySetup', () => {
  it('clones a github source with depth=1 and the given ref', async () => {
    const sandbox = makeSandbox();
    await applySetup(sandbox, {
      source: { type: 'github', repo: 'acme/my-app', ref: 'main' },
    });
    expect(sandbox.runCommand).toHaveBeenCalledWith(
      "git clone --depth 1 --branch 'main' 'https://github.com/acme/my-app.git' .",
      undefined,
    );
  });

  it('omits --branch when ref is missing', async () => {
    const sandbox = makeSandbox();
    await applySetup(sandbox, { source: { type: 'github', repo: 'acme/my-app' } });
    expect(sandbox.runCommand).toHaveBeenCalledWith(
      "git clone --depth 1 'https://github.com/acme/my-app.git' .",
      undefined,
    );
  });

  it('extracts a tarball via curl | tar', async () => {
    const sandbox = makeSandbox();
    await applySetup(sandbox, { source: { type: 'tar', url: 'https://x.test/a.tgz' } });
    expect(sandbox.runCommand).toHaveBeenCalledWith(
      "curl -fsSL 'https://x.test/a.tgz' | tar -xz -C .",
      undefined,
    );
  });

  it('uploads a local directory recursively (text files only)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'setup-test-'));
    try {
      await fs.writeFile(path.join(tmp, 'a.txt'), 'hello');
      await fs.mkdir(path.join(tmp, 'sub'));
      await fs.writeFile(path.join(tmp, 'sub', 'b.txt'), 'world');
      const sandbox = makeSandbox();
      await applySetup(sandbox, { source: { type: 'local', path: tmp } });
      expect(sandbox.filesystem.writeFile).toHaveBeenCalledWith('a.txt', 'hello');
      expect(sandbox.filesystem.mkdir).toHaveBeenCalledWith('sub');
      expect(sandbox.filesystem.writeFile).toHaveBeenCalledWith('sub/b.txt', 'world');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('installs each dep via nix profile install', async () => {
    const sandbox = makeSandbox();
    await applySetup(sandbox, { deps: [deps.python, deps.ffmpeg] });
    const calls = sandbox.runCommand.mock.calls.map((c: any[]) => c[0]);
    expect(calls).toContain("nix profile install 'nixpkgs#python3'");
    expect(calls).toContain("nix profile install 'nixpkgs#ffmpeg'");
  });

  it('runs install command with env and string form', async () => {
    const sandbox = makeSandbox();
    await applySetup(sandbox, {
      install: 'pip install -r requirements.txt',
      env: { API_KEY: 'abc' },
    });
    expect(sandbox.runCommand).toHaveBeenCalledWith(
      'pip install -r requirements.txt',
      { env: { API_KEY: 'abc' } },
    );
  });

  it('runs install commands sequentially when given an array', async () => {
    const order: string[] = [];
    const sandbox = makeSandbox({
      runCommand: vi.fn(async (cmd: string) => {
        order.push(cmd);
        return { stdout: '', stderr: '', exitCode: 0, durationMs: 1 };
      }),
    });
    await applySetup(sandbox, { install: ['echo 1', 'echo 2', 'echo 3'] });
    expect(order).toEqual(['echo 1', 'echo 2', 'echo 3']);
  });

  it('throws when a setup step exits non-zero', async () => {
    const sandbox = makeSandbox({
      runCommand: vi.fn(async () => ({
        stdout: '', stderr: 'boom', exitCode: 42, durationMs: 1,
      })),
    });
    await expect(
      applySetup(sandbox, { install: 'false' }),
    ).rejects.toThrow(/exit 42/);
  });

  it('runs source -> deps -> install in that order', async () => {
    const order: string[] = [];
    const sandbox = makeSandbox({
      runCommand: vi.fn(async (cmd: string) => {
        order.push(cmd);
        return { stdout: '', stderr: '', exitCode: 0, durationMs: 1 };
      }),
    });
    await applySetup(sandbox, {
      source: { type: 'github', repo: 'a/b' },
      deps: [deps.python],
      install: 'pip install -r r.txt',
    });
    expect(order[0]).toMatch(/^git clone/);
    expect(order[1]).toMatch(/^nix profile install/);
    expect(order[2]).toBe('pip install -r r.txt');
  });

  it('quotes shell metacharacters in source urls so the shell does not interpret them', async () => {
    const sandbox = makeSandbox();
    await applySetup(sandbox, {
      source: { type: 'tar', url: "https://x.test/a.tgz; rm -rf /" },
    });
    // The full url should appear inside a single-quoted argument, so the shell
    // sees one literal string rather than two commands.
    expect(sandbox.runCommand).toHaveBeenCalledWith(
      "curl -fsSL 'https://x.test/a.tgz; rm -rf /' | tar -xz -C .",
      undefined,
    );
  });

  it('escapes embedded single quotes in user-provided strings', async () => {
    const sandbox = makeSandbox();
    await applySetup(sandbox, {
      source: { type: 'github', repo: "a/b", ref: "weird'branch" },
    });
    const cmd = (sandbox.runCommand as any).mock.calls[0][0] as string;
    // The escaped form is '\'' — the ref must round-trip cleanly through the shell.
    expect(cmd).toContain("--branch 'weird'\\''branch'");
  });
});

describe('compute.sandbox.create with setup', () => {
  it('runs applySetup after the provider creates the sandbox', async () => {
    const runCommand = vi.fn(async () => ({
      stdout: '', stderr: '', exitCode: 0, durationMs: 1,
    }));
    const sandbox = makeSandbox({ runCommand });
    const provider: DirectProvider = {
      name: 'mock',
      sandbox: {
        create: vi.fn(async () => sandbox),
        getById: async () => null,
        destroy: async () => {},
      },
    };
    compute.setConfig({ providers: [provider] });

    const setup = defineSetup({ install: 'echo hi' });
    const result = await compute.sandbox.create({ setup });

    expect(result).toBe(sandbox);
    expect(runCommand).toHaveBeenCalledWith('echo hi', undefined);
  });

  it('merges setup.env into options.envs (user envs win)', async () => {
    const create = vi.fn(async () => makeSandbox());
    const provider: DirectProvider = {
      name: 'mock',
      sandbox: { create, getById: async () => null, destroy: async () => {} },
    };
    compute.setConfig({ providers: [provider] });

    await compute.sandbox.create({
      setup: defineSetup({ env: { A: 'from-setup', B: 'from-setup' } }),
      envs: { A: 'from-user' },
    });

    const passedOptions = (create as any).mock.calls[0][0];
    expect(passedOptions.envs).toEqual({ A: 'from-user', B: 'from-setup' });
  });

  it('destroys the sandbox if applySetup fails', async () => {
    const destroy = vi.fn(async () => {});
    const sandbox = makeSandbox({
      runCommand: vi.fn(async () => ({
        stdout: '', stderr: 'install failed', exitCode: 1, durationMs: 1,
      })),
    });
    sandbox.destroy = destroy;
    const provider: DirectProvider = {
      name: 'mock',
      sandbox: {
        create: async () => sandbox,
        getById: async () => null,
        destroy: async () => {},
      },
    };
    compute.setConfig({ providers: [provider], fallbackOnError: false });

    await expect(
      compute.sandbox.create({ setup: defineSetup({ install: 'false' }) }),
    ).rejects.toThrow(/Setup step failed/);
    expect(destroy).toHaveBeenCalled();
  });
});
