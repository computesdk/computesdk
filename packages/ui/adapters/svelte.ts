import { writable, derived } from 'svelte/store'
import { onDestroy } from 'svelte'
import { createCodeExecutionHook } from '../src/hooks/useCodeExecution.js'
// Re-exported at end of file
import type { CodeEditorConfig, ExecutionState, Runtime } from '../src/types/index.js'

const executionHook = createCodeExecutionHook()

export function createCodeExecutionStore(apiEndpoint: string = '/api/execute') {
  const state = writable<ExecutionState>(executionHook.getState())
  
  const unsubscribe = executionHook.subscribe(() => {
    state.set(executionHook.getState())
  })

  const executeCode = async () => {
    await executionHook.executeCode(apiEndpoint)
  }

  const setCode = (code: string) => {
    executionHook.setCode(code)
  }

  const setRuntime = (runtime: Runtime) => {
    executionHook.setRuntime(runtime)
  }

  const clearResult = () => {
    executionHook.clearResult()
  }

  // Cleanup function
  const destroy = () => {
    unsubscribe()
  }

  return {
    state: derived(state, $state => $state),
    executeCode,
    setCode,
    setRuntime,
    clearResult,
    destroy
  }
}

// Svelte component factory function
export function createCodeEditor(config: Partial<CodeEditorConfig> = {}) {
  const {
    apiEndpoint = '/api/execute',
    defaultCode = '',
    defaultRuntime = 'python' as Runtime,
    placeholder = 'Enter your code here...',
    disabled = false,
    className = ''
  } = config

  return {
    // Component definition for Svelte
    component: `
      <script>
        import { onMount, onDestroy } from 'svelte'
        import { createCodeExecutionStore } from '@computesdk/ui/adapters/svelte'
        import { formatExecutionTime, formatOutput, isExecutionError, getErrorMessage } from '@computesdk/ui/adapters/svelte'
        
        export let apiEndpoint = '${apiEndpoint}'
        export let defaultCode = '${defaultCode}'
        export let defaultRuntime = '${defaultRuntime}'
        export let placeholder = '${placeholder}'
        export let disabled = ${disabled}
        export let className = '${className}'
        export let onCodeChange = undefined
        export let onRuntimeChange = undefined
        export let onExecute = undefined
        export let onClear = undefined
        
        const store = createCodeExecutionStore(apiEndpoint)
        const { state, executeCode, setCode, setRuntime, clearResult } = store
        
        onMount(() => {
          if (defaultCode && !$state.code) {
            setCode(defaultCode)
          }
          if (defaultRuntime && $state.runtime !== defaultRuntime) {
            setRuntime(defaultRuntime)
          }
        })
        
        onDestroy(() => {
          store.destroy()
        })
        
        function handleCodeChange(event) {
          const newCode = event.target.value
          setCode(newCode)
          if (onCodeChange) onCodeChange(newCode)
        }
        
        function handleRuntimeChange(event) {
          const newRuntime = event.target.value
          setRuntime(newRuntime)
          if (onRuntimeChange) onRuntimeChange(newRuntime)
        }
        
        async function handleExecute() {
          await executeCode()
          if (onExecute) onExecute()
        }
        
        function handleClear() {
          clearResult()
          if (onClear) onClear()
        }
      </script>
      
      <div class="compute-sdk-editor {className}">
        <!-- Controls -->
        <div class="compute-sdk-controls">
          <!-- Runtime selector -->
          <div class="compute-sdk-runtime-selector">
            <label for="runtime">Runtime:</label>
            <select
              id="runtime"
              value={$state.runtime}
              on:change={handleRuntimeChange}
              disabled={disabled || $state.isExecuting}
            >
              <option value="python">Python</option>
              <option value="javascript">JavaScript</option>
            </select>
          </div>
          
          <!-- Actions -->
          <div class="compute-sdk-actions">
            <button
              on:click={handleExecute}
              disabled={disabled || $state.isExecuting || !$state.code.trim()}
              class="compute-sdk-execute-btn"
            >
              {$state.isExecuting ? 'Executing...' : 'Execute'}
            </button>
            
            {#if $state.result || $state.error}
              <button
                on:click={handleClear}
                disabled={disabled}
                class="compute-sdk-clear-btn"
              >
                Clear
              </button>
            {/if}
          </div>
        </div>

        <!-- Code area -->
        <div class="compute-sdk-code-area">
          <textarea
            value={$state.code}
            on:input={handleCodeChange}
            placeholder={placeholder}
            disabled={disabled || $state.isExecuting}
            class="compute-sdk-textarea"
            rows="10"
          ></textarea>
        </div>

        <!-- Error display -->
        {#if $state.error}
          <div class="compute-sdk-error">
            <h4>Error</h4>
            <pre>{$state.error}</pre>
          </div>
        {/if}

        <!-- Result display -->
        {#if $state.result}
          <div class="compute-sdk-result">
            <div class="compute-sdk-result-header">
              <h4>Result</h4>
              {#if $state.result.result}
                <div class="compute-sdk-meta">
                  <span class="compute-sdk-provider">
                    Provider: {$state.result.result.provider}
                  </span>
                  <span class="compute-sdk-time">
                    Time: {formatExecutionTime($state.result.result.executionTime)}
                  </span>
                </div>
              {/if}
            </div>
            
            {#if isExecutionError($state.result)}
              <div class="compute-sdk-execution-error">
                <h5>Execution Error</h5>
                <pre>{getErrorMessage($state.result)}</pre>
              </div>
            {:else if $state.result.result?.output}
              <div class="compute-sdk-output">
                <h5>Output</h5>
                <pre>{formatOutput($state.result.result.output)}</pre>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    `,
    
    // Store factory for programmatic usage
    createStore: () => createCodeExecutionStore(apiEndpoint),
    
    // Configuration
    config: {
      apiEndpoint,
      defaultCode,
      defaultRuntime,
      placeholder,
      disabled,
      className
    }
  }
}

