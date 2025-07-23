import React, { useState, useEffect, useCallback } from 'react'
import { createCodeExecutionHook } from '../src/hooks/useCodeExecution.js'
import { formatExecutionTime, formatOutput, isExecutionError, getErrorMessage } from '../src/utils/api.js'
import type { CodeEditorConfig, ExecutionState, Runtime } from '../src/types/index.js'

const executionHook = createCodeExecutionHook()

export function useCodeExecution(apiEndpoint: string = '/api/execute'): ExecutionState & {
  executeCode: () => Promise<void>;
  setCode: (code: string) => void;
  setRuntime: (runtime: Runtime) => void;
  clearResult: () => void;
} {
  const [state, setState] = useState<ExecutionState>(executionHook.getState())

  useEffect(() => {
    const unsubscribe = executionHook.subscribe(() => {
      setState(executionHook.getState())
    })
    return unsubscribe
  }, [])

  const executeCode = useCallback(async () => {
    await executionHook.executeCode(apiEndpoint)
  }, [apiEndpoint])

  const setCode = useCallback((code: string) => {
    executionHook.setCode(code)
  }, [])

  const setRuntime = useCallback((runtime: Runtime) => {
    executionHook.setRuntime(runtime)
  }, [])

  const clearResult = useCallback(() => {
    executionHook.clearResult()
  }, [])

  return {
    ...state,
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

export function CodeEditor({
  apiEndpoint = '/api/execute',
  defaultCode = '',
  defaultRuntime = 'python',
  placeholder = 'Enter your code here...',
  disabled = false,
  className = '',
  onCodeChange,
  onRuntimeChange,
  onExecute,
  onClear
}: CodeEditorProps): React.JSX.Element {
  const {
    code,
    runtime,
    isExecuting,
    result,
    error,
    executeCode,
    setCode,
    setRuntime,
    clearResult
  } = useCodeExecution(apiEndpoint)

  useEffect(() => {
    if (defaultCode && !code) {
      setCode(defaultCode)
    }
  }, [defaultCode, code, setCode])

  useEffect(() => {
    if (defaultRuntime && runtime !== defaultRuntime) {
      setRuntime(defaultRuntime)
    }
  }, [defaultRuntime, runtime, setRuntime])

  const handleCodeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newCode = e.target.value
    setCode(newCode)
    onCodeChange?.(newCode)
  }

  const handleRuntimeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newRuntime = e.target.value as Runtime
    setRuntime(newRuntime)
    onRuntimeChange?.(newRuntime)
  }

  const handleExecute = async () => {
    await executeCode()
    onExecute?.()
  }

  const handleClear = () => {
    clearResult()
    onClear?.()
  }

  return (
    <div className={`compute-sdk-editor ${className}`}>
      <div className="compute-sdk-controls">
        <div className="compute-sdk-runtime-selector">
          <label htmlFor="runtime">Runtime:</label>
          <select
            id="runtime"
            value={runtime}
            onChange={handleRuntimeChange}
            disabled={disabled || isExecuting}
          >
            <option value="python">Python</option>
            <option value="javascript">JavaScript</option>
          </select>
        </div>
        
        <div className="compute-sdk-actions">
          <button
            onClick={handleExecute}
            disabled={disabled || isExecuting || !code.trim()}
            className="compute-sdk-execute-btn"
          >
            {isExecuting ? 'Executing...' : 'Execute'}
          </button>
          
          {(result || error) && (
            <button
              onClick={handleClear}
              disabled={disabled}
              className="compute-sdk-clear-btn"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="compute-sdk-code-area">
        <textarea
          value={code}
          onChange={handleCodeChange}
          placeholder={placeholder}
          disabled={disabled || isExecuting}
          className="compute-sdk-textarea"
          rows={10}
        />
      </div>

      {error && (
        <div className="compute-sdk-error">
          <h4>Error</h4>
          <pre>{error}</pre>
        </div>
      )}

      {result && (
        <div className="compute-sdk-result">
          <div className="compute-sdk-result-header">
            <h4>Result</h4>
            {result.result && (
              <div className="compute-sdk-meta">
                <span className="compute-sdk-provider">
                  Provider: {result.result.provider}
                </span>
                <span className="compute-sdk-time">
                  Time: {formatExecutionTime(result.result.executionTime)}
                </span>
              </div>
            )}
          </div>
          
          {isExecutionError(result) ? (
            <div className="compute-sdk-execution-error">
              <h5>Execution Error</h5>
              <pre>{getErrorMessage(result)}</pre>
            </div>
          ) : (
            result.result?.output && (
              <div className="compute-sdk-output">
                <h5>Output</h5>
                <pre>{formatOutput(result.result.output)}</pre>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}

interface CodeExecutionPanelProps {
  apiEndpoint?: string
  defaultCode?: string
  defaultRuntime?: Runtime
  className?: string
  title?: string
  showControls?: boolean
}

export function CodeExecutionPanel({
  apiEndpoint = '/api/execute',
  defaultCode = '',
  defaultRuntime = 'python',
  className = '',
  title = 'Code Execution',
  showControls = true
}: CodeExecutionPanelProps): React.JSX.Element {
  return (
    <div className={`compute-sdk-panel ${className}`}>
      {title && <h2 className="compute-sdk-panel-title">{title}</h2>}
      <CodeEditor
        apiEndpoint={apiEndpoint}
        defaultCode={defaultCode}
        defaultRuntime={defaultRuntime}
        className={showControls ? '' : 'compute-sdk-no-controls'}
      />
    </div>
  )
}

export { formatExecutionTime, formatOutput, isExecutionError, getErrorMessage } from '../src/utils/api.js'
export type { ExecutionState, Runtime, ExecutionResult, CodeEditorConfig } from '../src/types/index.js'