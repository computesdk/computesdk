# create-compute

Spin up a cloud sandbox and start coding in an interactive REPL.

## Quick Start

```bash
npx create-compute
```

This will:
1. Auto-detect your provider credentials from environment variables
2. Drop you into an interactive REPL
3. Lazily create a sandbox on your first command

## Usage

```bash
# Auto-detect provider from env vars
npx create-compute

# Specify a provider
npx create-compute --provider e2b

# Skip the welcome banner
npx create-compute --no-banner

# Enable debug output
npx create-compute --debug
```

## Environment Variables

Set your provider credentials before running:

```bash
# ComputeSDK Gateway (recommended)
export COMPUTESDK_API_KEY=your_key

# E2B
export E2B_API_KEY=your_e2b_key

# Modal
export MODAL_TOKEN_ID=your_token_id
export MODAL_TOKEN_SECRET=your_token_secret

# Other providers...
```

## REPL Commands

Once in the REPL, you can:

### Run Shell Commands

```javascript
// Using $command syntax
$ls -la
$cat package.json

// Using @computesdk/cmd functions
ls('-la')
npm.install('lodash')
git.status()
```

### Execute Code

```javascript
// Run Python code
runCode('print(1 + 1)', 'python')

// Run Node.js code  
runCode('console.log(1 + 1)', 'node')
```

### Manage Sandbox

```javascript
// Show sandbox info
info

// Get sandbox URL for a port
await getUrl({ port: 3000 })

// Restart sandbox
restart

// Destroy sandbox
destroy
```

### Filesystem Operations

```javascript
// Read/write files
await filesystem.writeFile('/tmp/test.txt', 'hello')
await filesystem.readFile('/tmp/test.txt')

// List directory
await filesystem.readdir('/home')

// Check if path exists
await filesystem.exists('/tmp/test.txt')
```

### Session Commands

```javascript
help      // Show available commands
info      // Show sandbox info
verbose   // Toggle verbose output
exit      // Exit and cleanup
```

## Features

- **Lazy sandbox creation**: Sandbox is only created when you run your first command
- **Auto-detection**: Automatically detects provider from environment variables
- **Smart evaluation**: Command arrays from `@computesdk/cmd` are auto-executed
- **Tab completion**: Autocomplete for commands and functions
- **Command history**: History persisted across sessions

## Development

```bash
# From the monorepo root
pnpm install
pnpm build

# Run locally
node packages/create-compute/dist/index.js

# Or with pnpm
pnpm --filter create-compute start
```
