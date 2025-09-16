# @computesdk/codesandbox

CodeSandbox provider for ComputeSDK - Execute code in web-based development environments.

## Installation

```bash
npm install @computesdk/codesandbox
```

## Usage

### With ComputeSDK

```typescript
import { createCompute } from 'computesdk';
import { codesandbox } from '@computesdk/codesandbox';

// Set as default provider
const compute = createCompute({ 
  defaultProvider: codesandbox({ apiKey: process.env.CODESANDBOX_API_KEY }) 
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Get instance
const instance = sandbox.getInstance();

// Execute code
const result = await sandbox.runCode('console.log("Hello from CodeSandbox!")');
console.log(result.stdout); // "Hello from CodeSandbox!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

### Direct Usage

```typescript
import { codesandbox } from '@computesdk/codesandbox';

// Create provider
const provider = codesandbox({ 
  apiKey: 'your-api-key',
  template: 'react'
});

// Use with compute singleton
const sandbox = await compute.sandbox.create({ provider });
```

## Configuration

### Environment Variables

```bash
export CODESANDBOX_API_KEY=your_codesandbox_api_key_here
```

### Configuration Options

```typescript
interface CodeSandboxConfig {
  /** CodeSandbox API key - if not provided, will use CODESANDBOX_API_KEY env var */
  apiKey?: string;
  /** Project template to use */
  template?: 'react' | 'vue' | 'angular' | 'nextjs' | 'node' | 'vanilla';
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Enable public access to sandbox */
  publicAccess?: boolean;
  /** Base URL for CodeSandbox API */
  baseUrl?: string;
}
```

## API Reference

### Code Execution

```typescript
// Execute JavaScript code
const result = await sandbox.runCode(`
const data = { message: "Hello from JavaScript", timestamp: Date.now() };
console.log(JSON.stringify(data));
`, 'javascript');

// Execute TypeScript code  
const result = await sandbox.runCode(`
interface Message {
  text: string;
  timestamp: number;
}

const message: Message = {
  text: "Hello from TypeScript",
  timestamp: Date.now()
};

console.log(JSON.stringify(message));
`, 'typescript');

// Auto-detection (based on code patterns)
const result = await sandbox.runCode('console.log("Auto-detected as JavaScript")');
```

### Command Execution

```typescript
// Install npm packages
const result = await sandbox.runCommand('npm', ['install', 'lodash']);

// Run npm scripts
const result = await sandbox.runCommand('npm', ['run', 'build']);

// Start development server
const result = await sandbox.runCommand('npm', ['start']);
```

### Filesystem Operations

```typescript
// Write file
await sandbox.filesystem.writeFile('/src/App.js', 'export default function App() { return <h1>Hello</h1>; }');

// Read file
const content = await sandbox.filesystem.readFile('/src/App.js');

// Create directory
await sandbox.filesystem.mkdir('/src/components');

// List directory contents
const files = await sandbox.filesystem.readdir('/src');

// Check if file exists
const exists = await sandbox.filesystem.exists('/src/App.js');

// Remove file or directory
await sandbox.filesystem.remove('/src/App.js');
```

### Sandbox Management

```typescript
// Get sandbox info (including live preview URL)
const info = await sandbox.getInfo();
console.log(info.id, info.provider, info.url);

// List all sandboxes
const sandboxes = await compute.sandbox.list();

// Get existing sandbox
const existing = await compute.sandbox.getById('sandbox-id');

// Destroy sandbox
await compute.sandbox.destroy('sandbox-id');
```

## Runtime Detection

The provider automatically detects the runtime based on code patterns:

**TypeScript indicators:**
- `interface`, `type` declarations
- TypeScript-specific syntax (`:`, `<T>`, etc.)
- `.ts` or `.tsx` file extensions

**Default:** JavaScript for all other cases

## Error Handling

```typescript
try {
  const result = await sandbox.runCode('invalid code');
} catch (error) {
  if (error.message.includes('Syntax error')) {
    console.error('Code has syntax errors');
  } else if (error.message.includes('authentication failed')) {
    console.error('Check your CODESANDBOX_API_KEY');
  } else if (error.message.includes('template not found')) {
    console.error('Invalid template specified');
  }
}
```

## Web Framework Integration

Use with web frameworks via the request handler:

```typescript
import { handleComputeRequest } from 'computesdk';
import { codesandbox } from '@computesdk/codesandbox';

export async function POST(request: Request) {
  return handleComputeRequest({
    request,
    provider: codesandbox({ apiKey: process.env.CODESANDBOX_API_KEY })
  });
}
```

## Examples

### React Application

```typescript
// Create React sandbox
const sandbox = await compute.sandbox.create({
  options: { template: 'react' }
});

// Create a custom component
await sandbox.filesystem.writeFile('/src/UserCard.js', `
import React from 'react';

function UserCard({ user }) {
  return (
    <div style={{
      border: '1px solid #ddd',
      borderRadius: '8px',
      padding: '16px',
      margin: '8px 0',
      backgroundColor: '#f9f9f9'
    }}>
      <h3>{user.name}</h3>
      <p>Email: {user.email}</p>
      <p>Role: {user.role}</p>
    </div>
  );
}

export default UserCard;
`);

