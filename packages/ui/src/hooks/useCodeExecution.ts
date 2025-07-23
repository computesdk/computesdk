import type { ExecutionState, ExecutionResult, CodeExecutionHook, Runtime } from '../types/index.js'

export function createCodeExecutionHook(): CodeExecutionHook {
  let state: ExecutionState = {
    code: '',
    runtime: 'python',
    isExecuting: false,
    result: null,
    error: null
  }

  const listeners = new Set<() => void>()

  function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function getState(): ExecutionState {
    return { ...state }
  }

  function setState(newState: Partial<ExecutionState>) {
    state = { ...state, ...newState }
    listeners.forEach(listener => listener())
  }

  async function executeCode(apiEndpoint: string = '/api/execute'): Promise<void> {
    if (!state.code.trim()) {
      setState({ error: 'Please enter some code to execute' })
      return
    }

    setState({ 
      isExecuting: true, 
      error: null, 
      result: null 
    })

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: state.code,
          runtime: state.runtime,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`)
      }

      const result: ExecutionResult = await response.json()
      setState({ result, isExecuting: false })
    } catch (error) {
      setState({ 
        error: error instanceof Error ? error.message : 'An unexpected error occurred',
        isExecuting: false 
      })
    }
  }

  function setCode(code: string) {
    setState({ code })
  }

  function setRuntime(runtime: Runtime) {
    setState({ runtime })
  }

  function clearResult() {
    setState({ result: null, error: null })
  }

  return {
    subscribe,
    getState,
    executeCode,
    setCode,
    setRuntime,
    clearResult
  }
}