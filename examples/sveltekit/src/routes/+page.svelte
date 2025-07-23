<script lang="ts">
  import { onMount } from 'svelte';
  import { createCodeExecutionStore } from '@computesdk/ui/svelte';

  let container: HTMLDivElement;

  onMount(() => {
    // Load Tailwind CSS
    const script = document.createElement('script');
    script.src = 'https://cdn.tailwindcss.com';
    document.head.appendChild(script);

    // Initialize the code execution component
    const store = createCodeExecutionStore({
      apiEndpoint: '/api/execute',
      initialCode: 'print("Hello from ComputeSDK!")',
      initialRuntime: 'python'
    });

    // Mount the component to the container
    store.mount(container);
  });
</script>

<svelte:head>
  <title>ComputeSDK + SvelteKit Example</title>
  <meta name="description" content="Example of using ComputeSDK with SvelteKit for server-side code execution" />
</svelte:head>

<main class="container mx-auto p-8 max-w-4xl">
  <h1 class="text-3xl font-bold mb-8">ComputeSDK + SvelteKit Example</h1>
  
  <div bind:this={container}></div>
</main>