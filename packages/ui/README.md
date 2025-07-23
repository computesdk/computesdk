# @computesdk/ui

Standardized UI components for ComputeSDK framework integrations. Provides consistent code execution interfaces across React, Vue, Svelte, and Vanilla JavaScript.

## Installation

```bash
npm install @computesdk/ui
```

## Framework Adapters

### React

```tsx
import { CodeExecutionPanel } from '@computesdk/ui/react'

function App() {
  return (
    <CodeExecutionPanel 
      apiEndpoint="/api/execute"
      defaultCode='print("Hello World!")'
      defaultRuntime="python"
    />
  )
}
```

### Vue

```vue
<template>
  <CodeExecutionComponent 
    api-endpoint="/api/execute"
    initial-code='print("Hello World!")'
    initial-runtime="python"
  />
</template>

<script setup>
import { CodeExecutionComponent } from '@computesdk/ui/vue'
</script>
```

### Svelte

```svelte
<script>
  import { onMount } from 'svelte'
  import { createCodeExecutionStore } from '@computesdk/ui/svelte'

  let container

  onMount(() => {
    const store = createCodeExecutionStore({
      apiEndpoint: '/api/execute',
      initialCode: 'print("Hello World!")',
      initialRuntime: 'python'
    })
    store.mount(container)
  })
</script>

<div bind:this={container}></div>
```

### Vanilla JavaScript

```html
<div id="code-execution"></div>

<script type="module">
  import { createCodeExecutionComponent } from '@computesdk/ui/vanilla'
  
  const container = document.getElementById('code-execution')
  createCodeExecutionComponent(container, {
    apiEndpoint: '/api/execute',
    initialCode: 'print("Hello World!")',
    initialRuntime: 'python'
  })
</script>
```

## Features

- **Unified API** - Consistent interface across all frameworks
- **Built-in State Management** - Loading states, error handling, and execution results
- **Runtime Selection** - Support for Python and JavaScript execution
- **Responsive Design** - Mobile-friendly with Tailwind CSS classes
- **TypeScript Support** - Full type safety (when types are enabled)
- **Framework Native** - Uses each framework's conventions (hooks, composables, stores)

## API Reference

### Common Props/Options

- `apiEndpoint` - API endpoint for code execution (default: `/api/execute`)
- `initialCode`/`defaultCode` - Initial code in the editor
- `initialRuntime`/`defaultRuntime` - Initial runtime selection (`python` | `javascript`)
- `className` - Additional CSS classes
- `title` - Panel title (React only)
- `showControls` - Show/hide runtime controls (React only)

### Expected API Response

Your API endpoint should return:

```typescript
interface ExecutionResult {
  success: boolean
  result?: {
    output: string
    error?: string
    executionTime: number
    provider: string
  }
  error?: string
}
```

## Styling

Components use Tailwind CSS classes. Include Tailwind in your project or provide equivalent styles:

```html
<script src="https://cdn.tailwindcss.com"></script>
```

## Examples

See the [ComputeSDK examples](https://github.com/sst/computesdk/tree/main/examples) for complete framework integrations:

- [Next.js](https://github.com/sst/computesdk/tree/main/examples/nextjs)
- [Nuxt](https://github.com/sst/computesdk/tree/main/examples/nuxt)  
- [SvelteKit](https://github.com/sst/computesdk/tree/main/examples/sveltekit)
- [Astro](https://github.com/sst/computesdk/tree/main/examples/astro)

## License

MIT