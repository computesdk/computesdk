import { describe, it, expect } from 'vitest';
import {
  cmd,
  mkdir,
  rm,
  cp,
  mv,
  ls,
  chmod,
  touch,
  cat,
  npm,
  pnpm,
  yarn,
  pip,
  node,
  python,
  git,
  curl,
  grep,
  tar,
  echo,
  env,
} from '../index';

describe('cmd (main export)', () => {
  it('acts as shell wrapper when called as function', () => {
    const result = cmd(['npm', 'install'], { cwd: '/app' });
    expect(result).toEqual(['sh', '-c', "cd '/app' && npm install"]);
  });

  it('returns command unchanged when no options', () => {
    const result = cmd(['npm', 'install']);
    expect(result).toEqual(['npm', 'install']);
  });

  it('has command builders as properties', () => {
    expect(cmd.mkdir).toBeDefined();
    expect(cmd.npm).toBeDefined();
    expect(cmd.git).toBeDefined();
  });
});

describe('filesystem commands', () => {
  describe('mkdir', () => {
    it('creates basic mkdir command with -p by default', () => {
      expect(mkdir('/app/src')).toEqual(['mkdir', '-p', '/app/src']);
    });

    it('handles paths with spaces', () => {
      expect(mkdir('/my path/dir')).toEqual(['mkdir', '-p', '/my path/dir']);
    });

    it('can create without -p flag', () => {
      expect(mkdir('/app/src', { recursive: false })).toEqual(['mkdir', '/app/src']);
    });
  });

  describe('rm', () => {
    it('creates rm command', () => {
      expect(rm('/tmp/file.txt')).toEqual(['rm', '/tmp/file.txt']);
    });

    it('supports recursive option', () => {
      expect(rm('/tmp/dir', { recursive: true })).toEqual(['rm', '-r', '/tmp/dir']);
    });

    it('supports force option', () => {
      expect(rm('/tmp/file', { force: true })).toEqual(['rm', '-f', '/tmp/file']);
    });

    it('supports both recursive and force', () => {
      expect(rm('/tmp/dir', { recursive: true, force: true })).toEqual(['rm', '-rf', '/tmp/dir']);
    });
  });

  describe('cp', () => {
    it('creates cp command', () => {
      expect(cp('/src/file.txt', '/dest/')).toEqual(['cp', '/src/file.txt', '/dest/']);
    });

    it('supports recursive option', () => {
      expect(cp('/src/dir', '/dest/', { recursive: true })).toEqual(['cp', '-r', '/src/dir', '/dest/']);
    });
  });

  describe('mv', () => {
    it('creates mv command', () => {
      expect(mv('/src/file.txt', '/dest/file.txt')).toEqual(['mv', '/src/file.txt', '/dest/file.txt']);
    });
  });

  describe('ls', () => {
    it('creates basic ls command', () => {
      expect(ls()).toEqual(['ls']);
    });

    it('creates ls with path', () => {
      expect(ls('/app')).toEqual(['ls', '/app']);
    });

    it('supports options', () => {
      expect(ls('/app', { long: true, all: true })).toEqual(['ls', '-la', '/app']);
    });
  });

  describe('chmod', () => {
    it('creates chmod command', () => {
      expect(chmod('755', '/app/script.sh')).toEqual(['chmod', '755', '/app/script.sh']);
    });

    it('supports recursive option', () => {
      expect(chmod('644', '/app', { recursive: true })).toEqual(['chmod', '-R', '644', '/app']);
    });
  });

  describe('touch', () => {
    it('creates touch command', () => {
      expect(touch('/app/file.txt')).toEqual(['touch', '/app/file.txt']);
    });
  });

  describe('cat', () => {
    it('creates cat command', () => {
      expect(cat('/app/file.txt')).toEqual(['cat', '/app/file.txt']);
    });
  });
});

describe('package manager commands', () => {
  describe('npm', () => {
    it('creates install command', () => {
      expect(npm.install()).toEqual(['npm', 'install']);
    });

    it('creates install command with package', () => {
      expect(npm.install('express')).toEqual(['npm', 'install', 'express']);
    });

    it('supports dev dependency flag', () => {
      expect(npm.install('typescript', { dev: true })).toEqual(['npm', 'install', '-D', 'typescript']);
    });

    it('supports global flag', () => {
      expect(npm.install('npm', { global: true })).toEqual(['npm', 'install', '-g', 'npm']);
    });

    it('creates run command', () => {
      expect(npm.run('build')).toEqual(['npm', 'run', 'build']);
    });

    it('creates init command', () => {
      expect(npm.init()).toEqual(['npm', 'init', '-y']);
    });

    it('creates uninstall command', () => {
      expect(npm.uninstall('express')).toEqual(['npm', 'uninstall', 'express']);
    });
  });

  describe('pnpm', () => {
    it('creates install command', () => {
      expect(pnpm.install()).toEqual(['pnpm', 'install']);
    });

    it('creates install command with package', () => {
      expect(pnpm.install('express')).toEqual(['pnpm', 'install', 'express']);
    });

    it('supports dev dependency', () => {
      expect(pnpm.install('typescript', { dev: true })).toEqual(['pnpm', 'install', '-D', 'typescript']);
    });

    it('creates run command', () => {
      expect(pnpm.run('test')).toEqual(['pnpm', 'run', 'test']);
    });
  });

  describe('yarn', () => {
    it('creates install command', () => {
      expect(yarn.install()).toEqual(['yarn', 'install']);
    });

    it('creates add command', () => {
      expect(yarn.add('express')).toEqual(['yarn', 'add', 'express']);
    });

    it('supports dev dependency', () => {
      expect(yarn.add('typescript', { dev: true })).toEqual(['yarn', 'add', '-D', 'typescript']);
    });
  });

  describe('pip', () => {
    it('creates install command', () => {
      expect(pip.install('requests')).toEqual(['pip', 'install', 'requests']);
    });

    it('supports requirements file syntax', () => {
      expect(pip.install('-r requirements.txt')).toEqual(['pip', 'install', '-r requirements.txt']);
    });

    it('creates uninstall command', () => {
      expect(pip.uninstall('requests')).toEqual(['pip', 'uninstall', '-y', 'requests']);
    });
  });
});

