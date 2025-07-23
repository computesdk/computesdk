/**
 * Browser-compatible EventEmitter implementation
 * Provides Node.js EventEmitter-like API using browser's EventTarget
 */

export class EventEmitter {
  private readonly target: EventTarget
  private readonly listenerCounts: Map<string, number> = new Map()

  constructor() {
    this.target = new EventTarget()
  }

  on(event: string, listener: (...args: any[]) => void): this {
    const wrappedListener = (e: Event) => {
      const customEvent = e as CustomEvent
      listener(...(customEvent.detail || []))
    }
    
    // Store the original listener reference for removeListener
    ;(wrappedListener as any)._originalListener = listener
    
    this.target.addEventListener(event, wrappedListener)
    
    // Track listener count
    const count = this.listenerCounts.get(event) || 0
    this.listenerCounts.set(event, count + 1)
    
    return this
  }

  emit(event: string, ...args: any[]): boolean {
    const customEvent = new CustomEvent(event, { detail: args })
    this.target.dispatchEvent(customEvent)
    return true
  }

  off(event: string, listener: (...args: any[]) => void): this {
    return this.removeListener(event, listener)
  }

  removeListener(event: string, listener: (...args: any[]) => void): this {
    // Find the wrapped listener by comparing original listener references
    const listeners = this.target as any
    if (listeners._listeners && listeners._listeners[event]) {
      const eventListeners = listeners._listeners[event]
      for (let i = 0; i < eventListeners.length; i++) {
        if ((eventListeners[i] as any)._originalListener === listener) {
          this.target.removeEventListener(event, eventListeners[i])
          break
        }
      }
    }
    
    // Update listener count
    const count = this.listenerCounts.get(event) || 0
    if (count > 0) {
      this.listenerCounts.set(event, count - 1)
    }
    
    return this
  }

  removeAllListeners(event?: string): this {
    if (event) {
      // Remove all listeners for specific event
      this.listenerCounts.set(event, 0)
      // Note: EventTarget doesn't have a direct way to remove all listeners for an event
      // This is a limitation of the browser EventTarget API
    } else {
      // Remove all listeners for all events
      this.listenerCounts.clear()
    }
    return this
  }

  listenerCount(event: string): number {
    return this.listenerCounts.get(event) || 0
  }

  // Aliases for compatibility
  addListener(event: string, listener: (...args: any[]) => void): this {
    return this.on(event, listener)
  }

  once(event: string, listener: (...args: any[]) => void): this {
    const onceWrapper = (...args: any[]) => {
      listener(...args)
      this.removeListener(event, onceWrapper)
    }
    return this.on(event, onceWrapper)
  }

  prependListener(event: string, listener: (...args: any[]) => void): this {
    // EventTarget doesn't support prepending, so just add normally
    return this.on(event, listener)
  }

  prependOnceListener(event: string, listener: (...args: any[]) => void): this {
    // EventTarget doesn't support prepending, so just add normally
    return this.once(event, listener)
  }

  eventNames(): string[] {
    return Array.from(this.listenerCounts.keys())
  }

  getMaxListeners(): number {
    return Infinity // No limit in browser EventTarget
  }

  setMaxListeners(n: number): this {
    // No-op in browser implementation
    return this
  }
}