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
  it('fetches a github source at depth=1 for the given branch ref', async () => {
    const sandbox = makeSandbox();
    await applySetup(sandbox, {
      source: { type: 'github', repo: 'acme/my-app', ref: 'main' },
    });
    expect(sandbox.runCommand).toHaveBeenCalledWith(
      "git init -q && " +
        "git remote add origin 'https://github.com/acme/my-app.git' && " +
        "git fetch --depth 1 origin 'main' && " +
        "git checkout -q FETCH_HEAD",
      undefined,
    );
  });

  it('fetches a github source at a 40-char commit SHA (pinning works)', async () => {
    const sandbox = makeSandbox();
    const sha = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
    await applySetup(sandbox, {
      source: { type: 'github', repo: 'acme/my-app', ref: sha },
    });
    expect(sandbox.runCommand).toHaveBeenCalledWith(
      "git init -q && " +
        "git remote add origin 'https://github.com/acme/my-app.git' && " +
        `git fetch --depth 1 origin '${sha}' && ` +
        "git checkout -q FETCH_HEAD",
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

  it('uploads valid multi-byte UTF-8 text without rejection', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'setup-test-'));
    try {
      // 'héllo 🌍' exercises 2-byte and 4-byte UTF-8 sequences — must not be
      // mistaken for non-UTF-8 by the binary check.
      await fs.writeFile(path.join(tmp, 'a.txt'), 'héllo 🌍');
      const sandbox = makeSandbox();
      await applySetup(sandbox, { source: { type: 'local', path: tmp } });
      expect(sandbox.filesystem.writeFile).toHaveBeenCalledWith('a.txt', 'héllo 🌍');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('throws a clear error for files containing NUL bytes (binary)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'setup-test-'));
    try {
      await fs.writeFile(path.join(tmp, 'logo.png'), Buffer.from([0x00, 0x01, 0x02, 0x03]));
      const sandbox = makeSandbox();
      await expect(
        applySetup(sandbox, { source: { type: 'local', path: tmp } }),
      ).rejects.toThrow(/Cannot upload binary file.*logo\.png/);
      expect(sandbox.filesystem.writeFile).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('throws a clear error for symlinks (would otherwise silently drop)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'setup-test-'));
    try {
      // Dangling symlink — readdir still surfaces it and isSymbolicLink() is
      // true regardless of whether the target exists.
      await fs.symlink('nonexistent-target', path.join(tmp, 'link.txt'));
      const sandbox = makeSandbox();
      await expect(
        applySetup(sandbox, { source: { type: 'local', path: tmp } }),
      ).rejects.toThrow(/Cannot upload symlink.*link\.txt/);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('throws a clear error for files with invalid UTF-8 byte sequences', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'setup-test-'));
    try {
      // PNG magic header: 0x89 is an invalid UTF-8 leading byte. No NUL, so this
      // exercises the TextDecoder path rather than the NUL-byte fast path.
      await fs.writeFile(path.join(tmp, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const sandbox = makeSandbox();
      await expect(
        applySetup(sandbox, { source: { type: 'local', path: tmp } }),
      ).rejects.toThrow(/Cannot upload non-UTF-8 file.*logo\.png/);
      expect(sandbox.filesystem.writeFile).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('installs all deps in a single batched nix profile install', async () => {
    const sandbox = makeSandbox();
    await applySetup(sandbox, { deps: [deps.python, deps.ffmpeg] });
    const calls = sandbox.runCommand.mock.calls.map((c: any[]) => c[0]);
    // One invocation, both installables — pays Nix eval cost once and lets
    // builds/fetches parallelize across the list.
    const nixCalls = calls.filter((c: string) => c.startsWith('nix profile install'));
    expect(nixCalls).toEqual([
      "nix profile install 'nixpkgs#python3' 'nixpkgs#ffmpeg'",
    ]);
  });

  it('skips nix profile install entirely when deps is empty', async () => {
    const sandbox = makeSandbox();
    await applySetup(sandbox, { deps: [] });
    const calls = sandbox.runCommand.mock.calls.map((c: any[]) => c[0]);
    expect(calls.some((c: string) => c.startsWith('nix profile install'))).toBe(false);
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
    expect(cmd).toContain("git fetch --depth 1 origin 'weird'\\''branch'");
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

  it('does not forward setup to the provider create call', async () => {
    const create = vi.fn(async () => makeSandbox());
    const provider: DirectProvider = {
      name: 'mock',
      sandbox: { create, getById: async () => null, destroy: async () => {} },
    };
    compute.setConfig({ providers: [provider] });

    await compute.sandbox.create({
      setup: defineSetup({
        source: { type: 'github', repo: 'a/b' },
        install: 'echo hi',
      }),
      envs: { USER_VAR: 'v' },
    });

    const passedOptions = (create as any).mock.calls[0][0];
    expect(passedOptions).not.toHaveProperty('setup');
    expect(passedOptions.envs).toEqual({ USER_VAR: 'v' });
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

  it('runs setup commands with the merged env (user envs win on conflict)', async () => {
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

    await compute.sandbox.create({
      envs: { A: 'user', USER_ONLY: 'u' },
      setup: defineSetup({
        env: { A: 'setup', SETUP_ONLY: 's' },
        install: 'echo hi',
      }),
    });

    expect(runCommand).toHaveBeenCalledWith('echo hi', {
      env: { A: 'user', SETUP_ONLY: 's', USER_ONLY: 'u' },
    });
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
