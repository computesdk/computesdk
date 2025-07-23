import type { Runtime } from 'computesdk'
import type { CodeRuntime, RuntimeContext, RuntimeExecutionResult } from './types.js'
import { QuickJSRuntime } from './quickjs.js'
import { PyodideRuntime } from './pyodide.js'

export class RuntimeManager {
  private runtimes = new Map<Runtime, CodeRuntime>()
  private context: RuntimeContext | null = null

  constructor() {
    // Register available runtimes
    this.runtimes.set('node', new QuickJSRuntime())
    this.runtimes.set('python', new PyodideRuntime())
  }

  async initialize(context: RuntimeContext): Promise<void> {
    this.context = context
    
    // Initialize all runtimes lazily - they'll be initialized when first used
    // This saves memory and startup time
  }

  async execute(code: string, runtime: Runtime = 'node'): Promise<RuntimeExecutionResult> {
    const runtimeInstance = this.runtimes.get(runtime)
    if (!runtimeInstance) {
      throw new Error(`Unsupported runtime: ${runtime}`)
    }

    // Initialize runtime if not already done
    if (!runtimeInstance.isReady() && this.context) {
      await runtimeInstance.initialize(this.context)
    }

    return runtimeInstance.execute(code)
  }

  async cleanup(): Promise<void> {
    // Cleanup all initialized runtimes
    const cleanupPromises = Array.from(this.runtimes.values())
      .filter(runtime => runtime.isReady())
      .map(runtime => runtime.cleanup())
    
    await Promise.all(cleanupPromises)
    this.context = null
  }

  getAvailableRuntimes(): Runtime[] {
    return Array.from(this.runtimes.keys())
  }

  getRuntimeInfo(runtime: Runtime): { name: string; version: string; ready: boolean } | null {
    const runtimeInstance = this.runtimes.get(runtime)
    if (!runtimeInstance) return null

    return {
      name: runtimeInstance.name,
      version: runtimeInstance.version,
      ready: runtimeInstance.isReady()
    }
  }

  async installPackage(packageName: string, runtime: Runtime): Promise<void> {
    const runtimeInstance = this.runtimes.get(runtime)
    if (!runtimeInstance) {
      throw new Error(`Unsupported runtime: ${runtime}`)
    }

    // Initialize runtime if not already done
    if (!runtimeInstance.isReady() && this.context) {
      await runtimeInstance.initialize(this.context)
    }

    // Check if runtime supports package installation
    if ('installPackage' in runtimeInstance && typeof runtimeInstance.installPackage === 'function') {
      await runtimeInstance.installPackage(packageName)
    } else {
      throw new Error(`Runtime ${runtime} does not support package installation`)
    }
  }

  getLoadedPackages(runtime: Runtime): string[] {
    const runtimeInstance = this.runtimes.get(runtime)
    if (!runtimeInstance || !runtimeInstance.isReady()) {
      return []
    }

    return runtimeInstance.getLoadedPackages()
  }
}