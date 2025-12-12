import { describe, it, expect } from 'vitest';
import { shellEscape, escapeArgs, buildShellCommand } from '../utils';
import type { Command } from '../types';

describe('shellEscape', () => {
  it('wraps simple strings in single quotes', () => {
    expect(shellEscape('hello')).toBe("'hello'");
  });

  it('handles empty strings', () => {
    expect(shellEscape('')).toBe("''");
  });

  it('escapes embedded single quotes', () => {
    expect(shellEscape("it's")).toBe("'it'\\''s'");
    expect(shellEscape("foo'bar'baz")).toBe("'foo'\\''bar'\\''baz'");
  });

  it('preserves special characters without expansion', () => {
    // These should all be preserved literally, not expanded
    expect(shellEscape('$HOME')).toBe("'$HOME'");
    expect(shellEscape('$(whoami)')).toBe("'$(whoami)'");
    expect(shellEscape('`whoami`')).toBe("'`whoami`'");
    expect(shellEscape('${PATH}')).toBe("'${PATH}'");
  });

  it('handles spaces and special shell characters', () => {
    expect(shellEscape('hello world')).toBe("'hello world'");
    expect(shellEscape('foo;bar')).toBe("'foo;bar'");
    expect(shellEscape('foo|bar')).toBe("'foo|bar'");
    expect(shellEscape('foo&bar')).toBe("'foo&bar'");
    expect(shellEscape('foo>bar')).toBe("'foo>bar'");
    expect(shellEscape('foo<bar')).toBe("'foo<bar'");
  });

  it('handles newlines and tabs', () => {
    expect(shellEscape('line1\nline2')).toBe("'line1\nline2'");
    expect(shellEscape('col1\tcol2')).toBe("'col1\tcol2'");
  });

  it('handles double quotes', () => {
    expect(shellEscape('say "hello"')).toBe("'say \"hello\"'");
  });

  it('handles backslashes', () => {
    expect(shellEscape('path\\to\\file')).toBe("'path\\to\\file'");
  });

  // Security-focused tests
  describe('command injection prevention', () => {
    it('prevents semicolon injection', () => {
      const malicious = '; rm -rf /';
      const escaped = shellEscape(malicious);
      expect(escaped).toBe("'; rm -rf /'");
      // The semicolon is inside quotes, so it won't be interpreted as command separator
    });

    it('prevents pipe injection', () => {
      const malicious = '| cat /etc/passwd';
      const escaped = shellEscape(malicious);
      expect(escaped).toBe("'| cat /etc/passwd'");
    });

    it('prevents command substitution', () => {
      const malicious = '$(rm -rf /)';
      const escaped = shellEscape(malicious);
      expect(escaped).toBe("'$(rm -rf /)'");
    });

    it('prevents backtick substitution', () => {
      const malicious = '`rm -rf /`';
      const escaped = shellEscape(malicious);
      expect(escaped).toBe("'`rm -rf /`'");
    });

    it('prevents quote escaping attacks', () => {
      // Attacker tries to break out of quotes
      const malicious = "'; rm -rf /; echo '";
      const escaped = shellEscape(malicious);
      // The single quotes are escaped using the '\'' pattern
      // This is safe because the quote is properly escaped
      expect(escaped).toBe("''\\''; rm -rf /; echo '\\'''");
    });

    it('handles null bytes', () => {
      const malicious = 'foo\x00bar';
      const escaped = shellEscape(malicious);
      expect(escaped).toBe("'foo\x00bar'");
    });
  });
});

