import { createCodeExecutionHook } from '../src/hooks/useCodeExecution.js'
import { formatExecutionTime, formatOutput, isExecutionError, getErrorMessage } from '../src/utils/api.js'
import type { CodeEditorConfig, ExecutionState, Runtime } from '../src/types/index.js'

const executionHook = createCodeExecutionHook()

export class CodeExecutionManager {
  private unsubscribe: (() => void) | null = null
  private listeners: Set<(state: ExecutionState) => void> = new Set()
  
  constructor(private apiEndpoint: string = '/api/execute') {
    this.unsubscribe = executionHook.subscribe(() => {
      const state = this.getState()
      this.listeners.forEach(listener => listener(state))
    })
  }

  getState(): ExecutionState {
    return executionHook.getState()
  }

  async executeCode(): Promise<void> {
    await executionHook.executeCode(this.apiEndpoint)
  }

  setCode(code: string): void {
    executionHook.setCode(code)
  }

  setRuntime(runtime: Runtime): void {
    executionHook.setRuntime(runtime)
  }

  clearResult(): void {
    executionHook.clearResult()
  }

  subscribe(listener: (state: ExecutionState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
    this.listeners.clear()
  }
}

export class CodeEditor {
  private manager: CodeExecutionManager
  private container: HTMLElement
  private elements: {
    runtimeSelect?: HTMLSelectElement
    executeBtn?: HTMLButtonElement
    clearBtn?: HTMLButtonElement
    textarea?: HTMLTextAreaElement
    errorDiv?: HTMLElement
    resultDiv?: HTMLElement
  } = {}

  constructor(
    container: HTMLElement | string,
    private config: Partial<CodeEditorConfig> = {}
  ) {
    this.container = typeof container === 'string' 
      ? document.querySelector(container) as HTMLElement
      : container

    if (!this.container) {
      throw new Error('Container element not found')
    }

    const {
      apiEndpoint = '/api/execute',
      defaultCode = '',
      defaultRuntime = 'python' as Runtime
    } = this.config

    this.manager = new CodeExecutionManager(apiEndpoint)
    
    this.render()
    this.bindEvents()
    
    // Initialize with defaults
    if (defaultCode) {
      this.manager.setCode(defaultCode)
    }
    if (defaultRuntime) {
      this.manager.setRuntime(defaultRuntime)
    }

    // Subscribe to state changes
    this.manager.subscribe((state) => {
      this.updateUI(state)
    })

    // Initial UI update
    this.updateUI(this.manager.getState())
  }

  private render(): void {
    const { className = '', placeholder = 'Enter your code here...' } = this.config

    this.container.innerHTML = `
      <div class="compute-sdk-editor ${className}">
        <!-- Controls -->
        <div class="compute-sdk-controls">
          <!-- Runtime selector -->
          <div class="compute-sdk-runtime-selector">
            <label for="runtime">Runtime:</label>
            <select id="runtime" class="compute-sdk-runtime-select">
              <option value="python">Python</option>
              <option value="javascript">JavaScript</option>
            </select>
          </div>
          
          <!-- Actions -->
          <div class="compute-sdk-actions">
            <button class="compute-sdk-execute-btn">Execute</button>
            <button class="compute-sdk-clear-btn" style="display: none;">Clear</button>
          </div>
        </div>

        <!-- Code area -->
        <div class="compute-sdk-code-area">
          <textarea 
            class="compute-sdk-textarea" 
            placeholder="${placeholder}"
            rows="10"
          ></textarea>
        </div>

        <!-- Error display -->
        <div class="compute-sdk-error" style="display: none;">
          <h4>Error</h4>
          <pre class="compute-sdk-error-content"></pre>
        </div>

        <!-- Result display -->
        <div class="compute-sdk-result" style="display: none;">
          <div class="compute-sdk-result-header">
            <h4>Result</h4>
            <div class="compute-sdk-meta" style="display: none;">
              <span class="compute-sdk-provider"></span>
              <span class="compute-sdk-time"></span>
            </div>
          </div>
          
          <div class="compute-sdk-execution-error" style="display: none;">
            <h5>Execution Error</h5>
            <pre class="compute-sdk-execution-error-content"></pre>
          </div>
          
          <div class="compute-sdk-output" style="display: none;">
            <h5>Output</h5>
            <pre class="compute-sdk-output-content"></pre>
          </div>
        </div>
      </div>
    `

    // Cache element references
    this.elements = {
      runtimeSelect: this.container.querySelector('.compute-sdk-runtime-select') as HTMLSelectElement,
      executeBtn: this.container.querySelector('.compute-sdk-execute-btn') as HTMLButtonElement,
      clearBtn: this.container.querySelector('.compute-sdk-clear-btn') as HTMLButtonElement,
      textarea: this.container.querySelector('.compute-sdk-textarea') as HTMLTextAreaElement,
      errorDiv: this.container.querySelector('.compute-sdk-error') as HTMLElement,
      resultDiv: this.container.querySelector('.compute-sdk-result') as HTMLElement
    }
  }

