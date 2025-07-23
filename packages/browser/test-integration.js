// Simple integration test for RuntimeManager + Shell
import { browser } from './dist/index.js'

async function testIntegration() {
    console.log('🧪 Testing RuntimeManager + Shell Integration...\n')
    
    try {
        // Initialize sandbox
        console.log('1. Initializing sandbox...')
        const sandbox = browser({ resetPersistence: true })
        await sandbox.initialize()
        console.log('✅ Sandbox initialized\n')
        
        // Test filesystem
        console.log('2. Testing filesystem...')
        await sandbox.filesystem.writeFile('/test.js', 'console.log("Hello from test!");')
        const content = await sandbox.filesystem.readFile('/test.js')
        console.log('✅ File written and read:', content.trim())
        
        // Test shell spawn
        console.log('\n3. Testing shell spawn...')
        const process = sandbox.spawnShell('echo', ['Shell integration working!'])
        
        process.stdout.on('data', (data) => {
            console.log('📤 Shell output:', data.trim())
        })
        
        process.on('exit', (code) => {
            console.log('✅ Shell process exited with code:', code)
            console.log('\n🎉 Integration test completed successfully!')
        })
        
    } catch (error) {
        console.error('❌ Integration test failed:', error.message)
        console.error(error.stack)
    }
}

testIntegration()