# ComputeSDK Browser Example with Vite

This example shows how to use `@computesdk/browser` in a real browser environment with LiveStore persistence.

## Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Features

- ✅ **LiveStore Persistence**: Files persist across browser sessions
- ✅ **Cross-Tab Sync**: Changes sync between browser tabs in real-time
- ✅ **OPFS Storage**: Uses Origin Private File System for fast, private storage
- ✅ **Event Sourcing**: All filesystem operations are tracked as events

## Browser Requirements

- Chrome 86+ (recommended)
- Firefox 96+
- Safari 15.2+
- Edge 86+

## Usage

```javascript
import { browser } from '@computesdk/browser'

// Create and initialize sandbox
const sandbox = browser()
await sandbox.initialize()

// Use filesystem operations
await sandbox.filesystem.writeFile('/hello.txt', 'Hello World!')
const content = await sandbox.filesystem.readFile('/hello.txt')

// Run commands
const result = await sandbox.runCommand('echo', ['Hello from browser!'])
console.log(result.stdout)
```

## What This Example Demonstrates

1. **Real LiveStore Integration**: Unlike tests, this uses actual LiveStore with OPFS
2. **Worker Support**: Web Workers are properly loaded and initialized
3. **Persistence**: Files you create will survive page refreshes
4. **Cross-Tab Sync**: Open multiple tabs to see real-time synchronization