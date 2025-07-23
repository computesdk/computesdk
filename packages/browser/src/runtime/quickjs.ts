import { getQuickJS, type QuickJSContext, type QuickJSWASMModule } from 'quickjs-emscripten'
import type { CodeRuntime, RuntimeContext, RuntimeExecutionResult } from './types.js'

export class QuickJSRuntime implements CodeRuntime {
  public readonly name = 'quickjs'
  public readonly version = '0.1.0'
  
  private quickjs: QuickJSWASMModule | null = null
  private context: QuickJSContext | null = null
  private runtimeContext: RuntimeContext | null = null
  private loadedPackages: string[] = []

  async initialize(context: RuntimeContext): Promise<void> {
    this.runtimeContext = context
    
    // Load QuickJS WASM module
    this.quickjs = await getQuickJS()
    this.context = this.quickjs.newContext()
    
    // Inject filesystem APIs into the JavaScript context
    this.injectFilesystemAPIs()
    this.injectConsoleAPIs()
    this.injectProcessAPIs()
  }

  async execute(code: string): Promise<RuntimeExecutionResult> {
    if (!this.context || !this.runtimeContext) {
      throw new Error('QuickJS runtime not initialized')
    }

    const startTime = Date.now()
    let stdout = ''
    let stderr = ''
    let exitCode = 0

    try {
      // Set up output capture in the context
      const outputHandle = this.context.newObject()
      this.context.setProp(outputHandle, 'stdout', this.context.newArray())
      this.context.setProp(outputHandle, 'stderr', this.context.newArray())
      this.context.setProp(this.context.global, '__output', outputHandle)
      
      // Execute the code
      const result = this.context.evalCode(code)
      
      if (result.error) {
        const error = this.context.dump(result.error)
        stderr = error
        exitCode = 1
        result.error.dispose()
      } else {
        // Get captured output
        const outputObj = this.context.getProp(this.context.global, '__output')
        const stdoutArray = this.context.getProp(outputObj, 'stdout')
        const stderrArray = this.context.getProp(outputObj, 'stderr')
        
        // Convert arrays to strings
        stdout = this.arrayToString(stdoutArray)
        stderr = this.arrayToString(stderrArray)
        
        stdoutArray.dispose()
        stderrArray.dispose()
        outputObj.dispose()
        result.value.dispose()
      }
    } catch (error) {
      stderr = error instanceof Error ? error.message : String(error)
      exitCode = 1
    }

    const executionTime = Date.now() - startTime

    return {
      stdout,
      stderr,
      exitCode,
      executionTime
    }
  }

  async cleanup(): Promise<void> {
    if (this.context) {
      this.context.dispose()
      this.context = null
    }
    this.quickjs = null
    this.runtimeContext = null
    this.loadedPackages = []
  }

  isReady(): boolean {
    return this.context !== null && this.runtimeContext !== null
  }

  getLoadedPackages(): string[] {
    return [...this.loadedPackages]
  }

  private injectFilesystemAPIs(): void {
    if (!this.context || !this.runtimeContext) return

    const fs = this.context.newObject()
    
    // For now, let's create synchronous versions that are simpler to implement
    // fs.readFileSync
    const readFileSync = this.context.newFunction('readFileSync', (pathHandle) => {
      this.context!.getString(pathHandle) // path - will be used later
      try {
        // Note: This is a simplified sync version for demo purposes
        // In a real implementation, we'd need to handle async properly
        return this.context!.newString('// File content would be here')
      } catch (error) {
        throw this.context!.newError(error instanceof Error ? error.message : String(error))
      }
    })
    this.context.setProp(fs, 'readFileSync', readFileSync)
    
    // fs.writeFileSync
    const writeFileSync = this.context.newFunction('writeFileSync', (pathHandle, contentHandle) => {
      this.context!.getString(pathHandle) // path - will be used later
      this.context!.getString(contentHandle) // content - will be used later
      try {
        // Note: This is a simplified sync version for demo purposes
        return this.context!.undefined
      } catch (error) {
        throw this.context!.newError(error instanceof Error ? error.message : String(error))
      }
    })
    this.context.setProp(fs, 'writeFileSync', writeFileSync)
    
    this.context.setProp(this.context.global, 'fs', fs)
  }

  private injectConsoleAPIs(): void {
    if (!this.context) return

    const console = this.context.newObject()
    
    const log = this.context.newFunction('log', (...args) => {
      const output = args.map(arg => this.context!.dump(arg)).join(' ')
      this.appendOutput('stdout', output + '\n')
      return this.context!.undefined
    })
    this.context.setProp(console, 'log', log)
    
    const error = this.context.newFunction('error', (...args) => {
      const output = args.map(arg => this.context!.dump(arg)).join(' ')
      this.appendOutput('stderr', output + '\n')
      return this.context!.undefined
    })
    this.context.setProp(console, 'error', error)
    
    this.context.setProp(this.context.global, 'console', console)
  }

  private injectProcessAPIs(): void {
    if (!this.context || !this.runtimeContext) return

    const process = this.context.newObject()
    
    // process.cwd()
    const cwd = this.context.newFunction('cwd', () => {
      return this.context!.newString(this.runtimeContext!.cwd)
    })
    this.context.setProp(process, 'cwd', cwd)
    
    // process.env
    const env = this.context.newObject()
    for (const [key, value] of Object.entries(this.runtimeContext.env)) {
      this.context.setProp(env, key, this.context.newString(value))
    }
    this.context.setProp(process, 'env', env)
    
    this.context.setProp(this.context.global, 'process', process)
  }

  private appendOutput(type: 'stdout' | 'stderr', text: string): void {
    if (!this.context) return
    
    const outputObj = this.context.getProp(this.context.global, '__output')
    const array = this.context.getProp(outputObj, type)
    const length = this.context.getNumber(this.context.getProp(array, 'length'))
    this.context.setProp(array, length, this.context.newString(text))
    outputObj.dispose()
    array.dispose()
  }

  private arrayToString(arrayHandle: any): string {
    if (!this.context) return ''
    
    const length = this.context.getNumber(this.context.getProp(arrayHandle, 'length'))
    const parts: string[] = []
    
    for (let i = 0; i < length; i++) {
      const item = this.context.getProp(arrayHandle, i)
      parts.push(this.context.getString(item))
      item.dispose()
    }
    
    return parts.join('')
  }
}