  private bindEvents(): void {
    const { textarea, runtimeSelect, executeBtn, clearBtn } = this.elements

    if (textarea) {
      textarea.addEventListener('input', (e) => {
        const target = e.target as HTMLTextAreaElement
        this.manager.setCode(target.value)
      })
    }

    if (runtimeSelect) {
      runtimeSelect.addEventListener('change', (e) => {
        const target = e.target as HTMLSelectElement
        this.manager.setRuntime(target.value as Runtime)
      })
    }

    if (executeBtn) {
      executeBtn.addEventListener('click', async () => {
        await this.manager.executeCode()
      })
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.manager.clearResult()
      })
    }
  }

  private updateUI(state: ExecutionState): void {
    const { textarea, runtimeSelect, executeBtn, clearBtn, errorDiv, resultDiv } = this.elements
    const { disabled = false } = this.config

    // Update form elements
    if (textarea) {
      textarea.value = state.code
      textarea.disabled = disabled || state.isExecuting
    }

    if (runtimeSelect) {
      runtimeSelect.value = state.runtime
      runtimeSelect.disabled = disabled || state.isExecuting
    }

    if (executeBtn) {
      executeBtn.textContent = state.isExecuting ? 'Executing...' : 'Execute'
      executeBtn.disabled = disabled || state.isExecuting || !state.code.trim()
    }

    if (clearBtn) {
      clearBtn.style.display = (state.result || state.error) ? 'inline-block' : 'none'
      clearBtn.disabled = disabled
    }

    // Update error display
    if (errorDiv) {
      if (state.error) {
        errorDiv.style.display = 'block'
        const errorContent = errorDiv.querySelector('.compute-sdk-error-content')
        if (errorContent) {
          errorContent.textContent = state.error
        }
      } else {
        errorDiv.style.display = 'none'
      }
    }

    // Update result display
    if (resultDiv) {
      if (state.result) {
        resultDiv.style.display = 'block'
        
        // Update meta information
        const metaDiv = resultDiv.querySelector('.compute-sdk-meta') as HTMLElement
        const providerSpan = resultDiv.querySelector('.compute-sdk-provider') as HTMLElement
        const timeSpan = resultDiv.querySelector('.compute-sdk-time') as HTMLElement
        
        if (state.result.result && metaDiv && providerSpan && timeSpan) {
          metaDiv.style.display = 'block'
          providerSpan.textContent = `Provider: ${state.result.result.provider}`
          timeSpan.textContent = `Time: ${formatExecutionTime(state.result.result.executionTime)}`
        } else if (metaDiv) {
          metaDiv.style.display = 'none'
        }

        // Update error or output
        const executionErrorDiv = resultDiv.querySelector('.compute-sdk-execution-error') as HTMLElement
        const outputDiv = resultDiv.querySelector('.compute-sdk-output') as HTMLElement
        
        if (isExecutionError(state.result)) {
          if (executionErrorDiv) {
            executionErrorDiv.style.display = 'block'
            const errorContent = executionErrorDiv.querySelector('.compute-sdk-execution-error-content')
            if (errorContent) {
              errorContent.textContent = getErrorMessage(state.result)
            }
          }
          if (outputDiv) {
            outputDiv.style.display = 'none'
          }
        } else {
          if (executionErrorDiv) {
            executionErrorDiv.style.display = 'none'
          }
          if (outputDiv && state.result.result?.output) {
            outputDiv.style.display = 'block'
            const outputContent = outputDiv.querySelector('.compute-sdk-output-content')
            if (outputContent) {
              outputContent.textContent = formatOutput(state.result.result.output)
            }
          } else if (outputDiv) {
            outputDiv.style.display = 'none'
          }
        }
      } else {
        resultDiv.style.display = 'none'
      }
    }
  }

  // Public API
  getState(): ExecutionState {
    return this.manager.getState()
  }

  async executeCode(): Promise<void> {
    await this.manager.executeCode()
  }

  setCode(code: string): void {
    this.manager.setCode(code)
  }

  setRuntime(runtime: Runtime): void {
    this.manager.setRuntime(runtime)
  }

  clearResult(): void {
    this.manager.clearResult()
  }

  subscribe(listener: (state: ExecutionState) => void): () => void {
    return this.manager.subscribe(listener)
  }

  destroy(): void {
    this.manager.destroy()
  }
}

