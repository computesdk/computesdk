<script lang="ts">
  import { createCompute } from '@computesdk/ui';
  
  let output = '';
  const compute = createCompute({ apiEndpoint: '/api/compute' });

  async function runCode() {
    try {
      const sandbox = await compute.sandbox.create();
      const result = await sandbox.runCode('print("Hello from ComputeSDK!")');
      output = result.result?.stdout || 'No output';
      await sandbox.destroy();
    } catch (error) {
      output = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }
</script>

<svelte:head>
  <title>ComputeSDK + SvelteKit</title>
</svelte:head>

<main style="padding: 2rem;">
  <h1>ComputeSDK + SvelteKit</h1>
  <button on:click={runCode}>Run Code</button>
  {#if output}
    <pre style="margin-top: 1rem; padding: 1rem; background: #f5f5f5;">{output}</pre>
  {/if}
</main>