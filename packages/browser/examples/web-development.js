/**
 * Web Development Workflow Example
 * 
 * This example demonstrates using the browser sandbox for web development:
 * - Creating HTML/CSS/JS files
 * - Building a simple web page
 * - Processing and validating code
 */

import { browser } from '@computesdk/browser'

async function webDevelopmentExample() {
  console.log('🌐 Web Development Sandbox Demo')
  const sandbox = browser({ cwd: '/workspace' })
  
  // Create project structure
  console.log('\n📁 Setting up project structure...')
  await sandbox.filesystem.mkdir('/workspace')
  await sandbox.filesystem.mkdir('/workspace/src')
  await sandbox.filesystem.mkdir('/workspace/assets')
  await sandbox.filesystem.mkdir('/workspace/assets/css')
  await sandbox.filesystem.mkdir('/workspace/assets/js')
  
  // Create HTML file
  await sandbox.filesystem.writeFile('/workspace/index.html', `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Browser Sandbox Demo</title>
    <link rel="stylesheet" href="assets/css/style.css">
</head>
<body>
    <div class="container">
        <header>
            <h1>🚀 Browser Sandbox Demo</h1>
            <p>Built entirely in the browser!</p>
        </header>
        
        <main>
            <section class="features">
                <h2>Features</h2>
                <ul id="feature-list">
                    <li>Virtual filesystem</li>
                    <li>Code execution</li>
                    <li>Command processing</li>
                </ul>
            </section>
            
            <section class="demo">
                <h2>Interactive Demo</h2>
                <button id="run-demo">Run JavaScript Demo</button>
                <pre id="output"></pre>
            </section>
        </main>
    </div>
    
    <script src="assets/js/app.js"></script>
</body>
</html>`)
  
  // Create CSS file
  await sandbox.filesystem.writeFile('/workspace/assets/css/style.css', `/* Browser Sandbox Demo Styles */
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    line-height: 1.6;
    color: #333;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
}

.container {
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem;
}

header {
    text-align: center;
    margin-bottom: 3rem;
    color: white;
}

header h1 {
    font-size: 2.5rem;
    margin-bottom: 0.5rem;
}

header p {
    font-size: 1.2rem;
    opacity: 0.9;
}

main {
    background: white;
    border-radius: 12px;
    padding: 2rem;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
}

.features, .demo {
    margin-bottom: 2rem;
}

.features h2, .demo h2 {
    color: #4a5568;
    margin-bottom: 1rem;
    border-bottom: 2px solid #e2e8f0;
    padding-bottom: 0.5rem;
}

.features ul {
    list-style: none;
    padding-left: 0;
}

.features li {
    padding: 0.5rem 0;
    padding-left: 1.5rem;
    position: relative;
}

.features li::before {
    content: '✅';
    position: absolute;
    left: 0;
}

button {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    padding: 0.75rem 1.5rem;
    border-radius: 6px;
    font-size: 1rem;
    cursor: pointer;
    transition: transform 0.2s;
}

button:hover {
    transform: translateY(-2px);
}

#output {
    background: #1a202c;
    color: #e2e8f0;
    padding: 1rem;
    border-radius: 6px;
    margin-top: 1rem;
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 0.9rem;
    line-height: 1.4;
    min-height: 100px;
    overflow-x: auto;
}`)
  
  // Create JavaScript file
  await sandbox.filesystem.writeFile('/workspace/assets/js/app.js', `// Browser Sandbox Demo JavaScript
console.log('🚀 Browser Sandbox Demo loaded!')

// Demo data
const demoData = {
    users: [
        { id: 1, name: 'Alice', role: 'Developer' },
        { id: 2, name: 'Bob', role: 'Designer' },
        { id: 3, name: 'Charlie', role: 'Manager' }
    ],
    projects: [
        { id: 1, name: 'Web App', status: 'active' },
        { id: 2, name: 'Mobile App', status: 'planning' },
        { id: 3, name: 'API Service', status: 'completed' }
    ]
}

// Utility functions
function formatData(data) {
    return JSON.stringify(data, null, 2)
}

function processUsers(users) {
    return users.map(user => ({
        ...user,
        displayName: \`\${user.name} (\${user.role})\`
    }))
}

function getActiveProjects(projects) {
    return projects.filter(project => project.status === 'active')
}

// Main demo function
function runDemo() {
    console.log('Running interactive demo...')
    
    const output = document.getElementById('output')
    let result = ''
    
    result += '🎯 Processing demo data...\\n\\n'
    
    // Process users
    const processedUsers = processUsers(demoData.users)
    result += '👥 Processed Users:\\n'
    result += formatData(processedUsers) + '\\n\\n'
    
    // Filter active projects
    const activeProjects = getActiveProjects(demoData.projects)
    result += '📋 Active Projects:\\n'
    result += formatData(activeProjects) + '\\n\\n'
    
    // Calculate statistics
    const stats = {
        totalUsers: demoData.users.length,
        totalProjects: demoData.projects.length,
        activeProjects: activeProjects.length,
        completionRate: Math.round((demoData.projects.filter(p => p.status === 'completed').length / demoData.projects.length) * 100)
    }
    
    result += '📊 Statistics:\\n'
    result += formatData(stats) + '\\n\\n'
    
    result += '✅ Demo completed successfully!'
    
    output.textContent = result
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, setting up event listeners...')
    
    const runButton = document.getElementById('run-demo')
    if (runButton) {
        runButton.addEventListener('click', runDemo)
        console.log('Demo button ready!')
    }
    
    // Add dynamic features to the feature list
    const featureList = document.getElementById('feature-list')
    if (featureList) {
        const dynamicFeatures = [
            'Dynamic content generation',
            'Event handling',
            'Data processing'
        ]
        
        dynamicFeatures.forEach(feature => {
            const li = document.createElement('li')
            li.textContent = feature
            featureList.appendChild(li)
        })
    }
})`)
  
  // Create a build script
  await sandbox.filesystem.writeFile('/workspace/build.js', `// Simple build script for the web project
console.log('🔨 Building web project...')

// Simulate build process
const buildSteps = [
    'Validating HTML structure',
    'Processing CSS styles', 
    'Minifying JavaScript',
    'Optimizing assets',
    'Generating build manifest'
]

buildSteps.forEach((step, index) => {
    console.log(\`[\${index + 1}/\${buildSteps.length}] \${step}...\`)
})

console.log('✅ Build completed successfully!')
console.log('📦 Output: Ready for deployment')

// Return build info
const buildInfo = {
    timestamp: new Date().toISOString(),
    files: {
        'index.html': '2.1 KB',
        'assets/css/style.css': '1.8 KB', 
        'assets/js/app.js': '2.4 KB'
    },
    totalSize: '6.3 KB'
}

console.log('📋 Build Summary:')
console.log(JSON.stringify(buildInfo, null, 2))`)
  
  // Create package.json
  await sandbox.filesystem.writeFile('/workspace/package.json', JSON.stringify({
    name: 'browser-sandbox-web-demo',
    version: '1.0.0',
    description: 'Web development demo using @computesdk/browser',
    main: 'index.html',
    scripts: {
      build: 'node build.js',
      dev: 'echo "Development server would start here"',
      lint: 'echo "Linting HTML, CSS, and JS files"'
    },
    keywords: ['browser', 'sandbox', 'web', 'demo'],
    author: 'ComputeSDK'
  }, null, 2))
  
  console.log('✅ Project files created!')
  
  // Show project structure
  console.log('\\n📋 Project structure:')
  async function showDirectory(path, indent = '') {
    const entries = await sandbox.filesystem.readdir(path)
    for (const entry of entries) {
      console.log(`${indent}${entry.isDirectory ? '📁' : '📄'} ${entry.name}`)
      if (entry.isDirectory) {
        await showDirectory(entry.path, indent + '  ')
      }
    }
  }
  await showDirectory('/workspace')
  
  // Run the build script
  console.log('\\n🔨 Running build process...')
  const buildCode = await sandbox.filesystem.readFile('/workspace/build.js')
  const buildResult = await sandbox.runCode(buildCode)
  console.log(buildResult.stdout)
  
  // Validate HTML structure (simple check)
  console.log('\\n🔍 Validating HTML structure...')
  const htmlContent = await sandbox.filesystem.readFile('/workspace/index.html')
  const validationCode = `
const html = \`${htmlContent.replace(/`/g, '\\`')}\`

console.log('📄 HTML Validation:')
console.log('- DOCTYPE declaration:', html.includes('<!DOCTYPE html>') ? '✅' : '❌')
console.log('- HTML lang attribute:', html.includes('lang=') ? '✅' : '❌')  
console.log('- Meta charset:', html.includes('charset=') ? '✅' : '❌')
console.log('- Meta viewport:', html.includes('viewport') ? '✅' : '❌')
console.log('- Title tag:', html.includes('<title>') ? '✅' : '❌')
console.log('- CSS link:', html.includes('stylesheet') ? '✅' : '❌')
console.log('- JavaScript script:', html.includes('<script') ? '✅' : '❌')

// Count elements
const elementCounts = {
  divs: (html.match(/<div/g) || []).length,
  sections: (html.match(/<section/g) || []).length,
  buttons: (html.match(/<button/g) || []).length,
  lists: (html.match(/<ul/g) || []).length
}

console.log('\\n📊 Element counts:')
console.log(JSON.stringify(elementCounts, null, 2))
`
  
  const validationResult = await sandbox.runCode(validationCode)
  console.log(validationResult.stdout)
  
  // Test JavaScript functionality
  console.log('\\n⚡ Testing JavaScript functionality...')
  const jsContent = await sandbox.filesystem.readFile('/workspace/assets/js/app.js')
  const jsTestCode = `
// Extract and test the utility functions from the JS file
${jsContent}

console.log('🧪 Testing JavaScript functions:')

// Test processUsers function
const testUsers = [
  { id: 1, name: 'Test User', role: 'Tester' }
]
const processed = processUsers(testUsers)
console.log('✅ processUsers:', processed[0].displayName === 'Test User (Tester)')

// Test getActiveProjects function  
const testProjects = [
  { id: 1, name: 'Active', status: 'active' },
  { id: 2, name: 'Inactive', status: 'completed' }
]
const active = getActiveProjects(testProjects)
console.log('✅ getActiveProjects:', active.length === 1 && active[0].name === 'Active')

// Test formatData function
const formatted = formatData({ test: 'value' })
console.log('✅ formatData:', formatted.includes('"test": "value"'))

console.log('\\n🎉 All JavaScript functions working correctly!')
`
  
  const jsTestResult = await sandbox.runCode(jsTestCode)
  console.log(jsTestResult.stdout)
  
  // Show file sizes
  console.log('\\n📏 File sizes:')
  const files = ['/workspace/index.html', '/workspace/assets/css/style.css', '/workspace/assets/js/app.js']
  for (const file of files) {
    const content = await sandbox.filesystem.readFile(file)
    const size = new Blob([content]).size
    console.log(`  📄 ${file.split('/').pop()}: ${(size / 1024).toFixed(1)} KB`)
  }
  
  console.log('\\n🎉 Web development demo completed!')
  console.log('💡 This demonstrates how you can use the browser sandbox for:')
  console.log('   - Creating and managing web project files')
  console.log('   - Running build scripts and validation')
  console.log('   - Testing JavaScript functionality')
  console.log('   - Processing and analyzing code')
}

// Run the example
webDevelopmentExample().catch(console.error)