export class CodeExecutionPanel {
  private editor: CodeEditor

  constructor(
    container: HTMLElement | string,
    config: {
      apiEndpoint?: string
      defaultCode?: string
      defaultRuntime?: Runtime
      className?: string
      title?: string
      showControls?: boolean
    } = {}
  ) {
    const {
      title = 'Code Execution',
      className = '',
      showControls = true,
      ...editorConfig
    } = config

    const containerElement = typeof container === 'string' 
      ? document.querySelector(container) as HTMLElement
      : container

    if (!containerElement) {
      throw new Error('Container element not found')
    }

    // Create panel wrapper
    const panelDiv = document.createElement('div')
    panelDiv.className = `compute-sdk-panel ${className}`
    
    if (title) {
      const titleElement = document.createElement('h2')
      titleElement.className = 'compute-sdk-panel-title'
      titleElement.textContent = title
      panelDiv.appendChild(titleElement)
    }

    const editorDiv = document.createElement('div')
    panelDiv.appendChild(editorDiv)
    
    containerElement.appendChild(panelDiv)

    // Create editor
    this.editor = new CodeEditor(editorDiv, {
      ...editorConfig,
      className: showControls ? '' : 'compute-sdk-no-controls'
    })
  }

  // Delegate methods to editor
  getState(): ExecutionState {
    return this.editor.getState()
  }

  async executeCode(): Promise<void> {
    await this.editor.executeCode()
  }

  setCode(code: string): void {
    this.editor.setCode(code)
  }

  setRuntime(runtime: Runtime): void {
    this.editor.setRuntime(runtime)
  }

  clearResult(): void {
    this.editor.clearResult()
  }

  subscribe(listener: (state: ExecutionState) => void): () => void {
    return this.editor.subscribe(listener)
  }

  destroy(): void {
    this.editor.destroy()
  }
}

// Utility functions for direct usage
export function createCodeExecutionManager(apiEndpoint?: string): CodeExecutionManager {
  return new CodeExecutionManager(apiEndpoint)
}

export function createCodeEditor(container: HTMLElement | string, config?: Partial<CodeEditorConfig>): CodeEditor {
  return new CodeEditor(container, config)
}

export function createCodeExecutionPanel(
  container: HTMLElement | string, 
  config?: {
    apiEndpoint?: string
    defaultCode?: string
    defaultRuntime?: Runtime
    className?: string
    title?: string
    showControls?: boolean
  }
): CodeExecutionPanel {
  return new CodeExecutionPanel(container, config)
}

export { formatExecutionTime, formatOutput, isExecutionError, getErrorMessage } from '../src/utils/api.js'
export type { ExecutionState, Runtime, ExecutionResult, CodeEditorConfig } from '../src/types/index.js'