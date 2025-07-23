/**
 * Interactive Playground Example
 * 
 * This example creates an interactive coding playground in the browser:
 * - Code editor simulation
 * - Live code execution
 * - File management
 * - Project templates
 */

import { browser } from '@computesdk/browser'

async function interactivePlaygroundExample() {
  console.log('🎮 Interactive Coding Playground Demo')
  const sandbox = browser({ cwd: '/playground' })
  
  // Setup playground structure
  console.log('\n📁 Setting up playground...')
  await sandbox.filesystem.mkdir('/playground')
  await sandbox.filesystem.mkdir('/playground/projects')
  await sandbox.filesystem.mkdir('/playground/templates')
  await sandbox.filesystem.mkdir('/playground/snippets')
  
  // Create project templates
  console.log('📋 Creating project templates...')
  
  // JavaScript Calculator Template
  await sandbox.filesystem.mkdir('/playground/templates/calculator')
  await sandbox.filesystem.writeFile('/playground/templates/calculator/index.js', `// Simple Calculator
class Calculator {
  constructor() {
    this.result = 0
    console.log('🧮 Calculator initialized')
  }
  
  add(num) {
    this.result += num
    console.log(\`Added \${num}, result: \${this.result}\`)
    return this
  }
  
  subtract(num) {
    this.result -= num
    console.log(\`Subtracted \${num}, result: \${this.result}\`)
    return this
  }
  
  multiply(num) {
    this.result *= num
    console.log(\`Multiplied by \${num}, result: \${this.result}\`)
    return this
  }
  
  divide(num) {
    if (num === 0) {
      console.error('Cannot divide by zero!')
      return this
    }
    this.result /= num
    console.log(\`Divided by \${num}, result: \${this.result}\`)
    return this
  }
  
  clear() {
    this.result = 0
    console.log('Calculator cleared')
    return this
  }
  
  getResult() {
    return this.result
  }
}

// Demo usage
const calc = new Calculator()
calc.add(10).multiply(2).subtract(5).divide(3)
console.log(\`Final result: \${calc.getResult()}\`)

// Advanced operations
const advancedCalc = new Calculator()
advancedCalc.add(100).multiply(0.1).add(50).divide(2)
console.log(\`Advanced calculation result: \${advancedCalc.getResult()}\`)`)
  
  // Todo List Template
  await sandbox.filesystem.mkdir('/playground/templates/todo-list')
  await sandbox.filesystem.writeFile('/playground/templates/todo-list/todo.js', `// Todo List Manager
class TodoList {
  constructor() {
    this.todos = []
    this.nextId = 1
    console.log('📝 Todo List initialized')
  }
  
  addTodo(text, priority = 'medium') {
    const todo = {
      id: this.nextId++,
      text: text,
      completed: false,
      priority: priority,
      createdAt: new Date().toISOString()
    }
    this.todos.push(todo)
    console.log(\`✅ Added todo: "\${text}" (Priority: \${priority})\`)
    return todo
  }
  
  completeTodo(id) {
    const todo = this.todos.find(t => t.id === id)
    if (todo) {
      todo.completed = true
      todo.completedAt = new Date().toISOString()
      console.log(\`✔️ Completed todo: "\${todo.text}"\`)
    } else {
      console.log(\`❌ Todo with id \${id} not found\`)
    }
  }
  
  deleteTodo(id) {
    const index = this.todos.findIndex(t => t.id === id)
    if (index !== -1) {
      const todo = this.todos.splice(index, 1)[0]
      console.log(\`🗑️ Deleted todo: "\${todo.text}"\`)
    } else {
      console.log(\`❌ Todo with id \${id} not found\`)
    }
  }
  
  listTodos() {
    console.log(\`\\n📋 Todo List (\${this.todos.length} items):\`)
    this.todos.forEach(todo => {
      const status = todo.completed ? '✅' : '⏳'
      const priority = { high: '🔴', medium: '🟡', low: '🟢' }[todo.priority] || '⚪'
      console.log(\`  \${status} \${priority} [\${todo.id}] \${todo.text}\`)
    })
  }
  
  getStats() {
    const completed = this.todos.filter(t => t.completed).length
    const pending = this.todos.length - completed
    const byPriority = this.todos.reduce((acc, todo) => {
      acc[todo.priority] = (acc[todo.priority] || 0) + 1
      return acc
    }, {})
    
    return { total: this.todos.length, completed, pending, byPriority }
  }
}

// Demo usage
const todoList = new TodoList()

// Add some todos
todoList.addTodo('Learn @computesdk/browser', 'high')
todoList.addTodo('Build a demo project', 'medium')
todoList.addTodo('Write documentation', 'medium')
todoList.addTodo('Test the playground', 'low')

// Show initial list
todoList.listTodos()

// Complete some todos
todoList.completeTodo(1)
todoList.completeTodo(3)

// Show updated list
todoList.listTodos()

// Show statistics
const stats = todoList.getStats()
console.log('\\n📊 Statistics:', JSON.stringify(stats, null, 2))`)
  
  // Data Visualization Template
  await sandbox.filesystem.mkdir('/playground/templates/data-viz')
  await sandbox.filesystem.writeFile('/playground/templates/data-viz/chart.js', `// Simple Data Visualization
class SimpleChart {
  constructor(data, options = {}) {
    this.data = data
    this.options = { width: 50, ...options }
    console.log('📊 Chart initialized with', data.length, 'data points')
  }
  
  renderBarChart() {
    console.log('\\n📊 Bar Chart:')
    const maxValue = Math.max(...this.data.map(d => d.value))
    
    this.data.forEach(item => {
      const barLength = Math.round((item.value / maxValue) * this.options.width)
      const bar = '█'.repeat(barLength)
      const padding = ' '.repeat(Math.max(0, 15 - item.label.length))
      console.log(\`\${item.label}\${padding} |\${bar} \${item.value}\`)
    })
  }
  
  renderLineChart() {
    console.log('\\n📈 Line Chart (simplified):')
    const values = this.data.map(d => d.value)
    const maxValue = Math.max(...values)
    const minValue = Math.min(...values)
    const range = maxValue - minValue
    
    // Create a simple ASCII line chart
    const height = 10
    for (let row = height; row >= 0; row--) {
      let line = ''
      const threshold = minValue + (range * row / height)
      
      values.forEach((value, index) => {
        if (value >= threshold) {
          line += '●'
        } else {
          line += ' '
        }
        if (index < values.length - 1) line += ' '
      })
      
      const label = threshold.toFixed(1).padStart(6)
      console.log(\`\${label} |\${line}\`)
    }
    
    // X-axis labels
    const xAxis = this.data.map(d => d.label.charAt(0)).join(' ')
    console.log('       |' + xAxis)
  }
  
  getStatistics() {
    const values = this.data.map(d => d.value)
    const sum = values.reduce((a, b) => a + b, 0)
    const avg = sum / values.length
    const min = Math.min(...values)
    const max = Math.max(...values)
    
    return { sum, avg: avg.toFixed(2), min, max, count: values.length }
  }
}

// Demo data
const salesData = [
  { label: 'January', value: 120 },
  { label: 'February', value: 150 },
  { label: 'March', value: 180 },
  { label: 'April', value: 140 },
  { label: 'May', value: 200 },
  { label: 'June', value: 175 }
]

const chart = new SimpleChart(salesData)

// Render different chart types
chart.renderBarChart()
chart.renderLineChart()

// Show statistics
const stats = chart.getStatistics()
console.log('\\n📊 Data Statistics:', JSON.stringify(stats, null, 2))`)
  
  // Create code snippets
  console.log('📝 Creating code snippets...')
  
  const snippets = {
    'array-utils.js': `// Array Utility Functions
const arrayUtils = {
  // Remove duplicates from array
  unique: (arr) => [...new Set(arr)],
  
  // Chunk array into smaller arrays
  chunk: (arr, size) => {
    const chunks = []
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size))
    }
    return chunks
  },
  
  // Flatten nested arrays
  flatten: (arr) => arr.flat(Infinity),
  
  // Group array elements by key
  groupBy: (arr, key) => {
    return arr.reduce((groups, item) => {
      const group = item[key]
      groups[group] = groups[group] || []
      groups[group].push(item)
      return groups
    }, {})
  }
}

// Demo
const numbers = [1, 2, 2, 3, 4, 4, 5]
console.log('Unique:', arrayUtils.unique(numbers))
console.log('Chunked:', arrayUtils.chunk(numbers, 3))

const nested = [[1, 2], [3, [4, 5]], 6]
console.log('Flattened:', arrayUtils.flatten(nested))`,

    'string-helpers.js': `// String Helper Functions
const stringHelpers = {
  // Convert to title case
  titleCase: (str) => str.replace(/\\w\\S*/g, (txt) => 
    txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()),
  
  // Convert to camelCase
  camelCase: (str) => str.replace(/[-_\\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : ''),
  
  // Convert to kebab-case
  kebabCase: (str) => str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(),
  
  // Truncate string with ellipsis
  truncate: (str, length) => str.length > length ? str.slice(0, length) + '...' : str,
  
  // Count words
  wordCount: (str) => str.trim().split(/\\s+/).length
}

// Demo
const text = 'hello world example'
console.log('Title Case:', stringHelpers.titleCase(text))
console.log('Camel Case:', stringHelpers.camelCase(text))
console.log('Kebab Case:', stringHelpers.kebabCase('HelloWorldExample'))
console.log('Truncated:', stringHelpers.truncate('This is a long sentence', 10))`,

    'date-utils.js': `// Date Utility Functions
const dateUtils = {
  // Format date as YYYY-MM-DD
  formatDate: (date) => date.toISOString().split('T')[0],
  
  // Get days between two dates
  daysBetween: (date1, date2) => Math.ceil(Math.abs(date2 - date1) / (1000 * 60 * 60 * 24)),
  
  // Add days to date
  addDays: (date, days) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000),
  
  // Get start of week
  startOfWeek: (date) => {
    const d = new Date(date)
    const day = d.getDay()
    const diff = d.getDate() - day
    return new Date(d.setDate(diff))
  }
}

// Demo
const now = new Date()
const tomorrow = dateUtils.addDays(now, 1)
console.log('Today:', dateUtils.formatDate(now))
console.log('Tomorrow:', dateUtils.formatDate(tomorrow))
console.log('Days between:', dateUtils.daysBetween(now, tomorrow))`
  }
  
  for (const [filename, code] of Object.entries(snippets)) {
    await sandbox.filesystem.writeFile(`/playground/snippets/${filename}`, code)
  }
  
  console.log('✅ Playground setup complete!')
  
  // Show playground structure
  console.log('\n📋 Playground structure:')
  async function showDirectory(path, indent = '') {
    const entries = await sandbox.filesystem.readdir(path)
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      console.log(`${indent}${entry.isDirectory ? '📁' : '📄'} ${entry.name}`)
      if (entry.isDirectory && !entry.path.includes('templates')) {
        await showDirectory(entry.path, indent + '  ')
      }
    }
  }
  await showDirectory('/playground')
  
  // Interactive playground simulation
  console.log('\n🎮 Starting interactive playground session...')
  
  const playgroundSessions = [
    {
      name: 'Calculator Demo',
      file: '/playground/templates/calculator/index.js',
      description: 'Testing the calculator template'
    },
    {
      name: 'Todo List Demo', 
      file: '/playground/templates/todo-list/todo.js',
      description: 'Managing tasks with the todo list'
    },
    {
      name: 'Data Visualization Demo',
      file: '/playground/templates/data-viz/chart.js', 
      description: 'Creating charts from data'
    }
  ]
  
  for (const session of playgroundSessions) {
    console.log(`\\n🚀 Running: ${session.name}`)
    console.log(`📝 ${session.description}`)
    console.log('─'.repeat(50))
    
    const code = await sandbox.filesystem.readFile(session.file)
    const result = await sandbox.runCode(code)
    
    console.log(result.stdout)
    
    if (result.stderr) {
      console.log('❌ Errors:', result.stderr)
    }
    
    console.log(`✅ Session completed in ${result.executionTime}ms`)
  }
  
  // Test code snippets
  console.log('\\n🧩 Testing code snippets...')
  
  for (const [filename, _] of Object.entries(snippets)) {
    console.log(`\\n📝 Running snippet: ${filename}`)
    const snippetCode = await sandbox.filesystem.readFile(`/playground/snippets/${filename}`)
    const result = await sandbox.runCode(snippetCode)
    console.log(result.stdout)
  }
  
  // Create a user project
  console.log('\\n👤 Creating user project...')
  await sandbox.filesystem.mkdir('/playground/projects/my-project')
  
  const userProject = `// My Custom Project
console.log('🎨 Welcome to my custom project!')

// Import utility functions (simulated)
// In a real scenario, these would be imported from the snippets

// Custom function
function fibonacci(n) {
  if (n <= 1) return n
  return fibonacci(n - 1) + fibonacci(n - 2)
}

// Generate fibonacci sequence
console.log('🔢 Fibonacci sequence:')
for (let i = 0; i < 10; i++) {
  console.log(\`F(\${i}) = \${fibonacci(i)}\`)
}

// Custom data processing
const data = [
  { name: 'Alice', score: 85 },
  { name: 'Bob', score: 92 },
  { name: 'Charlie', score: 78 },
  { name: 'Diana', score: 96 }
]

console.log('\\n🏆 Student scores:')
data.forEach(student => {
  const grade = student.score >= 90 ? 'A' : student.score >= 80 ? 'B' : 'C'
  console.log(\`\${student.name}: \${student.score} (Grade: \${grade})\`)
})

const average = data.reduce((sum, s) => sum + s.score, 0) / data.length
console.log(\`\\n📊 Class average: \${average.toFixed(1)}\`)

console.log('\\n✨ Project completed successfully!')`
  
  await sandbox.filesystem.writeFile('/playground/projects/my-project/main.js', userProject)
  
  console.log('🚀 Running user project...')
  const userResult = await sandbox.runCode(userProject)
  console.log(userResult.stdout)
  
  // Playground statistics
  console.log('\\n📊 Playground Statistics:')
  
  const stats = {
    templates: (await sandbox.filesystem.readdir('/playground/templates')).length,
    snippets: (await sandbox.filesystem.readdir('/playground/snippets')).length,
    projects: (await sandbox.filesystem.readdir('/playground/projects')).length
  }
  
  console.log(`📋 Templates: ${stats.templates}`)
  console.log(`🧩 Code snippets: ${stats.snippets}`)
  console.log(`👤 User projects: ${stats.projects}`)
  
  // Test file operations
  console.log('\\n🖥️  Testing playground commands...')
  const commands = [
    ['ls', ['/playground']],
    ['ls', ['/playground/templates']],
    ['ls', ['/playground/snippets']]
  ]
  
  for (const [cmd, args] of commands) {
    const result = await sandbox.runCommand(cmd, args)
    console.log(`$ ${cmd} ${args.join(' ')}`)
    console.log(result.stdout)
  }
  
  console.log('🎉 Interactive playground demo completed!')
  console.log('\\n💡 This playground demonstrates:')
  console.log('   ✅ Project templates and scaffolding')
  console.log('   ✅ Code snippet management')
  console.log('   ✅ Interactive code execution')
  console.log('   ✅ File-based project organization')
  console.log('   ✅ Real-time feedback and testing')
  
  console.log('\\n🚀 Potential use cases:')
  console.log('   • Online coding tutorials and courses')
  console.log('   • Code snippet sharing and testing')
  console.log('   • Rapid prototyping environment')
  console.log('   • Educational programming tools')
  console.log('   • Browser-based development environments')
}

// Run the example
interactivePlaygroundExample().catch(console.error)