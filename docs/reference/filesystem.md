# Filesystem

ComputeSDK provides filesystem operations for managing files and directories within sandboxes. All filesystem operations are accessed through the `sandbox.filesystem` object.

## Quick Start

```typescript
import { createCompute } from 'computesdk'
import { e2b } from '@computesdk/e2b'

// Create a compute instance with the provider configuration
const compute = createCompute({
  defaultProvider: e2b({ apiKey: process.env.E2B_API_KEY })
})

const sandbox = await compute.sandbox.create({
  runtime: 'python3.9',
  timeout: 300000,  // 5 minutes
  metadata: {
    userId: 'user-123',
    jobType: 'data-processing'
  }
})

try {
  // Write a file
  await sandbox.filesystem.writeFile('/app/config.json', JSON.stringify({ debug: true }))

  // Read a file
  const content = await sandbox.filesystem.readFile('/app/config.json')
  
  // List directory contents
  const files = await sandbox.filesystem.readdir('/app')
  
  // Check if a file exists
  const exists = await sandbox.filesystem.exists('/app/config.json')
  
  // Create a directory
  await sandbox.filesystem.mkdir('/app/data')
  
  // Remove a file or empty directory
  await sandbox.filesystem.remove('/app/old-config.txt')
} finally {
  // Always clean up
  await sandbox.destroy()
}
```

## File Operations

### Reading Files

```typescript
// Read a file as text
const content = await sandbox.filesystem.readFile('/path/to/file.txt')

// With error handling
try {
  const content = await sandbox.filesystem.readFile('/nonexistent.txt')
} catch (error) {
  console.error('Failed to read file:', error.message)
}
```

### Writing Files

```typescript
// Write a text file
await sandbox.filesystem.writeFile('/path/to/file.txt', 'Hello, World!')

// Write JSON data
const data = { key: 'value' }
await sandbox.filesystem.writeFile('/path/to/data.json', JSON.stringify(data))
```

### Working with Directories

```typescript
// List directory contents
const entries = await sandbox.filesystem.readdir('/app')
entries.forEach(entry => {
  console.log(`${entry.isDirectory ? '📁' : '📄'} ${entry.name} (${entry.size} bytes)`)
})

// Create a directory
await sandbox.filesystem.mkdir('/app/new-directory')

// Create nested directories
await sandbox.filesystem.mkdir('/app/nested/directory/structure')
```

### File Information

```typescript
// Check if a file or directory exists
const exists = await sandbox.filesystem.exists('/path/to/file')

// Get file information from readdir
const entries = await sandbox.filesystem.readdir('/app')
const fileInfo = entries.find(entry => entry.name === 'config.json')
if (fileInfo) {
  console.log(`File size: ${fileInfo.size} bytes`)
  console.log(`Last modified: ${fileInfo.lastModified}`)
}
```

### Removing Files and Directories

```typescript
// Remove a file
await sandbox.filesystem.remove('/app/old-file.txt')

// Remove an empty directory
await sandbox.filesystem.remove('/app/empty-directory')
```

## FileEntry Interface

When listing directory contents, the `readdir` method returns an array of `FileEntry` objects:

```typescript
interface FileEntry {
  name: string;        // Name of the file or directory
  path: string;        // Full path to the entry
  isDirectory: boolean; // Whether this is a directory
  size: number;        // Size in bytes
  lastModified: Date;  // Last modified timestamp
}
```

## Error Handling

All filesystem operations will throw an Error object if something goes wrong. Always use try/catch blocks to handle potential errors:

```typescript
try {
  await sandbox.filesystem.readFile('/nonexistent.txt')
} catch (error) {
  console.error('Error:', error.message)
}
```

## Best Practices

1. Always use try/catch blocks around filesystem operations
2. Check if files/directories exist before accessing them when appropriate
3. Clean up temporary files when they're no longer needed
4. Use absolute paths for reliability
5. Be mindful of file size limitations in your environment

