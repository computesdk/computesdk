# @computesdk/browser Examples

This directory contains practical examples demonstrating the capabilities of the `@computesdk/browser` package.

## Examples Overview

### 1. Basic Usage (`basic-usage.js`)
**What it demonstrates:**
- Creating a browser sandbox
- Basic file operations (create, read, write, list)
- Code execution with console output
- Command execution (`echo`, `pwd`, `ls`)
- Project structure management

**Key features:**
- Virtual filesystem operations
- JavaScript code execution
- Shell command simulation
- File and directory management

**Run with:**
```bash
node examples/basic-usage.js
```

### 2. Web Development Workflow (`web-development.js`)
**What it demonstrates:**
- Creating a complete web project structure
- HTML, CSS, and JavaScript file management
- Build script execution
- Code validation and testing
- Asset organization

**Key features:**
- Multi-file web project creation
- CSS styling and HTML structure
- JavaScript functionality testing
- Build process simulation
- File size analysis

**Run with:**
```bash
node examples/web-development.js
```

### 3. Data Processing (`data-processing.js`)
**What it demonstrates:**
- CSV data parsing and analysis
- Statistical calculations
- Report generation (HTML and Markdown)
- Data transformation and insights
- File I/O for data workflows

**Key features:**
- CSV parsing and processing
- Data aggregation and analysis
- Multi-format report generation
- Statistical calculations
- Business intelligence workflows

**Run with:**
```bash
node examples/data-processing.js
```

### 4. Interactive Playground (`interactive-playground.js`)
**What it demonstrates:**
- Code template management
- Interactive code execution
- Snippet library creation
- Project scaffolding
- Educational coding environment

**Key features:**
- Multiple project templates (Calculator, Todo List, Data Visualization)
- Code snippet library
- Interactive execution sessions
- Template-based project creation
- Educational programming tools

**Run with:**
```bash
node examples/interactive-playground.js
```

## Running the Examples

### Prerequisites
Make sure you have the `@computesdk/browser` package installed:

```bash
npm install @computesdk/browser
# or
pnpm add @computesdk/browser
```

### Running Individual Examples

Each example is a standalone JavaScript file that can be run with Node.js:

```bash
# Basic functionality demo
node examples/basic-usage.js

# Web development workflow
node examples/web-development.js

# Data processing pipeline
node examples/data-processing.js

# Interactive coding playground
node examples/interactive-playground.js
```

### Running All Examples

You can run all examples in sequence:

```bash
for example in examples/*.js; do
  echo "Running $example..."
  node "$example"
  echo "---"
done
```

## Example Output

Each example produces detailed console output showing:
- 📁 File system operations
- ⚡ Code execution results
- 🖥️ Command execution output
- 📊 Data processing results
- 🎯 Performance metrics

## Use Cases Demonstrated

### 1. **Educational Platforms**
- Interactive coding tutorials
- Code snippet sharing
- Real-time code execution
- Project templates for learning

### 2. **Development Tools**
- Browser-based IDEs
- Code playgrounds
- Rapid prototyping
- Build tool simulation

### 3. **Data Analysis**
- Client-side data processing
- Privacy-focused analytics
- Report generation
- Statistical analysis

### 4. **Content Management**
- File organization systems
- Project scaffolding
- Template management
- Asset processing

## Key Benefits Shown

### 🚀 **Performance**
- Instant code execution
- No server round-trips
- Local file operations
- Fast feedback loops

### 🔒 **Privacy**
- Data never leaves the browser
- Client-side processing
- No external dependencies
- Secure execution environment

### 🌐 **Accessibility**
- Works in any modern browser
- No installation required
- Cross-platform compatibility
- Framework agnostic

### 📱 **Offline Capability**
- Works without internet
- Local file persistence (planned)
- Cached execution environment
- Offline-first architecture

## Extending the Examples

### Adding New Templates
```javascript
// Add to interactive-playground.js
await sandbox.filesystem.mkdir('/playground/templates/my-template')
await sandbox.filesystem.writeFile('/playground/templates/my-template/index.js', `
// Your template code here
console.log('My custom template!')
`)
```

### Creating Custom Commands
```javascript
// Extend the command execution in any example
const customCommands = {
  'hello': () => 'Hello from custom command!',
  'date': () => new Date().toISOString(),
  'random': () => Math.random().toString()
}
```

### Adding Data Sources
```javascript
// Add new data processing examples
const newDataSource = `name,value,category
Item1,100,A
Item2,200,B`

await sandbox.filesystem.writeFile('/data/new-source.csv', newDataSource)
```

## Next Steps

These examples provide a foundation for building more complex applications:

1. **Add LiveStore Integration** - Enable persistent storage and cross-tab sync
2. **Implement Terminal Sessions** - Add interactive terminal capabilities
3. **Add Python Runtime** - Support Python code execution with Pyodide
4. **Create UI Components** - Build React/Vue components for browser sandboxes
5. **Add Package Management** - Support npm package installation and usage

## Contributing

To add new examples:

1. Create a new `.js` file in the `examples/` directory
2. Follow the existing pattern with clear console output
3. Include comprehensive comments explaining the functionality
4. Update this README with the new example description
5. Test the example thoroughly

## Support

For questions about these examples or the `@computesdk/browser` package:

- Check the main [README](../README.md) for API documentation
- Review the [test files](../src/__tests__/) for additional usage patterns
- Open an issue in the ComputeSDK repository