// @ts-nocheck
import { ref, computed, onMounted, onUnmounted, defineComponent, h } from 'vue'
import { createCodeExecutionHook } from '../src/hooks/useCodeExecution.js'
import { formatExecutionTime, formatOutput, isExecutionError, getErrorMessage } from '../src/utils/api.js'
import type { CodeEditorConfig, ExecutionState, Runtime } from '../src/types/index.js'

const executionHook = createCodeExecutionHook()

export function useCodeExecution(apiEndpoint: string = '/api/execute') {
  const state = ref<ExecutionState>(executionHook.getState())
  let unsubscribe: (() => void) | null = null

  onMounted(() => {
    unsubscribe = executionHook.subscribe(() => {
      state.value = executionHook.getState()
    })
  })

  onUnmounted(() => {
    if (unsubscribe) {
      unsubscribe()
    }
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

  return {
    state: computed(() => state.value),
    executeCode,
    setCode,
    setRuntime,
    clearResult
  }
}

interface CodeEditorProps extends Omit<CodeEditorConfig, 'apiEndpoint'> {
  apiEndpoint?: string
  onCodeChange?: (code: string) => void
  onRuntimeChange?: (runtime: Runtime) => void
  onExecute?: () => void
  onClear?: () => void
}

export const CodeEditor = defineComponent<CodeEditorProps>({
  name: 'CodeEditor',
  props: {
    apiEndpoint: {
      type: String,
      default: '/api/execute'
    },
    defaultCode: {
      type: String,
      default: ''
    },
    defaultRuntime: {
      type: String as () => Runtime,
      default: 'python' as Runtime
    },
    placeholder: {
      type: String,
      default: 'Enter your code here...'
    },
    disabled: {
      type: Boolean,
      default: false
    },
    className: {
      type: String,
      default: ''
    },
    onCodeChange: {
      type: Function,
      required: false
    },
    onRuntimeChange: {
      type: Function,
      required: false
    },
    onExecute: {
      type: Function,
      required: false
    },
    onClear: {
      type: Function,
      required: false
    }
  },
  setup(props: any) {
    const {
      state,
      executeCode,
      setCode,
      setRuntime,
      clearResult
    } = useCodeExecution(props.apiEndpoint)

    // Initialize with default values
    onMounted(() => {
      if (props.defaultCode && !state.value.code) {
        setCode(props.defaultCode)
      }
      if (props.defaultRuntime && state.value.runtime !== props.defaultRuntime) {
        setRuntime(props.defaultRuntime)
      }
    })

    const handleCodeChange = (event: Event) => {
      const target = event.target as HTMLTextAreaElement
      const newCode = target.value
      setCode(newCode)
      props.onCodeChange?.(newCode)
    }

    const handleRuntimeChange = (event: Event) => {
      const target = event.target as HTMLSelectElement
      const newRuntime = target.value as Runtime
      setRuntime(newRuntime)
      props.onRuntimeChange?.(newRuntime)
    }

    const handleExecute = async () => {
      await executeCode()
      props.onExecute?.()
    }

    const handleClear = () => {
      clearResult()
      props.onClear?.()
    }

    return {
      state,
      handleCodeChange,
      handleRuntimeChange,
      handleExecute,
      handleClear,
      formatExecutionTime,
      formatOutput,
      isExecutionError,
      getErrorMessage
    }
  },
  render() {
    return h('div', { class: `compute-sdk-editor ${this.className}` }, [
      // Controls
      h('div', { class: 'compute-sdk-controls' }, [
        // Runtime selector
        h('div', { class: 'compute-sdk-runtime-selector' }, [
          h('label', { for: 'runtime' }, 'Runtime:'),
          h('select', {
            id: 'runtime',
            value: this.state.runtime,
            onChange: this.handleRuntimeChange,
            disabled: this.disabled || this.state.isExecuting
          }, [
            h('option', { value: 'python' }, 'Python'),
            h('option', { value: 'javascript' }, 'JavaScript')
          ])
        ]),
        
        // Actions
        h('div', { class: 'compute-sdk-actions' }, [
          h('button', {
            onClick: this.handleExecute,
            disabled: this.disabled || this.state.isExecuting || !this.state.code.trim(),
            class: 'compute-sdk-execute-btn'
          }, this.state.isExecuting ? 'Executing...' : 'Execute'),
          
          (this.state.result || this.state.error) && h('button', {
            onClick: this.handleClear,
            disabled: this.disabled,
            class: 'compute-sdk-clear-btn'
          }, 'Clear')
        ])
      ]),

      // Code area
      h('div', { class: 'compute-sdk-code-area' }, [
        h('textarea', {
          value: this.state.code,
          onInput: this.handleCodeChange,
          placeholder: this.placeholder,
          disabled: this.disabled || this.state.isExecuting,
          class: 'compute-sdk-textarea',
          rows: 10
        })
      ]),

      // Results
      this.state.result && h('div', { class: 'compute-sdk-result' }, [
        h('h4', {}, `Result (${this.formatExecutionTime(this.state.result.executionTime)})`),
        h('pre', { class: 'compute-sdk-output' }, this.formatOutput(this.state.result))
      ]),

      // Errors
      this.state.error && h('div', { class: 'compute-sdk-error' }, [
        h('h4', {}, 'Error'),
        h('pre', { class: 'compute-sdk-error-output' }, 
          this.isExecutionError(this.state.error) 
            ? this.getErrorMessage(this.state.error)
            : this.formatOutput(this.state.error)
        )
      ])
    ])
  }
})

interface CodeExecutionPanelProps {
  apiEndpoint?: string
  defaultCode?: string
  defaultRuntime?: Runtime
  className?: string
  title?: string
  showControls?: boolean
}

export const CodeExecutionPanel = defineComponent<CodeExecutionPanelProps>({
  name: 'CodeExecutionPanel',
  props: {
    apiEndpoint: {
      type: String,
      default: '/api/execute'
    },
    defaultCode: {
      type: String,
      default: ''
    },
    defaultRuntime: {
      type: String as () => Runtime,
      default: 'python' as Runtime
    },
    className: {
      type: String,
      default: ''
    },
    title: {
      type: String,
      default: 'Code Execution'
    },
    showControls: {
      type: Boolean,
      default: true
    }
  },
  render() {
    return h('div', { class: `compute-sdk-panel ${this.className}` }, [
      this.title && h('h2', { class: 'compute-sdk-panel-title' }, this.title),
      h(CodeEditor, {
        apiEndpoint: this.apiEndpoint,
        defaultCode: this.defaultCode,
        defaultRuntime: this.defaultRuntime,
        className: this.showControls ? '' : 'compute-sdk-no-controls'
      })
    ])
  }
})

export { formatExecutionTime, formatOutput, isExecutionError, getErrorMessage } from '../src/utils/api.js'
export type { ExecutionState, Runtime, ExecutionResult, CodeEditorConfig } from '../src/types/index.js'