describe('escapeArgs', () => {
  it('joins safe arguments without quotes', () => {
    expect(escapeArgs(['npm', 'install', 'express'])).toBe('npm install express');
  });

  it('preserves common safe characters unquoted', () => {
    // alphanumeric, dash, underscore, dot, slash, colon, equals, at
    expect(escapeArgs(['git', 'clone', 'https://github.com/user/repo.git'])).toBe(
      'git clone https://github.com/user/repo.git'
    );
    expect(escapeArgs(['npm', 'install', 'pkg@1.0.0'])).toBe('npm install pkg@1.0.0');
    expect(escapeArgs(['key=value'])).toBe('key=value');
  });

  it('quotes arguments with spaces', () => {
    expect(escapeArgs(['echo', 'hello world'])).toBe("echo 'hello world'");
  });

  it('quotes arguments with special characters', () => {
    expect(escapeArgs(['echo', '$HOME'])).toBe("echo '$HOME'");
    expect(escapeArgs(['echo', 'foo;bar'])).toBe("echo 'foo;bar'");
  });

  it('handles mixed safe and unsafe arguments', () => {
    expect(escapeArgs(['cp', 'file with spaces.txt', '/dest/path'])).toBe(
      "cp 'file with spaces.txt' /dest/path"
    );
  });

  it('handles empty array', () => {
    expect(escapeArgs([])).toBe('');
  });

  it('handles single argument', () => {
    expect(escapeArgs(['ls'])).toBe('ls');
  });
});

describe('buildShellCommand', () => {
  it('returns command unchanged when no options', () => {
    const cmd: Command = ['npm', 'install'];
    const result = buildShellCommand('sh', cmd, undefined);
    expect(result).toEqual(['npm', 'install']);
  });

  it('returns command unchanged when options are empty', () => {
    const cmd: Command = ['npm', 'install'];
    const result = buildShellCommand('sh', cmd, {});
    expect(result).toEqual(['npm', 'install']);
  });

  it('wraps command with cd when cwd is provided', () => {
    const cmd: Command = ['npm', 'install'];
    const result = buildShellCommand('sh', cmd, { cwd: '/app' });
    expect(result).toEqual(['sh', '-c', "cd '/app' && npm install"]);
  });

  it('escapes cwd path with special characters', () => {
    const cmd: Command = ['npm', 'install'];
    const result = buildShellCommand('sh', cmd, { cwd: "/path/with spaces/and'quotes" });
    expect(result).toEqual(['sh', '-c', "cd '/path/with spaces/and'\\''quotes' && npm install"]);
  });

  it('wraps command with nohup when background is true', () => {
    const cmd: Command = ['node', 'server.js'];
    const result = buildShellCommand('sh', cmd, { background: true });
    expect(result).toEqual(['sh', '-c', 'nohup node server.js > /dev/null 2>&1 &']);
  });

  it('combines cwd and background options correctly', () => {
    const cmd: Command = ['node', 'server.js'];
    const result = buildShellCommand('sh', cmd, { cwd: '/app', background: true });
    expect(result).toEqual(['sh', '-c', "cd '/app' && nohup node server.js > /dev/null 2>&1 &"]);
  });

  it('uses specified shell binary', () => {
    const cmd: Command = ['echo', 'hello'];
    const result = buildShellCommand('bash', cmd, { cwd: '/tmp' });
    expect(result).toEqual(['bash', '-c', "cd '/tmp' && echo hello"]);
  });

  it('escapes command arguments with special characters', () => {
    const cmd: Command = ['echo', 'hello world', '$VAR'];
    const result = buildShellCommand('sh', cmd, { cwd: '/app' });
    expect(result).toEqual(['sh', '-c', "cd '/app' && echo 'hello world' '$VAR'"]);
  });

  // Security tests for buildShellCommand
  describe('security', () => {
    it('prevents cwd injection', () => {
      const cmd: Command = ['ls'];
      // Attacker tries to inject commands via cwd
      const result = buildShellCommand('sh', cmd, { cwd: "/tmp'; rm -rf /; echo '" });
      expect(result).toEqual(['sh', '-c', "cd '/tmp'\\''; rm -rf /; echo '\\''' && ls"]);
      // The injected command is safely escaped inside the cd argument
    });

    it('prevents command injection via arguments', () => {
      const cmd: Command = ['echo', '$(rm -rf /)'];
      const result = buildShellCommand('sh', cmd, { cwd: '/app' });
      expect(result).toEqual(['sh', '-c', "cd '/app' && echo '$(rm -rf /)'"]);
      // The command substitution is quoted, preventing execution
    });
  });
});
