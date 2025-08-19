<template>
  <main style="padding: 2rem;">
    <h1>ComputeSDK + Nuxt</h1>
    <button @click="runCode">Run Code</button>
    <pre v-if="output" style="margin-top: 1rem; padding: 1rem; background: #f5f5f5;">{{ output }}</pre>
  </main>
</template>

<script setup>
import { ref } from 'vue'
import { createCompute } from '@computesdk/ui'

useHead({
  title: 'ComputeSDK + Nuxt'
})

const output = ref('')
const compute = createCompute({ apiEndpoint: '/api/compute' })

async function runCode() {
  try {
    const sandbox = await compute.sandbox.create()
    const result = await sandbox.runCode('print("Hello from ComputeSDK!")')
    output.value = result.result?.stdout || 'No output'
    await sandbox.destroy()
  } catch (error) {
    output.value = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
  }
}
</script>