// Panel component factory
export function createCodeExecutionPanel(config: {
  apiEndpoint?: string
  defaultCode?: string
  defaultRuntime?: Runtime
  className?: string
  title?: string
  showControls?: boolean
} = {}) {
  const {
    apiEndpoint = '/api/execute',
    defaultCode = '',
    defaultRuntime = 'python' as Runtime,
    className = '',
    title = 'Code Execution',
    showControls = true
  } = config

  return {
    component: `
      <script>
        import { createCodeEditor } from '@computesdk/ui/adapters/svelte'
        
        export let apiEndpoint = '${apiEndpoint}'
        export let defaultCode = '${defaultCode}'
        export let defaultRuntime = '${defaultRuntime}'
        export let className = '${className}'
        export let title = '${title}'
        export let showControls = ${showControls}
        
        const editor = createCodeEditor({
          apiEndpoint,
          defaultCode,
          defaultRuntime,
          className: showControls ? '' : 'compute-sdk-no-controls'
        })
      </script>
      
      <div class="compute-sdk-panel {className}">
        {#if title}
          <h2 class="compute-sdk-panel-title">{title}</h2>
        {/if}
        <svelte:component this={editor.component} />
      </div>
    `,
    
    config: {
      apiEndpoint,
      defaultCode,
      defaultRuntime,
      className,
      title,
      showControls
    }
  }
}

// Utility functions for Svelte components
export function useCodeExecution(apiEndpoint: string = '/api/execute') {
  const store = createCodeExecutionStore(apiEndpoint)
  
  // Auto-cleanup when component is destroyed
  onDestroy(() => {
    store.destroy()
  })
  
  return store
}

// Action for binding to form elements
export function codeExecutionAction(node: HTMLElement, config: Partial<CodeEditorConfig> = {}) {
  const store = createCodeExecutionStore(config.apiEndpoint)
  
  // Set up event listeners based on element type
  if (node.tagName === 'TEXTAREA') {
    const handleInput = (event: Event) => {
      const target = event.target as HTMLTextAreaElement
      store.setCode(target.value)
    }
    
    node.addEventListener('input', handleInput)
    
    // Subscribe to state changes to update the textarea
    const unsubscribe = store.state.subscribe(state => {
      if (node instanceof HTMLTextAreaElement) {
        node.value = state.code
        node.disabled = state.isExecuting
      }
    })
    
    return {
      destroy() {
        node.removeEventListener('input', handleInput)
        unsubscribe()
        store.destroy()
      }
    }
  }
  
  return {
    destroy() {
      store.destroy()
    }
  }
}

export { formatExecutionTime, formatOutput, isExecutionError, getErrorMessage } from '../src/utils/api.js'
export type { ExecutionState, Runtime, ExecutionResult, CodeEditorConfig } from '../src/types/index.js'