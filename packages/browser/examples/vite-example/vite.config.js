import { defineConfig } from 'vite'

export default defineConfig({
  // Enable worker imports
  worker: {
    format: 'es'
  },
  
  // Enable SharedArrayBuffer for LiveStore
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin'
    }
  },
  
  // Optimize dependencies
  optimizeDeps: {
    include: ['@computesdk/browser']
  }
})