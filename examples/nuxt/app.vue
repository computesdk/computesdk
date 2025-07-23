<template>
  <div class="container mx-auto p-8 max-w-4xl">
    <h1 class="text-3xl font-bold mb-8">ComputeSDK + Nuxt Example</h1>
    
    <CodeExecutionComponent 
      api-endpoint="/api/execute"
      initial-code='print("Hello from ComputeSDK!")'
      initial-runtime="python"
    />
  </div>
</template>

<script setup>
import { CodeExecutionComponent } from '@computesdk/ui/vue'

useHead({
  title: 'ComputeSDK + Nuxt Example',
  meta: [
    { name: 'description', content: 'Example of using ComputeSDK with Nuxt for server-side code execution' }
  ],
  script: [
    { src: 'https://cdn.tailwindcss.com' }
  ]
})
</script>