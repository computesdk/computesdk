# UI Package (@computesdk/ui)

The `@computesdk/ui` package provides React components and utilities for integrating ComputeSDK into your frontend applications. It offers both UI components for user interaction and headless hooks for building custom interfaces.

## Installation

```bash
npm install @computesdk/ui
# or
pnpm add @computesdk/ui
# or
yarn add @computesdk/ui
```

## Quick Start

```tsx
import { ComputeProvider, Terminal } from '@computesdk/ui'

export default function App() {
  return (
    <ComputeProvider provider="e2b" apiKey="your-api-key">
      <Terminal />
    </ComputeProvider>
  )
}
```

## Core Components

### ComputeProvider

The root provider component that manages the ComputeSDK instance and provides context to child components.

```tsx
import { ComputeProvider } from '@computesdk/ui'

interface ComputeProviderProps {
  provider: 'e2b' | 'vercel' | 'codesandbox' | 'blaxel' | 'daytona' | 'modal'
  apiKey?: string
  config?: ComputeConfig
  children: React.ReactNode
}

function App() {
  return (
    <ComputeProvider 
      provider="e2b" 
      apiKey={process.env.E2B_API_KEY}
      config={{
        template: 'base',
        metadata: { project: 'my-app' }
      }}
    >
      <YourApp />
    </ComputeProvider>
  )
}
```

### Terminal

Interactive terminal component with full shell access.

```tsx
import { Terminal } from '@computesdk/ui'

function CodeEditor() {
  return (
    <div className="h-96">
      <Terminal 
        onCommand={(command) => console.log('Executed:', command)}
        onOutput={(output) => console.log('Output:', output)}
        className="h-full"
      />
    </div>
  )
}
```

#### Terminal Props

```tsx
interface TerminalProps {
  onCommand?: (command: string) => void
  onOutput?: (output: string) => void
  onError?: (error: string) => void
  className?: string
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
}
```

### FileExplorer

File tree component for browsing and managing sandbox files.

```tsx
import { FileExplorer } from '@computesdk/ui'

function IDE() {
  return (
    <div className="flex h-screen">
      <div className="w-64 border-r">
        <FileExplorer 
          onFileSelect={(path) => console.log('Selected:', path)}
          onFileCreate={(path) => console.log('Created:', path)}
          onFileDelete={(path) => console.log('Deleted:', path)}
        />
      </div>
      <div className="flex-1">
        {/* Code editor */}
      </div>
    </div>
  )
}
```

#### FileExplorer Props

```tsx
interface FileExplorerProps {
  onFileSelect?: (path: string) => void
  onFileCreate?: (path: string) => void
  onFileDelete?: (path: string) => void
  onFolderToggle?: (path: string, expanded: boolean) => void
  allowCreate?: boolean
  allowDelete?: boolean
  className?: string
}
```

### CodeRunner

Component for executing code with output display.

```tsx
import { CodeRunner } from '@computesdk/ui'

function Playground() {
  return (
    <CodeRunner
      language="python"
      initialCode="print('Hello, World!')"
      onExecute={(code) => console.log('Executing:', code)}
      onResult={(result) => console.log('Result:', result)}
      showLineNumbers
      theme="dark"
    />
  )
}
```

#### CodeRunner Props

```tsx
interface CodeRunnerProps {
  language?: string
  initialCode?: string
  onExecute?: (code: string) => void
  onResult?: (result: ExecutionResult) => void
  showLineNumbers?: boolean
  theme?: 'light' | 'dark'
  className?: string
  readOnly?: boolean
}
```

## Hooks

### useCompute

Core hook for accessing the ComputeSDK instance.

```tsx
import { useCompute } from '@computesdk/ui'

function CustomComponent() {
  const { 
    compute,
    connected,
    connecting,
    error,
    connect,
    disconnect
  } = useCompute()

  React.useEffect(() => {
    if (!connected) {
      connect()
    }
  }, [connected, connect])

  if (connecting) return <div>Connecting...</div>
  if (error) return <div>Error: {error.message}</div>

  return (
    <button onClick={() => compute.exec('ls -la')}>
      List Files
    </button>
  )
}
```

### useTerminal

Hook for terminal functionality without the UI component.

```tsx
import { useTerminal } from '@computesdk/ui'

function CustomTerminal() {
  const {
    output,
    input,
    setInput,
    execute,
    clear,
    history
  } = useTerminal()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    execute(input)
    setInput('')
  }

  return (
    <div>
      <pre>{output}</pre>
      <form onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter command..."
        />
      </form>
    </div>
  )
}
```

