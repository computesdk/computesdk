import { browser } from '@computesdk/browser'

async function main() {
  const app = document.getElementById('app')
  
  try {
    // Create and initialize the browser sandbox
    const sandbox = browser()
    await sandbox.initialize()
    
    app.innerHTML = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2>✅ ComputeSDK Browser Initialized!</h2>
        <p><strong>Provider:</strong> ${sandbox.provider}</p>
        <p><strong>Sandbox ID:</strong> ${sandbox.sandboxId}</p>
        
        <h3>Try it out:</h3>
        <div style="margin: 20px 0;">
          <button id="writeFile">Write File</button>
          <button id="readFile">Read File</button>
          <button id="listFiles">List Files</button>
          <button id="runCommand">Run Command</button>
        </div>
        
        <div id="output" style="background: #f5f5f5; padding: 15px; border-radius: 5px; white-space: pre-wrap; font-family: monospace; min-height: 100px;"></div>
      </div>
    `
    
    const output = document.getElementById('output')
    
    // Write file example
    document.getElementById('writeFile').onclick = async () => {
      try {
        await sandbox.filesystem.writeFile('/hello.txt', 'Hello from LiveStore!')
        output.textContent = '✅ File written: /hello.txt'
      } catch (error) {
        output.textContent = `❌ Error: ${error.message}`
      }
    }
    
    // Read file example
    document.getElementById('readFile').onclick = async () => {
      try {
        const content = await sandbox.filesystem.readFile('/hello.txt')
        output.textContent = `📄 File content: ${content}`
      } catch (error) {
        output.textContent = `❌ Error: ${error.message}`
      }
    }
    
    // List files example
    document.getElementById('listFiles').onclick = async () => {
      try {
        const files = await sandbox.filesystem.readdir('/')
        output.textContent = `📁 Files:\\n${files.map(f => `${f.isDirectory ? 'd' : '-'} ${f.name}`).join('\\n')}`
      } catch (error) {
        output.textContent = `❌ Error: ${error.message}`
      }
    }
    
    // Run command example
    document.getElementById('runCommand').onclick = async () => {
      try {
        const result = await sandbox.runCommand('echo', ['Hello from browser!'])
        output.textContent = `💻 Command output:\\n${result.stdout}${result.stderr}`
      } catch (error) {
        output.textContent = `❌ Error: ${error.message}`
      }
    }
    
  } catch (error) {
    app.innerHTML = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2>❌ Failed to Initialize</h2>
        <pre style="background: #f8d7da; padding: 15px; border-radius: 5px; white-space: pre-wrap;">${error.message}</pre>
      </div>
    `
  }
}

main().catch(console.error)