// @ts-nocheck
'use client'

import { CodeExecutionPanel } from '@computesdk/ui/react'

export default function Home() {
  return (
    <main className="container">
      <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '2rem' }}>
        ComputeSDK + Next.js Example
      </h1>
      
      <CodeExecutionPanel 
        apiEndpoint="/api/execute"
        defaultCode='print("Hello from ComputeSDK!")'
        defaultRuntime="python"
      />
    </main>
  )
}