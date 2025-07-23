import { loadPyodide, type PyodideInterface } from 'pyodide'
import type { CodeRuntime, RuntimeContext, RuntimeExecutionResult } from './types.js'

export class PyodideRuntime implements CodeRuntime {
  public readonly name = 'pyodide'
  public readonly version = '0.1.0'
  
  private pyodide: PyodideInterface | null = null
  private runtimeContext: RuntimeContext | null = null
  private loadedPackages: string[] = []

  async initialize(context: RuntimeContext): Promise<void> {
    this.runtimeContext = context
    
    // Load Pyodide
    this.pyodide = await loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/',
    })
    
    // Set up Python environment
    await this.setupPythonEnvironment()
  }

  async execute(code: string): Promise<RuntimeExecutionResult> {
    if (!this.pyodide || !this.runtimeContext) {
      throw new Error('Pyodide runtime not initialized')
    }

    const startTime = Date.now()
    let stdout = ''
    let stderr = ''
    let exitCode = 0

    try {
      // Capture stdout/stderr
      await this.pyodide.runPython(`
import sys
from io import StringIO

# Capture stdout and stderr
_stdout_capture = StringIO()
_stderr_capture = StringIO()
_original_stdout = sys.stdout
_original_stderr = sys.stderr
sys.stdout = _stdout_capture
sys.stderr = _stderr_capture
      `)

      // Execute the user code
      try {
        await this.pyodide.runPython(code)
      } catch (pythonError) {
        exitCode = 1
      }

      // Get captured output
      stdout = await this.pyodide.runPython(`
sys.stdout = _original_stdout
sys.stderr = _original_stderr
_stdout_capture.getvalue()
      `)

      stderr = await this.pyodide.runPython(`_stderr_capture.getvalue()`)

    } catch (error) {
      stderr = error instanceof Error ? error.message : String(error)
      exitCode = 1
    }

    const executionTime = Date.now() - startTime

    return {
      stdout: stdout || '',
      stderr: stderr || '',
      exitCode,
      executionTime
    }
  }

  async cleanup(): Promise<void> {
    // Pyodide doesn't have explicit cleanup, but we can reset our state
    this.pyodide = null
    this.runtimeContext = null
    this.loadedPackages = []
  }

  isReady(): boolean {
    return this.pyodide !== null && this.runtimeContext !== null
  }

  getLoadedPackages(): string[] {
    return [...this.loadedPackages]
  }

  async installPackage(packageName: string): Promise<void> {
    if (!this.pyodide) {
      throw new Error('Pyodide runtime not initialized')
    }

    await this.pyodide.loadPackage(packageName)
    if (!this.loadedPackages.includes(packageName)) {
      this.loadedPackages.push(packageName)
    }
  }

  private async setupPythonEnvironment(): Promise<void> {
    if (!this.pyodide || !this.runtimeContext) return

    // Set up filesystem access in Python
    await this.pyodide.runPython(`
import os
import sys

# Create a simple filesystem interface
class BrowserFS:
    def __init__(self):
        pass
    
    def read_file(self, path):
        # This will be connected to the actual filesystem later
        return "# File content would be here"
    
    def write_file(self, path, content):
        # This will be connected to the actual filesystem later
        pass
    
    def list_dir(self, path):
        # This will be connected to the actual filesystem later
        return []

# Make filesystem available globally
fs = BrowserFS()

# Set up working directory
os.chdir('${this.runtimeContext.cwd}')

# Add environment variables
${Object.entries(this.runtimeContext.env).map(([key, value]) => 
  `os.environ['${key}'] = '${value}'`
).join('\n')}
    `)
  }
}