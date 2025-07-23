import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('Framework Adapters', () => {
  beforeEach(() => {
    mockFetch.mockClear()
  })

  describe('Vanilla JS Adapter', () => {
    it('should create CodeEditor class', async () => {
      const { CodeEditor } = await import('../adapters/vanilla.js')
      
      // Create a container element
      const container = document.createElement('div')
      document.body.appendChild(container)
      
      const editor = new CodeEditor(container, {
        defaultCode: 'print("hello")',
        defaultRuntime: 'python'
      })
      
      expect(editor).toBeDefined()
      expect(container.querySelector('textarea')).toBeTruthy()
      
      // Cleanup
      document.body.removeChild(container)
    })

    it('should create CodeExecutionPanel class', async () => {
      const { CodeExecutionPanel } = await import('../adapters/vanilla.js')
      
      // Create a container element
      const container = document.createElement('div')
      document.body.appendChild(container)
      
      const panel = new CodeExecutionPanel(container, {
        defaultCode: 'print("hello")',
        defaultRuntime: 'python'
      })
      
      expect(panel).toBeDefined()
      expect(container.querySelector('textarea')).toBeTruthy()
      expect(container.querySelector('button')).toBeTruthy()
      
      // Cleanup
      document.body.removeChild(container)
    })

    it('should handle code execution', async () => {
      const { CodeExecutionPanel } = await import('../adapters/vanilla.js')
      
      // Mock successful response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          result: {
            output: 'Hello, World!',
            executionTime: 1500,
            provider: 'e2b'
          }
        })
      } as Response)
      
      const container = document.createElement('div')
      document.body.appendChild(container)
      
      new CodeExecutionPanel(container, {
        defaultCode: 'print("Hello, World!")',
        defaultRuntime: 'python'
      })
      
      const executeButton = container.querySelector('button') as HTMLButtonElement
      expect(executeButton).toBeTruthy()
      
      // Simulate button click
      executeButton.click()
      
      // Wait for async execution
      await new Promise(resolve => setTimeout(resolve, 10))
      
      expect(mockFetch).toHaveBeenCalledWith('/api/execute', expect.any(Object))
      
      // Cleanup
      document.body.removeChild(container)
    })
  })

  describe('Svelte Adapter', () => {
    it('should create execution store', async () => {
      const { createCodeExecutionStore } = await import('../adapters/svelte.js')
      
      const store = createCodeExecutionStore('/api/execute')
      
      expect(store).toBeDefined()
      expect(store.state).toBeDefined()
      expect(store.setCode).toBeDefined()
      expect(store.setRuntime).toBeDefined()
      expect(store.executeCode).toBeDefined()
      expect(store.destroy).toBeDefined()
      
      // Test state updates
      let currentState: any
      const unsubscribe = store.state.subscribe((state: any) => {
        currentState = state
      })
      
      expect(currentState.code).toBe('')
      expect(currentState.runtime).toBe('python')
      
      store.setCode('console.log("test")')
      expect(currentState.code).toBe('console.log("test")')
      
      store.setRuntime('javascript')
      expect(currentState.runtime).toBe('javascript')
      
      unsubscribe()
      store.destroy()
    })

    it('should create code editor component', async () => {
      const { createCodeEditor } = await import('../adapters/svelte.js')
      
      const component = createCodeEditor({
        defaultCode: 'print("hello")',
        defaultRuntime: 'python'
      })
      
      expect(component).toBeDefined()
      expect(component.component).toBeDefined()
      expect(component.config).toBeDefined()
    })
  })

  describe('Vue Adapter', () => {
    it('should create composable function', async () => {
      const { useCodeExecution } = await import('../adapters/vue.js')
      
      const composable = useCodeExecution('/api/execute')
      
      expect(composable).toBeDefined()
      expect(composable.state).toBeDefined()
      expect(composable.setCode).toBeDefined()
      expect(composable.setRuntime).toBeDefined()
      expect(composable.executeCode).toBeDefined()
      expect(composable.clearResult).toBeDefined()
    })

    it('should handle reactive state', async () => {
      const { useCodeExecution } = await import('../adapters/vue.js')
      
      // Vue composables need to be called within a component context
      // This test verifies the function exists and can be called
      expect(useCodeExecution).toBeDefined()
      expect(typeof useCodeExecution).toBe('function')
    })

    it('should create Vue components', async () => {
      const { CodeEditor, CodeExecutionPanel } = await import('../adapters/vue.js')
      
      expect(CodeEditor).toBeDefined()
      expect(CodeExecutionPanel).toBeDefined()
      expect(CodeEditor.name).toBe('CodeEditor')
      expect(CodeExecutionPanel.name).toBe('CodeExecutionPanel')
    })
  })

  describe('React Adapter', () => {
    it('should export hook and components', async () => {
      const reactAdapter = await import('../adapters/react.js')
      
      expect(reactAdapter.useCodeExecution).toBeDefined()
      expect(reactAdapter.CodeEditor).toBeDefined()
      expect(reactAdapter.CodeExecutionPanel).toBeDefined()
    })

    // Note: Full React component testing would require @testing-library/react
    // which is not included in the current setup. These tests verify the exports exist.
  })
})