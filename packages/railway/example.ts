// Example usage of Railway provider for ComputeSDK

import { createCompute } from 'computesdk'
import { railway } from '@computesdk/railway'

async function example() {
  // Initialize compute with Railway provider
  const compute = createCompute({
    defaultProvider: railway({
      apiKey: process.env.RAILWAY_API_KEY!,
      projectId: process.env.RAILWAY_PROJECT_ID!,
      environmentId: 'production' // optional
    })
  })

  try {
    // Create a sandbox
    console.log('Creating Railway sandbox...')
    const sandbox = await compute.sandbox.create({
      runtime: 'python',
      timeout: 60000,
      metadata: {
        user: 'example',
        session: Date.now().toString()
      }
    })

    console.log('Sandbox created:', sandbox.sandboxId)

    // Execute Python code
    console.log('Executing Python code...')
    const result = await sandbox.runCode(`
print("Hello from Railway!")
import sys
print(f"Python version: {sys.version}")

# Simple calculation
result = 2 + 2
print(f"2 + 2 = {result}")
`)

    console.log('Python output:')
    console.log(result.stdout)

    // Run shell commands
    console.log('Installing package...')
    await sandbox.runCommand('pip', ['install', 'requests'])

    // Test filesystem operations
    console.log('Testing filesystem operations...')
    
    // Write a config file
    await sandbox.filesystem.writeFile('/workspace/config.json', JSON.stringify({
      api: 'v1',
      endpoint: 'https://api.example.com',
      features: ['auth', 'logging']
    }, null, 2))

    // Read the config back
    const config = await sandbox.filesystem.readFile('/workspace/config.json')
    console.log('Config file contents:')
    console.log(config)

    // List files in workspace
    const files = await sandbox.filesystem.readdir('/workspace')
    console.log('Files in workspace:')
    files.forEach(file => {
      console.log(`  ${file.name} - ${file.isDirectory ? 'DIR' : 'FILE'} (${file.size} bytes)`)
    })

    // Get sandbox info
    const info = await sandbox.getInfo()
    console.log('Sandbox info:')
    console.log(`  ID: ${info.id}`)
    console.log(`  Provider: ${info.provider}`)
    console.log(`  Runtime: ${info.runtime}`)
    console.log(`  Status: ${info.status}`)
    console.log(`  Created: ${info.createdAt}`)

    // Clean up
    console.log('Destroying sandbox...')
    await sandbox.destroy()
    console.log('Example completed successfully!')

  } catch (error) {
    console.error('Error in Railway example:', error)
  }
}

// Run example if this file is executed directly
if (require.main === module) {
  example().catch(console.error)
}

export { example }