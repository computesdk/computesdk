import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TerminalSession } from '../terminal/terminal.js'
import { TestFileSystem } from './test-filesystem.js'

describe('Terminal Session Management', () => {
  let filesystem: TestFileSystem
  let terminal: TerminalSession
  let mockRuntimeManager: any

  beforeEach(async () => {
    filesystem = new TestFileSystem()
    mockRuntimeManager = {
      execute: vi.fn().mockResolvedValue({
        stdout: 'Mock execution result',
        stderr: '',
        exitCode: 0
      })
    }
    
    terminal = new TerminalSession(filesystem, mockRuntimeManager, '/')
    
    // Set up basic directory structure
    await filesystem.mkdir('/home')
    await filesystem.mkdir('/tmp')
    await filesystem.writeFile('/test.txt', 'Hello World')
  })

  afterEach(() => {
    terminal.destroy()
  })

  describe('Terminal Creation', () => {
    it('should create terminal with default settings', () => {
      const term = new TerminalSession(filesystem, mockRuntimeManager)
      
      expect(term.getCwd()).toBe('/')
      expect(term.getEnv().PWD).toBe('/')
      expect(term.getEnv().HOME).toBe('/')
      expect(term.getEnv().USER).toBe('browser')
      
      term.destroy()
    })

    it('should create terminal with custom initial directory', () => {
      const term = new TerminalSession(filesystem, mockRuntimeManager, '/home')
      
      expect(term.getCwd()).toBe('/home')
      expect(term.getEnv().PWD).toBe('/home')
      
      term.destroy()
    })
  })

  describe('Basic Command Execution', () => {
    it('should execute echo command', async () => {
      let output = ''
      terminal.on('data', (data) => { output += data })

      terminal.write('echo Hello World')
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(output).toContain('Hello World')
    })

    it('should handle unknown commands', async () => {
      let error = ''
      terminal.on('error', (err) => { error += err })

      terminal.write('unknowncommand')
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(error).toContain('command not found')
    })

    it('should handle empty commands', () => {
      let dataEmitted = false
      terminal.on('data', () => { dataEmitted = true })

      terminal.write('')
      terminal.write('   ')

      expect(dataEmitted).toBe(false)
    })
  })

  describe('Directory Navigation', () => {
    it('should change to existing directory', async () => {
      terminal.write('cd /home')
      await new Promise(resolve => setTimeout(resolve, 10))
      
      expect(terminal.getCwd()).toBe('/home')
      expect(terminal.getEnv().PWD).toBe('/home')
    })

    it('should handle relative paths', async () => {
      terminal.write('cd home')
      await new Promise(resolve => setTimeout(resolve, 10))
      
      expect(terminal.getCwd()).toBe('/home')
    })

    it('should handle parent directory', async () => {
      terminal.write('cd /home')
      await new Promise(resolve => setTimeout(resolve, 10))
      
      terminal.write('cd ..')
      await new Promise(resolve => setTimeout(resolve, 10))
      
      expect(terminal.getCwd()).toBe('/')
    })

    it('should handle non-existent directory', async () => {
      let error = ''
      terminal.on('error', (err) => { error += err })

      terminal.write('cd /nonexistent')
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(error).toContain('No such file or directory')
    })
  })

  describe('Environment Variables', () => {
    it('should set environment variables', async () => {
      terminal.write('export TEST_VAR=hello')
      await new Promise(resolve => setTimeout(resolve, 10))
      
      expect(terminal.getEnv().TEST_VAR).toBe('hello')
    })

    it('should handle quoted values', async () => {
      terminal.write('export QUOTED="hello world"')
      await new Promise(resolve => setTimeout(resolve, 10))
      
      expect(terminal.getEnv().QUOTED).toBe('hello world')
    })

    it('should show all environment variables', async () => {
      let output = ''
      terminal.on('data', (data) => { output += data })

      terminal.write('export')
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(output).toContain('export PATH=')
      expect(output).toContain('export HOME=')
    })
  })

  describe('Session State', () => {
    it('should maintain working directory across commands', async () => {
      terminal.write('cd /home')
      await new Promise(resolve => setTimeout(resolve, 10))
      
      let output = ''
      terminal.on('data', (data) => { output += data })
      
      terminal.write('pwd')
      await new Promise(resolve => setTimeout(resolve, 10))
      
      expect(output).toContain('/home')
    })

    it('should maintain environment variables', async () => {
      terminal.write('export SESSION_VAR=persistent')
      await new Promise(resolve => setTimeout(resolve, 10))
      
      expect(terminal.getEnv().SESSION_VAR).toBe('persistent')
      
      terminal.write('echo test')
      await new Promise(resolve => setTimeout(resolve, 10))
      
      expect(terminal.getEnv().SESSION_VAR).toBe('persistent')
    })

    it('should provide immutable environment copy', () => {
      const env1 = terminal.getEnv()
      const env2 = terminal.getEnv()
      
      expect(env1).not.toBe(env2)
      expect(env1).toEqual(env2)
      
      env1.TEST = 'modified'
      expect(terminal.getEnv().TEST).toBeUndefined()
    })
  })

  describe('Error Handling', () => {
    it('should handle filesystem errors', async () => {
      const errorFilesystem = {
        ...filesystem,
        exists: vi.fn().mockRejectedValue(new Error('Filesystem error'))
      }
      
      const errorTerminal = new TerminalSession(errorFilesystem, mockRuntimeManager)
      
      let error = ''
      errorTerminal.on('error', (err) => { error += err })

      errorTerminal.write('cd /home')
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(error).toContain('Filesystem error')
      errorTerminal.destroy()
    })

    it('should prevent operations after destruction', () => {
      let errorEmitted = false
      terminal.on('error', () => { errorEmitted = true })

      terminal.destroy()
      terminal.write('echo test')
      
      expect(errorEmitted).toBe(true)
    })
  })

  describe('Event System', () => {
    it('should emit data events', async () => {
      let dataReceived = false
      terminal.on('data', (data) => {
        expect(typeof data).toBe('string')
        dataReceived = true
      })

      terminal.write('echo test')
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(dataReceived).toBe(true)
    })

    it('should emit error events', async () => {
      let errorReceived = false
      terminal.on('error', (error) => {
        expect(typeof error).toBe('string')
        errorReceived = true
      })

      terminal.write('invalidcommand')
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(errorReceived).toBe(true)
    })

    it('should support multiple listeners', async () => {
      let listener1Called = false
      let listener2Called = false
      
      terminal.on('data', () => { listener1Called = true })
      terminal.on('data', () => { listener2Called = true })

      terminal.write('echo test')
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(listener1Called).toBe(true)
      expect(listener2Called).toBe(true)
    })
  })

  describe('Node-pty API Compatibility', () => {
    it('should have cols and rows properties', () => {
      expect(terminal.cols).toBe(80)
      expect(terminal.rows).toBe(24)
    })

    it('should support resize method', () => {
      terminal.resize(120, 30)
      
      expect(terminal.cols).toBe(120)
      expect(terminal.rows).toBe(30)
      expect(terminal.getEnv().COLUMNS).toBe('120')
      expect(terminal.getEnv().LINES).toBe('30')
    })

    it('should support kill method with signal', async () => {
      let exitReceived = false
      let exitInfo: any = null
      
      terminal.on('exit', (info) => {
        exitReceived = true
        exitInfo = info
      })

      terminal.kill('SIGTERM')
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(exitReceived).toBe(true)
      expect(exitInfo.exitCode).toBe(143)
      expect(exitInfo.signal).toBe('SIGTERM')
    })

    it('should support kill method with SIGKILL', async () => {
      let exitInfo: any = null
      terminal.on('exit', (info) => { exitInfo = info })

      terminal.kill('SIGKILL')
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(exitInfo.exitCode).toBe(137)
      expect(exitInfo.signal).toBe('SIGKILL')
    })

    it('should have proper terminal environment variables', () => {
      const env = terminal.getEnv()
      
      expect(env.COLUMNS).toBe('80')
      expect(env.LINES).toBe('24')
      expect(env.TERM).toBe('xterm-256color')
    })

    it('should update environment on resize', () => {
      terminal.resize(100, 50)
      const env = terminal.getEnv()
      
      expect(env.COLUMNS).toBe('100')
      expect(env.LINES).toBe('50')
    })
  })

  describe('Complex Scenarios', () => {
    it('should handle command sequences', async () => {
      const outputs: string[] = []
      terminal.on('data', (data) => { outputs.push(data) })

      terminal.write('cd /home')
      await new Promise(resolve => setTimeout(resolve, 10))
      
      terminal.write('pwd')
      await new Promise(resolve => setTimeout(resolve, 10))
      
      terminal.write('echo "Current directory:"')
      await new Promise(resolve => setTimeout(resolve, 10))
      
      expect(terminal.getCwd()).toBe('/home')
      expect(outputs.some(output => output.includes('/home'))).toBe(true)
      expect(outputs.some(output => output.includes('Current directory:'))).toBe(true)
    })

    it('should handle multiple directory changes', async () => {
      terminal.write('cd /home')
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(terminal.getCwd()).toBe('/home')
      
      terminal.write('cd ../tmp')
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(terminal.getCwd()).toBe('/tmp')
      
      terminal.write('cd ..')
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(terminal.getCwd()).toBe('/')
    })
  })
})