### useFileSystem

Hook for file operations.

```tsx
import { useFileSystem } from '@computesdk/ui'

function FileManager() {
  const {
    files,
    currentPath,
    readFile,
    writeFile,
    deleteFile,
    createFolder,
    navigate
  } = useFileSystem()

  const handleFileRead = async (path: string) => {
    const content = await readFile(path)
    console.log(content)
  }

  return (
    <div>
      <div>Current: {currentPath}</div>
      {files.map(file => (
        <div key={file.path}>
          <span onClick={() => handleFileRead(file.path)}>
            {file.name}
          </span>
        </div>
      ))}
    </div>
  )
}
```

### useCodeExecution

Hook for running code with execution state management.

```tsx
import { useCodeExecution } from '@computesdk/ui'

function CodePlayground() {
  const {
    execute,
    result,
    loading,
    error,
    history
  } = useCodeExecution()

  const runCode = async () => {
    await execute('python', 'print("Hello from Python!")')
  }

  return (
    <div>
      <button onClick={runCode} disabled={loading}>
        {loading ? 'Running...' : 'Run Code'}
      </button>
      {result && (
        <pre>{result.stdout}</pre>
      )}
      {error && (
        <div style={{ color: 'red' }}>{error.message}</div>
      )}
    </div>
  )
}
```

## TypeScript Interfaces

```tsx
interface ComputeConfig {
  template?: string
  metadata?: Record<string, any>
  timeoutMs?: number
  keepAlive?: boolean
}

interface ExecutionResult {
  stdout: string
  stderr: string
  exitCode: number
  executionTime: number
}

interface FileSystemItem {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  modified?: Date
}

interface TerminalSession {
  id: string
  output: string[]
  history: string[]
  workingDirectory: string
}
```

## Styling

### Default Styles

The UI components come with minimal default styling. Import the base styles:

```tsx
import '@computesdk/ui/styles.css'
```

### Custom Styling

All components accept `className` props for custom styling:

```tsx
<Terminal 
  className="border rounded-lg p-4 bg-black text-green-400 font-mono"
/>

<FileExplorer 
  className="bg-gray-100 dark:bg-gray-800"
/>
```

### Theme Support

Components support light/dark themes:

```tsx
<ComputeProvider theme="dark">
  <Terminal />
</ComputeProvider>
```

## Error Handling

```tsx
import { ComputeErrorBoundary } from '@computesdk/ui'

function App() {
  return (
    <ComputeErrorBoundary
      fallback={({ error, retry }) => (
        <div>
          <h2>Something went wrong</h2>
          <p>{error.message}</p>
          <button onClick={retry}>Try Again</button>
        </div>
      )}
    >
      <ComputeProvider provider="e2b">
        <YourApp />
      </ComputeProvider>
    </ComputeErrorBoundary>
  )
}
```

## Best Practices

1. **Provider Placement**: Place `ComputeProvider` at the root of your compute-enabled components
2. **Connection Management**: Use the `useCompute` hook to manage connection state
3. **Error Boundaries**: Always wrap compute components with error boundaries
4. **Resource Cleanup**: Components automatically handle cleanup on unmount
5. **Performance**: Use React.memo for components that render frequently

## Framework Integration

### Next.js

```tsx
// pages/_app.tsx
import { ComputeProvider } from '@computesdk/ui'
import '@computesdk/ui/styles.css'

export default function App({ Component, pageProps }) {
  return (
    <ComputeProvider provider="vercel" apiKey={process.env.VERCEL_API_KEY}>
      <Component {...pageProps} />
    </ComputeProvider>
  )
}
```

### Vite/React

```tsx
// main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ComputeProvider } from '@computesdk/ui'
import App from './App'
import '@computesdk/ui/styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ComputeProvider provider="e2b" apiKey={import.meta.env.VITE_E2B_API_KEY}>
      <App />
    </ComputeProvider>
  </StrictMode>
)
```

## Examples

Check out complete examples in our [examples directory](../../examples/):

- [Next.js Integration](../../examples/nextjs/)
- [Vite + React](../../examples/basic/)
- [Custom IDE](../../examples/ide/)

## Related Documentation

- [Overview](./overview.md) - SDK architecture and concepts
- [Configuration](./configuration.md) - Global configuration options
- [Code Execution](./code-execution.md) - Running code and commands
- [Providers](../providers/) - Provider-specific documentation