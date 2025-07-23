import { describe, it, expect, beforeEach } from 'vitest'
import { BUILTIN_COMMANDS, getCommand, getAllCommands } from '../shell/commands/index.js'
import { TestFileSystem } from './test-filesystem.js'
import type { ShellCommandOptions } from '../shell/types.js'

describe('Shell Commands', () => {
  let filesystem: TestFileSystem
  let options: ShellCommandOptions

  beforeEach(async () => {
    filesystem = new TestFileSystem()
    options = {
      cwd: '/',
      env: { HOME: '/home', PATH: '/bin:/usr/bin' },
      filesystem,
      runtimeManager: undefined
    }
    
    // Set up basic directory structure
    await filesystem.mkdir('/home')
    await filesystem.mkdir('/tmp')
    await filesystem.writeFile('/test.txt', 'Hello World')
    await filesystem.writeFile('/home/script.js', 'console.log("Hello from JS")')
    await filesystem.writeFile('/home/script.py', 'print("Hello from Python")')
  })

  describe('Command Registry', () => {
    it('should have all expected commands', () => {
      const expectedCommands = ['ls', 'cat', 'echo', 'pwd', 'cd', 'mkdir', 'rm', 'cp', 'mv', 'grep', 'find', 'node', 'python', 'npm', 'pip']
      
      for (const cmdName of expectedCommands) {
        expect(BUILTIN_COMMANDS.has(cmdName)).toBe(true)
        expect(getCommand(cmdName)).toBeDefined()
      }
      
      expect(getAllCommands()).toHaveLength(expectedCommands.length)
    })

    it('should return undefined for unknown commands', () => {
      expect(getCommand('unknowncommand')).toBeUndefined()
    })
  })

  describe('Echo Command', () => {
    it('should echo simple text', async () => {
      const cmd = getCommand('echo')!
      const result = await cmd.execute(['Hello', 'World'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Hello World\n')
      expect(result.stderr).toBe('')
    })

    it('should handle empty arguments', async () => {
      const cmd = getCommand('echo')!
      const result = await cmd.execute([], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('\n')
      expect(result.stderr).toBe('')
    })

    it('should handle special characters', async () => {
      const cmd = getCommand('echo')!
      const result = await cmd.execute(['Hello', '&', 'World', '!'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Hello & World !\n')
      expect(result.stderr).toBe('')
    })
  })

  describe('Pwd Command', () => {
    it('should return current working directory', async () => {
      const cmd = getCommand('pwd')!
      const result = await cmd.execute([], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('/\n')
      expect(result.stderr).toBe('')
    })

    it('should return correct cwd when changed', async () => {
      const cmd = getCommand('pwd')!
      options.cwd = '/home'
      const result = await cmd.execute([], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('/home\n')
      expect(result.stderr).toBe('')
    })
  })

  describe('Ls Command', () => {
    it('should list files in current directory', async () => {
      const cmd = getCommand('ls')!
      const result = await cmd.execute([], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('test.txt')
      expect(result.stdout).toContain('home')
      expect(result.stdout).toContain('tmp')
      expect(result.stderr).toBe('')
    })

    it('should list files with -l flag (long format)', async () => {
      const cmd = getCommand('ls')!
      const result = await cmd.execute(['-l'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('test.txt')
      expect(result.stdout).toContain('-rwxr-xr-x') // File permissions
      expect(result.stderr).toBe('')
    })

    it('should list files with -la flags', async () => {
      const cmd = getCommand('ls')!
      const result = await cmd.execute(['-la'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('test.txt')
      expect(result.stdout).toContain('drwxr-xr-x') // Directory permissions
      expect(result.stderr).toBe('')
    })

    it('should list specific directory', async () => {
      const cmd = getCommand('ls')!
      const result = await cmd.execute(['/home'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('script.js')
      expect(result.stdout).toContain('script.py')
      expect(result.stderr).toBe('')
    })

    it('should handle non-existent directory', async () => {
      const cmd = getCommand('ls')!
      const result = await cmd.execute(['/nonexistent'], options)
      
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('ls:')
    })
  })

  describe('Cat Command', () => {
    it('should display file contents', async () => {
      const cmd = getCommand('cat')!
      const result = await cmd.execute(['/test.txt'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Hello World')
      expect(result.stderr).toBe('')
    })

    it('should handle relative paths', async () => {
      const cmd = getCommand('cat')!
      options.cwd = '/'
      const result = await cmd.execute(['test.txt'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Hello World')
      expect(result.stderr).toBe('')
    })

    it('should handle missing file operand', async () => {
      const cmd = getCommand('cat')!
      const result = await cmd.execute([], options)
      
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('missing file operand')
    })

    it('should handle non-existent file', async () => {
      const cmd = getCommand('cat')!
      const result = await cmd.execute(['/nonexistent.txt'], options)
      
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('cat:')
    })
  })

  describe('Mkdir Command', () => {
    it('should create directory', async () => {
      const cmd = getCommand('mkdir')!
      const result = await cmd.execute(['/newdir'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('')
      
      // Verify directory was created
      const exists = await filesystem.exists('/newdir')
      expect(exists).toBe(true)
    })

    it('should create multiple directories', async () => {
      const cmd = getCommand('mkdir')!
      const result = await cmd.execute(['/dir1', '/dir2'], options)
      
      expect(result.exitCode).toBe(0)
      expect(await filesystem.exists('/dir1')).toBe(true)
      expect(await filesystem.exists('/dir2')).toBe(true)
    })

    it('should create parent directories with -p flag', async () => {
      const cmd = getCommand('mkdir')!
      const result = await cmd.execute(['-p', '/deep/nested/dir'], options)
      
      expect(result.exitCode).toBe(0)
      expect(await filesystem.exists('/deep')).toBe(true)
      expect(await filesystem.exists('/deep/nested')).toBe(true)
      expect(await filesystem.exists('/deep/nested/dir')).toBe(true)
    })

    it('should handle missing operand', async () => {
      const cmd = getCommand('mkdir')!
      const result = await cmd.execute([], options)
      
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('missing operand')
    })

    it('should handle relative paths', async () => {
      const cmd = getCommand('mkdir')!
      options.cwd = '/home'
      const result = await cmd.execute(['newdir'], options)
      
      expect(result.exitCode).toBe(0)
      expect(await filesystem.exists('/home/newdir')).toBe(true)
    })
  })

  describe('Rm Command', () => {
    it('should remove file', async () => {
      const cmd = getCommand('rm')!
      const result = await cmd.execute(['/test.txt'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('')
      
      // Verify file was removed
      const exists = await filesystem.exists('/test.txt')
      expect(exists).toBe(false)
    })

    it('should handle non-existent file', async () => {
      const cmd = getCommand('rm')!
      const result = await cmd.execute(['/nonexistent.txt'], options)
      
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('No such file or directory')
    })

    it('should ignore non-existent file with -f flag', async () => {
      const cmd = getCommand('rm')!
      const result = await cmd.execute(['-f', '/nonexistent.txt'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
    })

    it('should handle missing operand', async () => {
      const cmd = getCommand('rm')!
      const result = await cmd.execute([], options)
      
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('missing operand')
    })

    it('should handle relative paths', async () => {
      const cmd = getCommand('rm')!
      options.cwd = '/'
      const result = await cmd.execute(['test.txt'], options)
      
      expect(result.exitCode).toBe(0)
      expect(await filesystem.exists('/test.txt')).toBe(false)
    })
  })

  describe('Cp Command', () => {
    it('should copy file', async () => {
      const cmd = getCommand('cp')!
      const result = await cmd.execute(['/test.txt', '/test_copy.txt'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('')
      
      // Verify file was copied
      const exists = await filesystem.exists('/test_copy.txt')
      expect(exists).toBe(true)
      
      const content = await filesystem.readFile('/test_copy.txt')
      expect(content).toBe('Hello World')
    })

    it('should handle relative paths', async () => {
      const cmd = getCommand('cp')!
      options.cwd = '/'
      const result = await cmd.execute(['test.txt', 'copy.txt'], options)
      
      expect(result.exitCode).toBe(0)
      expect(await filesystem.exists('/copy.txt')).toBe(true)
    })

    it('should handle missing operands', async () => {
      const cmd = getCommand('cp')!
      const result = await cmd.execute(['onefile'], options)
      
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('missing file operand')
    })

    it('should handle non-existent source', async () => {
      const cmd = getCommand('cp')!
      const result = await cmd.execute(['/nonexistent.txt', '/dest.txt'], options)
      
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('No such file or directory')
    })
  })

  describe('Mv Command', () => {
    it('should move/rename file', async () => {
      const cmd = getCommand('mv')!
      const result = await cmd.execute(['/test.txt', '/moved.txt'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('')
      
      // Verify file was moved
      expect(await filesystem.exists('/test.txt')).toBe(false)
      expect(await filesystem.exists('/moved.txt')).toBe(true)
      
      const content = await filesystem.readFile('/moved.txt')
      expect(content).toBe('Hello World')
    })

    it('should handle relative paths', async () => {
      const cmd = getCommand('mv')!
      options.cwd = '/'
      const result = await cmd.execute(['test.txt', 'renamed.txt'], options)
      
      expect(result.exitCode).toBe(0)
      expect(await filesystem.exists('/test.txt')).toBe(false)
      expect(await filesystem.exists('/renamed.txt')).toBe(true)
    })

    it('should handle missing operands', async () => {
      const cmd = getCommand('mv')!
      const result = await cmd.execute(['onefile'], options)
      
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('missing file operand')
    })

    it('should handle non-existent source', async () => {
      const cmd = getCommand('mv')!
      const result = await cmd.execute(['/nonexistent.txt', '/dest.txt'], options)
      
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('No such file or directory')
    })
  })

  describe('Cd Command', () => {
    it('should change to existing directory', async () => {
      const cmd = getCommand('cd')!
      const result = await cmd.execute(['/home'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('')
      expect(result.newCwd).toBe('/home')
    })

    it('should change to root when no arguments', async () => {
      const cmd = getCommand('cd')!
      const result = await cmd.execute([], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.newCwd).toBe('/')
    })

    it('should handle relative paths', async () => {
      const cmd = getCommand('cd')!
      options.cwd = '/'
      const result = await cmd.execute(['home'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.newCwd).toBe('/home')
    })

    it('should handle .. (parent directory)', async () => {
      const cmd = getCommand('cd')!
      options.cwd = '/home'
      const result = await cmd.execute(['..'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.newCwd).toBe('/')
    })

    it('should handle non-existent directory', async () => {
      const cmd = getCommand('cd')!
      const result = await cmd.execute(['/nonexistent'], options)
      
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('No such file or directory')
    })

    it('should normalize complex paths', async () => {
      const cmd = getCommand('cd')!
      options.cwd = '/home'
      const result = await cmd.execute(['../home/../tmp'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.newCwd).toBe('/tmp')
    })
  })

  describe('Grep Command', () => {
    beforeEach(async () => {
      await filesystem.writeFile('/search.txt', 'Hello World\nThis is a test\nHello again')
      await filesystem.writeFile('/other.txt', 'No matches here\nJust some text')
    })

    it('should find pattern in single file', async () => {
      const cmd = getCommand('grep')!
      const result = await cmd.execute(['Hello', '/search.txt'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Hello World')
      expect(result.stdout).toContain('Hello again')
      expect(result.stderr).toBe('')
    })

    it('should find pattern in multiple files', async () => {
      const cmd = getCommand('grep')!
      const result = await cmd.execute(['Hello', '/search.txt', '/other.txt'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('/search.txt:Hello World')
      expect(result.stdout).toContain('/search.txt:Hello again')
      expect(result.stderr).toBe('')
    })

    it('should return exit code 1 when no matches', async () => {
      const cmd = getCommand('grep')!
      const result = await cmd.execute(['nomatch', '/search.txt'], options)
      
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('')
    })

    it('should handle missing pattern', async () => {
      const cmd = getCommand('grep')!
      const result = await cmd.execute([], options)
      
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('missing pattern')
    })

    it('should handle non-existent file', async () => {
      const cmd = getCommand('grep')!
      const result = await cmd.execute(['pattern', '/nonexistent.txt'], options)
      
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('grep:')
    })
  })

  describe('Find Command', () => {
    beforeEach(async () => {
      await filesystem.mkdir('/search')
      await filesystem.mkdir('/search/subdir')
      await filesystem.writeFile('/search/file1.txt', 'content')
      await filesystem.writeFile('/search/file2.js', 'content')
      await filesystem.writeFile('/search/subdir/file3.txt', 'content')
    })

    it('should find all files in directory', async () => {
      const cmd = getCommand('find')!
      const result = await cmd.execute(['/search'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('/search/file1.txt')
      expect(result.stdout).toContain('/search/file2.js')
      expect(result.stdout).toContain('/search/subdir/file3.txt')
      expect(result.stderr).toBe('')
    })

    it('should find files by name pattern', async () => {
      const cmd = getCommand('find')!
      const result = await cmd.execute(['/search', '-name', '*.txt'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('/search/file1.txt')
      expect(result.stdout).toContain('/search/subdir/file3.txt')
      expect(result.stdout).not.toContain('/search/file2.js')
      expect(result.stderr).toBe('')
    })

    it('should find files by exact name', async () => {
      const cmd = getCommand('find')!
      const result = await cmd.execute(['/search', '-name', 'file1.txt'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('/search/file1.txt')
      expect(result.stdout).not.toContain('/search/file2.js')
      expect(result.stderr).toBe('')
    })

    it('should search from current directory by default', async () => {
      const cmd = getCommand('find')!
      options.cwd = '/search'
      const result = await cmd.execute(['-name', '*.js'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('/search/file2.js')
      expect(result.stderr).toBe('')
    })
  })

  describe('Node Command', () => {
    it('should execute JavaScript file (fallback mode)', async () => {
      const cmd = getCommand('node')!
      const result = await cmd.execute(['/home/script.js'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Hello from JS')
      expect(result.stderr).toBe('')
    })

    it('should handle missing script file', async () => {
      const cmd = getCommand('node')!
      const result = await cmd.execute([], options)
      
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('missing script file')
    })

    it('should handle non-existent script', async () => {
      const cmd = getCommand('node')!
      const result = await cmd.execute(['/nonexistent.js'], options)
      
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('cannot open')
    })

    it('should handle JavaScript errors', async () => {
      await filesystem.writeFile('/error.js', 'throw new Error("Test error")')
      
      const cmd = getCommand('node')!
      const result = await cmd.execute(['/error.js'], options)
      
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Test error')
    })

    it('should handle relative paths', async () => {
      const cmd = getCommand('node')!
      options.cwd = '/home'
      const result = await cmd.execute(['script.js'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Hello from JS')
    })
  })

  describe('Python Command', () => {
    it('should execute Python file (fallback mode)', async () => {
      const cmd = getCommand('python')!
      const result = await cmd.execute(['/home/script.py'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Hello from Python')
      expect(result.stderr).toBe('')
    })

    it('should handle missing script file', async () => {
      const cmd = getCommand('python')!
      const result = await cmd.execute([], options)
      
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('missing script file')
    })

    it('should handle non-existent script', async () => {
      const cmd = getCommand('python')!
      const result = await cmd.execute(['/nonexistent.py'], options)
      
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('cannot open')
    })

    it('should handle simple expressions', async () => {
      await filesystem.writeFile('/math.py', '2 + 2')
      
      const cmd = getCommand('python')!
      const result = await cmd.execute(['/math.py'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('4')
    })

    it('should handle relative paths', async () => {
      const cmd = getCommand('python')!
      options.cwd = '/home'
      const result = await cmd.execute(['script.py'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Hello from Python')
    })
  })

  describe('Path Handling', () => {
    it('should handle absolute paths correctly', async () => {
      const cmd = getCommand('cat')!
      const result = await cmd.execute(['/test.txt'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Hello World')
    })

    it('should handle relative paths correctly', async () => {
      const cmd = getCommand('cat')!
      options.cwd = '/'
      const result = await cmd.execute(['test.txt'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Hello World')
    })

    it('should normalize paths with multiple slashes', async () => {
      const cmd = getCommand('cat')!
      const result = await cmd.execute(['//test.txt'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Hello World')
    })

    it('should handle paths with current directory references', async () => {
      const cmd = getCommand('cat')!
      options.cwd = '/'
      const result = await cmd.execute(['./test.txt'], options)
      
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Hello World')
    })
  })

  describe('Error Handling', () => {
    it('should handle filesystem errors gracefully', async () => {
      // Mock filesystem to throw errors
      const errorFilesystem = {
        ...filesystem,
        readFile: async () => { throw new Error('Permission denied') }
      }
      
      const errorOptions = { ...options, filesystem: errorFilesystem }
      
      const cmd = getCommand('cat')!
      const result = await cmd.execute(['/test.txt'], errorOptions)
      
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Permission denied')
    })

    it('should handle unexpected errors', async () => {
      // Mock filesystem to throw non-Error objects
      const errorFilesystem = {
        ...filesystem,
        readFile: async () => { throw 'String error' }
      }
      
      const errorOptions = { ...options, filesystem: errorFilesystem }
      
      const cmd = getCommand('cat')!
      const result = await cmd.execute(['/test.txt'], errorOptions)
      
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('String error')
    })
  })
})