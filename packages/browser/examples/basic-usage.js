/**
 * Basic Browser Sandbox Usage Example
 * 
 * This example demonstrates the core functionality of @computesdk/browser:
 * - Creating a sandbox
 * - File operations
 * - Code execution
 * - Command execution
 */

import { browser } from '@computesdk/browser'

async function basicExample() {
  console.log('🚀 Creating browser sandbox...')
  const sandbox = browser()
  
  console.log(`📦 Sandbox created: ${sandbox.sandboxId}`)
  console.log(`🏠 Provider: ${sandbox.provider}`)
  
  // Get sandbox info
  const info = await sandbox.doGetInfo()
  console.log('ℹ️  Sandbox info:', {
    id: info.id,
    provider: info.provider,
    runtime: info.runtime,
    status: info.status
  })
  
  console.log('\n📁 File Operations Demo:')
  
  // Create a directory structure
  await sandbox.filesystem.mkdir('/project')
  await sandbox.filesystem.mkdir('/project/src')
  await sandbox.filesystem.mkdir('/project/docs')
  
  // Write some files
  await sandbox.filesystem.writeFile('/project/README.md', `# My Project
  
This is a demo project running in the browser sandbox!

## Features
- In-browser execution
- Virtual filesystem
- Command execution
`)
  
  await sandbox.filesystem.writeFile('/project/package.json', JSON.stringify({
    name: 'browser-sandbox-demo',
    version: '1.0.0',
    description: 'Demo project for @computesdk/browser',
    main: 'src/index.js',
    scripts: {
      start: 'node src/index.js'
    }
  }, null, 2))
  
  await sandbox.filesystem.writeFile('/project/src/index.js', `console.log('Hello from browser sandbox!')
console.log('Current time:', new Date().toISOString())

// Demo some JavaScript features
const numbers = [1, 2, 3, 4, 5]
const sum = numbers.reduce((a, b) => a + b, 0)
console.log('Sum of numbers:', sum)

// Demo object manipulation
const project = {
  name: 'Browser Sandbox Demo',
  features: ['filesystem', 'execution', 'commands'],
  awesome: true
}

console.log('Project info:', JSON.stringify(project, null, 2))
`)
  
  // List project contents
  console.log('\n📋 Project structure:')
  const rootFiles = await sandbox.filesystem.readdir('/project')
  for (const file of rootFiles) {
    console.log(`  ${file.isDirectory ? '📁' : '📄'} ${file.name}`)
    if (file.isDirectory) {
      const subFiles = await sandbox.filesystem.readdir(file.path)
      for (const subFile of subFiles) {
        console.log(`    ${subFile.isDirectory ? '📁' : '📄'} ${subFile.name}`)
      }
    }
  }
  
  console.log('\n⚡ Code Execution Demo:')
  
  // Execute the main file
  const mainCode = await sandbox.filesystem.readFile('/project/src/index.js')
  const result = await sandbox.runCode(mainCode)
  
  console.log('📤 Execution output:')
  console.log(result.stdout)
  
  if (result.stderr) {
    console.log('❌ Errors:')
    console.log(result.stderr)
  }
  
  console.log(`✅ Exit code: ${result.exitCode}`)
  console.log(`⏱️  Execution time: ${result.executionTime}ms`)
  
  console.log('\n🖥️  Command Execution Demo:')
  
  // Test various commands
  const commands = [
    ['pwd'],
    ['echo', ['Hello', 'from', 'browser', 'commands!']],
    ['ls', ['/project']],
    ['ls', ['/project/src']]
  ]
  
  for (const [cmd, args = []] of commands) {
    const cmdResult = await sandbox.runCommand(cmd, args)
    console.log(`$ ${cmd} ${args.join(' ')}`)
    if (cmdResult.stdout) {
      console.log(cmdResult.stdout.trim())
    }
    if (cmdResult.stderr) {
      console.log(`Error: ${cmdResult.stderr.trim()}`)
    }
    console.log('')
  }
  
  console.log('🎉 Demo completed successfully!')
}

// Run the example
basicExample().catch(console.error)