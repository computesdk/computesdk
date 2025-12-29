# Filesystem Methods

ComputeSDK provides filesystem operations for managing files and directories within sandboxes. All filesystem operations are accessed through the `sandbox.filesystem` object.

## readFile()

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


## writeFile()

```typescript
// Write a text file
await sandbox.filesystem.writeFile('/path/to/file.txt', 'Hello, World!')

// Write JSON data
const data = { key: 'value' }
await sandbox.filesystem.writeFile('/path/to/data.json', JSON.stringify(data))
```

## mkdir()

```typescript
// Create a directory
await sandbox.filesystem.mkdir('/app/new-directory')
``` 

## readdir() 
```typescript
// List directory contents
const entries = await sandbox.filesystem.readdir('/app')
entries.forEach(entry => {
  console.log(`${entry.isDirectory ? '📁' : '📄'} ${entry.name} (${entry.size} bytes)`)
})
```

## exists()
```typescript
// Check if a file or directory exists
const exists = await sandbox.filesystem.exists('/path/to/file')
```