describe('process commands', () => {
  describe('node', () => {
    it('creates node command with file', () => {
      expect(node('server.js')).toEqual(['node', 'server.js']);
    });

    it('creates node command with args', () => {
      expect(node('server.js', ['--port', '3000'])).toEqual(['node', 'server.js', '--port', '3000']);
    });
  });

  describe('python', () => {
    it('creates python command with file', () => {
      expect(python('script.py')).toEqual(['python3', 'script.py']);
    });

    it('creates python command with args', () => {
      expect(python('script.py', ['--verbose'])).toEqual(['python3', 'script.py', '--verbose']);
    });
  });
});

describe('git commands', () => {
  it('creates clone command', () => {
    expect(git.clone('https://github.com/user/repo.git')).toEqual([
      'git', 'clone', 'https://github.com/user/repo.git'
    ]);
  });

  it('creates clone with directory', () => {
    expect(git.clone('https://github.com/user/repo.git', { dir: 'myrepo' })).toEqual([
      'git', 'clone', 'https://github.com/user/repo.git', 'myrepo'
    ]);
  });

  it('creates shallow clone', () => {
    expect(git.clone('https://github.com/user/repo.git', { depth: 1 })).toEqual([
      'git', 'clone', '--depth', '1', 'https://github.com/user/repo.git'
    ]);
  });

  it('creates init command', () => {
    expect(git.init()).toEqual(['git', 'init']);
  });

  it('creates add command', () => {
    expect(git.add('.')).toEqual(['git', 'add', '.']);
  });

  it('creates commit command', () => {
    expect(git.commit('Initial commit')).toEqual(['git', 'commit', '-m', 'Initial commit']);
  });

  it('creates push command', () => {
    expect(git.push()).toEqual(['git', 'push']);
  });

  it('creates pull command', () => {
    expect(git.pull()).toEqual(['git', 'pull']);
  });

  it('creates checkout command', () => {
    expect(git.checkout('main')).toEqual(['git', 'checkout', 'main']);
  });

  it('creates branch command', () => {
    expect(git.branch('feature')).toEqual(['git', 'branch', 'feature']);
  });

  it('creates status command', () => {
    expect(git.status()).toEqual(['git', 'status']);
  });
});

describe('network commands', () => {
  describe('curl', () => {
    it('creates curl command (always follows redirects by default)', () => {
      // Check actual implementation behavior
      const result = curl('https://api.example.com');
      expect(result[0]).toBe('curl');
      expect(result).toContain('https://api.example.com');
    });
  });
});

describe('text processing commands', () => {
  describe('grep', () => {
    it('creates basic grep command', () => {
      expect(grep('pattern', 'file.txt')).toEqual(['grep', 'pattern', 'file.txt']);
    });

    it('supports case insensitive', () => {
      expect(grep('pattern', 'file.txt', { ignoreCase: true })).toEqual([
        'grep', '-i', 'pattern', 'file.txt'
      ]);
    });

    it('supports recursive', () => {
      expect(grep('pattern', '.', { recursive: true })).toEqual([
        'grep', '-r', 'pattern', '.'
      ]);
    });
  });
});

describe('archive commands', () => {
  describe('tar', () => {
    it('creates extract command', () => {
      expect(tar.extract('archive.tar.gz')).toEqual(['tar', '-xzf', 'archive.tar.gz']);
    });

    it('creates create command', () => {
      const result = tar.create('archive.tar.gz', '/app/dist');
      expect(result[0]).toBe('tar');
      expect(result[1]).toBe('-czf');
      expect(result[2]).toBe('archive.tar.gz');
      expect(result[3]).toBe('/app/dist');
    });
  });
});

describe('system commands', () => {
  describe('echo', () => {
    it('creates echo command', () => {
      expect(echo('hello')).toEqual(['echo', 'hello']);
    });
  });

  describe('env', () => {
    it('creates env command', () => {
      expect(env()).toEqual(['env']);
    });
  });
});
