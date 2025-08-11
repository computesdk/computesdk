'use client'

import { useState } from 'react'
import { useCompute } from '@computesdk/ui'

export default function Home() {
  const [output, setOutput] = useState('')
  const compute = useCompute({ apiEndpoint: '/api/compute' })

  const runCode = async () => {
    try {
      const sandbox = await compute.sandbox.create()
      const result = await sandbox.runCode('print("Hello from ComputeSDK!")')
      setOutput(result.result?.stdout || 'No output')
      await sandbox.destroy()
    } catch (error) {
      setOutput(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  return (
    <main style={{ padding: '2rem' }}>
      <h1>ComputeSDK + Next.js</h1>
      <button onClick={runCode}>Run Code</button>
      {output && <pre style={{ marginTop: '1rem', padding: '1rem', background: '#f5f5f5' }}>{output}</pre>}
    </main>
  )
}