// Update App.js
await sandbox.filesystem.writeFile('/src/App.js', `
import React from 'react';
import UserCard from './UserCard';

const users = [
  { id: 1, name: 'Alice Johnson', email: 'alice@example.com', role: 'Developer' },
  { id: 2, name: 'Bob Smith', email: 'bob@example.com', role: 'Designer' },
  { id: 3, name: 'Charlie Brown', email: 'charlie@example.com', role: 'Manager' }
];

function App() {
  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>Team Directory</h1>
      <p>Built with ComputeSDK + CodeSandbox</p>
      {users.map(user => (
        <UserCard key={user.id} user={user} />
      ))}
    </div>
  );
}

export default App;
`);

// Get the live preview URL
const info = await sandbox.getInfo();
console.log('Live preview:', info.url);
```

### Vue.js Application

```typescript
// Create Vue sandbox
const sandbox = await compute.sandbox.create({
  options: { template: 'vue' }
});

// Create a Vue component
await sandbox.filesystem.writeFile('/src/components/TodoList.vue', `
<template>
  <div class="todo-app">
    <h2>Todo List</h2>
    <div class="add-todo">
      <input 
        v-model="newTodo" 
        @keyup.enter="addTodo"
        placeholder="Add a new todo..."
      />
      <button @click="addTodo">Add</button>
    </div>
    <ul class="todo-list">
      <li 
        v-for="todo in todos" 
        :key="todo.id"
        :class="{ completed: todo.completed }"
      >
        <input 
          type="checkbox" 
          v-model="todo.completed"
        />
        <span>{{ todo.text }}</span>
        <button @click="removeTodo(todo.id)">×</button>
      </li>
    </ul>
    <p>{{ completedCount }}/{{ todos.length }} completed</p>
  </div>
</template>

<script>
export default {
  name: 'TodoList',
  data() {
    return {
      newTodo: '',
      todos: [
        { id: 1, text: 'Learn Vue.js', completed: true },
        { id: 2, text: 'Build with ComputeSDK', completed: false },
        { id: 3, text: 'Deploy to CodeSandbox', completed: false }
      ]
    }
  },
  computed: {
    completedCount() {
      return this.todos.filter(todo => todo.completed).length;
    }
  },
  methods: {
    addTodo() {
      if (this.newTodo.trim()) {
        this.todos.push({
          id: Date.now(),
          text: this.newTodo.trim(),
          completed: false
        });
        this.newTodo = '';
      }
    },
    removeTodo(id) {
      this.todos = this.todos.filter(todo => todo.id !== id);
    }
  }
}
</script>

<style scoped>
.todo-app {
  max-width: 400px;
  margin: 0 auto;
  padding: 20px;
}

.add-todo {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
}

.todo-list {
  list-style: none;
  padding: 0;
}

.todo-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-bottom: 1px solid #eee;
}

.completed span {
  text-decoration: line-through;
  color: #888;
}
</style>
`);

// Update main App.vue
await sandbox.filesystem.writeFile('/src/App.vue', `
<template>
  <div id="app">
    <h1>Vue.js + ComputeSDK</h1>
    <TodoList />
  </div>
</template>

<script>
import TodoList from './components/TodoList.vue'

export default {
  name: 'App',
  components: {
    TodoList
  }
}
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  text-align: center;
  color: #2c3e50;
  margin-top: 20px;
}
</style>
`);

console.log('Vue.js app created successfully!');
```

### Node.js API

```typescript
// Create Node.js sandbox
const sandbox = await compute.sandbox.create({
  options: { template: 'node' }
});

// Create Express server
await sandbox.filesystem.writeFile('/index.js', `
const express = require('express');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Sample data
const products = [
  { id: 1, name: 'Laptop', price: 999.99, category: 'Electronics' },
  { id: 2, name: 'Mouse', price: 29.99, category: 'Electronics' },
  { id: 3, name: 'Book', price: 19.99, category: 'Education' }
];

// Routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'ComputeSDK API Server',
    endpoints: ['/api/products', '/api/products/:id']
  });
});

app.get('/api/products', (req, res) => {
  const { category } = req.query;
  let result = products;
  
  if (category) {
    result = products.filter(p => p.category.toLowerCase() === category.toLowerCase());
  }
  
  res.json({ products: result, total: result.length });
});

app.get('/api/products/:id', (req, res) => {
  const product = products.find(p => p.id === parseInt(req.params.id));
  
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  
  res.json(product);
});

app.listen(port, () => {
  console.log(\`Server running on port \${port}\`);
});
`);

// Update package.json
const packageJson = {
  name: 'computesdk-api',
  version: '1.0.0',
  main: 'index.js',
  scripts: {
    start: 'node index.js'
  },
  dependencies: {
    express: '^4.18.0',
    cors: '^2.8.5'
  }
};

await sandbox.filesystem.writeFile('/package.json', JSON.stringify(packageJson, null, 2));

// Install dependencies
await sandbox.runCommand('npm', ['install']);

console.log('Node.js API server created successfully!');
```

### Package Management

```typescript
// Install popular packages
await sandbox.runCommand('npm', ['install', 'lodash', 'axios', 'date-fns']);

// Install dev dependencies
await sandbox.runCommand('npm', ['install', '--save-dev', 'jest', 'eslint']);

// Test the installed packages
const result = await sandbox.runCode(`
const _ = require('lodash');
const axios = require('axios');

console.log('Lodash version:', _.VERSION);
console.log('Axios available:', typeof axios);

// Test lodash functionality
const numbers = [1, 2, 3, 4, 5];
const doubled = _.map(numbers, n => n * 2);
console.log('Original:', numbers);
console.log('Doubled:', doubled);
console.log('Sum:', _.sum(doubled));
`);

console.log(result.stdout);
```