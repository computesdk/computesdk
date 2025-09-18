# Filesystem Operations

ComputeSDK provides comprehensive filesystem operations for managing files and directories within sandboxes. Perform file I/O, manage permissions, sync files, and handle large datasets across different providers.

## Quick Start

```typescript
import { compute } from 'computesdk'

const sandbox = await compute('e2b')

// Write a file
await sandbox.writeFile('/app/config.json', JSON.stringify({ debug: true }))

// Read a file
const content = await sandbox.readFile('/app/config.json')

// List directory contents
const files = await sandbox.listFiles('/app')
```

## Basic File Operations

### Reading Files

```typescript
// Read text file
const content = await sandbox.readFile('/path/to/file.txt')
console.log(content)

// Read binary file
const buffer = await sandbox.readFile('/path/to/image.png', { encoding: 'binary' })

// Read with options
const content = await sandbox.readFile('/large-file.txt', {
  encoding: 'utf8',
  maxSize: 1024 * 1024, // 1MB limit
  offset: 1000,         // Start from byte 1000
  length: 5000          // Read 5000 bytes
})

// Stream read for large files
const stream = await sandbox.readFileStream('/large-dataset.csv')
stream.on('data', (chunk) => {
  console.log('Chunk:', chunk.toString())
})
```

### Writing Files

```typescript
// Write text file
await sandbox.writeFile('/path/to/output.txt', 'Hello, World!')

// Write JSON
await sandbox.writeFile('/config.json', JSON.stringify({ env: 'production' }))

// Write binary data
const imageBuffer = Buffer.from(base64Image, 'base64')
await sandbox.writeFile('/images/photo.jpg', imageBuffer)

// Write with options
await sandbox.writeFile('/secure.txt', 'secret data', {
  mode: 0o600,          // Read/write for owner only
  createDirs: true,     // Create parent directories
  backup: true          // Create backup of existing file
})

// Append to file
await sandbox.appendFile('/logs/app.log', `${new Date().toISOString()} - Event logged\n`)

// Stream write for large files
const writeStream = await sandbox.writeFileStream('/output/large-data.json')
writeStream.write('{"data": [')
// ... write data in chunks
writeStream.end(']}')
```

### File Information

```typescript
// Get file stats
const stats = await sandbox.stat('/path/to/file.txt')
console.log('Size:', stats.size)
console.log('Modified:', stats.mtime)
console.log('Is directory:', stats.isDirectory())
console.log('Permissions:', stats.mode.toString(8))

// Check if file exists
const exists = await sandbox.exists('/path/to/file.txt')

// Get file type
const type = await sandbox.getFileType('/path/to/file')
console.log('MIME type:', type.mime)
console.log('Extension:', type.extension)
```

## Directory Operations

### Creating Directories

```typescript
// Create single directory
await sandbox.mkdir('/new/directory')

// Create nested directories
await sandbox.mkdir('/deep/nested/path', { recursive: true })

// Create with specific permissions
await sandbox.mkdir('/secure-dir', { mode: 0o755 })

// Create temporary directory
const tempDir = await sandbox.mkdtemp('/tmp/myapp-')
console.log('Temp directory:', tempDir)
```

### Listing Directories

```typescript
// List files in directory
const files = await sandbox.listFiles('/app')
files.forEach(file => {
  console.log(`${file.name} (${file.type}) - ${file.size} bytes`)
})

// List with detailed information
const files = await sandbox.listFiles('/app', {
  detailed: true,
  includeHidden: true,
  recursive: false
})

// Recursive listing
const allFiles = await sandbox.listFiles('/project', { recursive: true })

// Filter files
const pythonFiles = await sandbox.listFiles('/src', {
  filter: (file) => file.name.endsWith('.py')
})

// Sort files
const sortedFiles = await sandbox.listFiles('/docs', {
  sort: 'modified', // 'name', 'size', 'modified'
  order: 'desc'     // 'asc', 'desc'
})
```

### Directory Tree

```typescript
// Get directory tree structure
const tree = await sandbox.getDirectoryTree('/project')
console.log(JSON.stringify(tree, null, 2))

// Tree with file contents
const treeWithContent = await sandbox.getDirectoryTree('/config', {
  includeContent: true,
  maxDepth: 3,
  exclude: ['node_modules', '.git']
})
```

## File Operations

### Copying and Moving

```typescript
// Copy file
await sandbox.copyFile('/source.txt', '/destination.txt')

// Copy directory recursively
await sandbox.copyDirectory('/src', '/backup/src')

// Move/rename file
await sandbox.moveFile('/old-name.txt', '/new-name.txt')

// Move directory
await sandbox.moveDirectory('/old-location', '/new-location')

// Copy with options
await sandbox.copyFile('/source.txt', '/dest.txt', {
  overwrite: true,
  preserveTimestamps: true,
  createDirs: true
})
```

### Deleting Files

```typescript
// Delete file
await sandbox.deleteFile('/path/to/file.txt')

// Delete directory
await sandbox.deleteDirectory('/path/to/directory')

// Delete recursively
await sandbox.deleteDirectory('/path/to/directory', { recursive: true })

// Safe delete with confirmation
await sandbox.deleteFile('/important.txt', { 
  confirm: true,
  backup: true 
})

// Bulk delete
await sandbox.deleteFiles([
  '/temp/file1.txt',
  '/temp/file2.txt',
  '/temp/file3.txt'
])
```

### File Permissions

```typescript
// Change file permissions
await sandbox.chmod('/script.sh', 0o755) // rwxr-xr-x

// Change ownership (if supported)
await sandbox.chown('/file.txt', 'user', 'group')

// Get permissions
const permissions = await sandbox.getPermissions('/file.txt')
console.log('Permissions:', permissions.mode.toString(8))
console.log('Owner:', permissions.owner)
console.log('Group:', permissions.group)
```

## File Watching

### Watch for Changes

```typescript
// Watch single file
const watcher = sandbox.watchFile('/config.json')

watcher.on('change', (event) => {
  console.log('File changed:', event.path)
  console.log('Change type:', event.type) // 'modified', 'created', 'deleted'
})

watcher.on('error', (error) => {
  console.error('Watch error:', error)
})

// Stop watching
watcher.close()
```

### Watch Directory

```typescript
// Watch directory for changes
const dirWatcher = sandbox.watchDirectory('/src', {
  recursive: true,
  ignore: ['node_modules', '*.tmp']
})

dirWatcher.on('change', (event) => {
  console.log(`${event.type}: ${event.path}`)
  
  if (event.type === 'created' && event.path.endsWith('.js')) {
    console.log('New JavaScript file created')
  }
})

// Watch with debouncing
const debouncedWatcher = sandbox.watchDirectory('/src', {
  debounce: 1000 // Wait 1 second before emitting events
})
```

## File Transfer

### Upload Files

```typescript
// Upload single file from local machine
await sandbox.uploadFile('./local-file.txt', '/remote/path/file.txt')

// Upload directory
await sandbox.uploadDirectory('./local-dir', '/remote/dir')

// Upload with progress tracking
await sandbox.uploadFile('./large-file.zip', '/remote/file.zip', {
  onProgress: (progress) => {
    console.log(`Upload progress: ${progress.percent}%`)
  }
})

// Upload multiple files
await sandbox.uploadFiles([
  { local: './file1.txt', remote: '/app/file1.txt' },
  { local: './file2.txt', remote: '/app/file2.txt' }
])

// Upload from URL
await sandbox.uploadFromUrl('https://example.com/file.zip', '/downloads/file.zip')
```

### Download Files

```typescript
// Download single file
await sandbox.downloadFile('/remote/file.txt', './local-file.txt')

// Download directory
await sandbox.downloadDirectory('/remote/dir', './local-dir')

// Download with compression
await sandbox.downloadFile('/large-file.txt', './file.txt.gz', {
  compress: true
})

// Download multiple files as archive
await sandbox.downloadFiles([
  '/app/config.json',
  '/app/package.json',
  '/app/README.md'
], './app-files.tar.gz')

// Download to memory
const content = await sandbox.downloadToBuffer('/remote/file.txt')
```

### Sync Operations

```typescript
// Sync local directory to sandbox
await sandbox.syncTo('./local-project', '/remote/project', {
  exclude: ['node_modules', '.git'],
  delete: true, // Delete files not in source
  preserveTimestamps: true
})

// Sync sandbox directory to local
await sandbox.syncFrom('/remote/project', './local-backup', {
  includeHidden: false,
  overwrite: true
})

// Two-way sync
await sandbox.syncBidirectional('./local-dir', '/remote/dir', {
  conflict: 'newer', // 'newer', 'local', 'remote', 'prompt'
  backup: true
})
```

## Advanced File Operations

### File Search

```typescript
// Find files by name
const files = await sandbox.findFiles('/project', {
  name: '*.py',
  type: 'file'
})

// Find files by content
const matches = await sandbox.grep('/src', 'TODO:', {
  recursive: true,
  include: '*.js',
  exclude: 'node_modules'
})

// Advanced search
const results = await sandbox.search('/project', {
  name: /test.*\.js$/,
  size: { min: 1024, max: 1024 * 1024 },
  modified: { after: new Date('2023-01-01') },
  content: 'import.*react'
})
```

### File Compression

```typescript
// Create archive
await sandbox.createArchive('/backup.tar.gz', [
  '/app',
  '/config',
  '/data'
], {
  compression: 'gzip',
  exclude: ['*.tmp', 'node_modules']
})

// Extract archive
await sandbox.extractArchive('/backup.tar.gz', '/restore', {
  overwrite: true,
  preservePermissions: true
})

// Compress single file
await sandbox.compressFile('/large-file.txt', '/large-file.txt.gz')

// Decompress file
await sandbox.decompressFile('/file.gz', '/file.txt')
```

### File Encryption

```typescript
// Encrypt file
await sandbox.encryptFile('/sensitive.txt', '/sensitive.txt.enc', {
  algorithm: 'aes-256-gcm',
  password: 'secret-password'
})

// Decrypt file
await sandbox.decryptFile('/sensitive.txt.enc', '/sensitive.txt', {
  password: 'secret-password'
})

// Encrypt directory
await sandbox.encryptDirectory('/secrets', '/secrets.enc', {
  recursive: true,
  password: 'directory-password'
})
```

### File Checksums

```typescript
// Calculate file checksum
const checksum = await sandbox.checksum('/file.txt', 'sha256')
console.log('SHA256:', checksum)

// Verify file integrity
const isValid = await sandbox.verifyChecksum('/file.txt', expectedChecksum)

// Calculate checksums for directory
const checksums = await sandbox.checksumDirectory('/project', {
  algorithm: 'md5',
  recursive: true
})
```

## Working with Large Files

### Streaming Operations

```typescript
// Process large file in chunks
const processor = await sandbox.processFileStream('/huge-dataset.csv')

processor.on('chunk', (chunk, index) => {
  console.log(`Processing chunk ${index}:`, chunk.length, 'bytes')
  // Process chunk data
})

processor.on('complete', (stats) => {
  console.log('Processing complete:', stats)
})

// Transform file while streaming
const transformer = sandbox.transformFile('/input.csv', '/output.json', {
  transform: (line) => {
    const data = line.split(',')
    return JSON.stringify({ id: data[0], name: data[1] }) + '\n'
  }
})
```

### Partial File Operations

```typescript
// Read part of file
const chunk = await sandbox.readFileChunk('/large-file.txt', {
  start: 1000000,  // Start at 1MB
  size: 1024       // Read 1KB
})

// Write to specific position
await sandbox.writeFileChunk('/file.txt', 'inserted text', {
  position: 500
})

// Truncate file
await sandbox.truncateFile('/file.txt', 1024) // Keep first 1KB
```

## File Metadata and Extended Attributes

### Metadata Operations

```typescript
// Set custom metadata
await sandbox.setMetadata('/file.txt', {
  author: 'John Doe',
  project: 'my-app',
  version: '1.0.0'
})

// Get metadata
const metadata = await sandbox.getMetadata('/file.txt')
console.log('Custom metadata:', metadata)

// Set extended attributes (if supported)
await sandbox.setExtendedAttribute('/file.txt', 'user.category', 'document')

// Get extended attributes
const attrs = await sandbox.getExtendedAttributes('/file.txt')
```

### File Tags and Labels

```typescript
// Add tags to file
await sandbox.addTags('/file.txt', ['important', 'config', 'production'])

// Search files by tags
const taggedFiles = await sandbox.findFilesByTags(['important'])

// Remove tags
await sandbox.removeTags('/file.txt', ['production'])

// List all tags
const allTags = await sandbox.getAllTags()
```

## Error Handling

### File Operation Errors

```typescript
try {
  await sandbox.readFile('/nonexistent.txt')
} catch (error) {
  if (error.code === 'ENOENT') {
    console.log('File not found')
  } else if (error.code === 'EACCES') {
    console.log('Permission denied')
  } else if (error.code === 'ENOSPC') {
    console.log('No space left on device')
  }
}

// Retry with exponential backoff
async function retryFileOperation(operation: () => Promise<any>, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation()
    } catch (error) {
      if (i === maxRetries - 1) throw error
      
      const delay = Math.pow(2, i) * 1000
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
}
```

### Safe File Operations

```typescript
// Atomic file write
async function atomicWrite(sandbox: Sandbox, path: string, content: string) {
  const tempPath = `${path}.tmp.${Date.now()}`
  
  try {
    await sandbox.writeFile(tempPath, content)
    await sandbox.moveFile(tempPath, path)
  } catch (error) {
    // Clean up temp file if it exists
    if (await sandbox.exists(tempPath)) {
      await sandbox.deleteFile(tempPath)
    }
    throw error
  }
}

// File locking
async function withFileLock(sandbox: Sandbox, path: string, operation: () => Promise<void>) {
  const lockPath = `${path}.lock`
  
  // Acquire lock
  if (await sandbox.exists(lockPath)) {
    throw new Error('File is locked')
  }
  
  await sandbox.writeFile(lockPath, process.pid.toString())
  
  try {
    await operation()
  } finally {
    // Release lock
    await sandbox.deleteFile(lockPath)
  }
}
```

## Performance Optimization

### Batch Operations

```typescript
// Batch file operations
const operations = [
  { type: 'write', path: '/file1.txt', content: 'content1' },
  { type: 'write', path: '/file2.txt', content: 'content2' },
  { type: 'mkdir', path: '/new-dir' },
  { type: 'copy', source: '/src.txt', dest: '/dest.txt' }
]

await sandbox.batchFileOperations(operations)

// Parallel uploads
const uploadPromises = files.map(file => 
  sandbox.uploadFile(file.local, file.remote)
)
await Promise.all(uploadPromises)
```

### Caching and Optimization

```typescript
// Enable file system caching
sandbox.enableFsCache({
  maxSize: 100 * 1024 * 1024, // 100MB cache
  ttl: 300000                 // 5 minute TTL
})

// Optimize for sequential access
await sandbox.optimizeForSequentialAccess('/large-file.dat')

// Preload frequently accessed files
await sandbox.preloadFiles([
  '/config/app.json',
  '/templates/main.html'
])
```

## Integration Examples

### Version Control Integration

```typescript
// Git integration
class GitFileManager {
  constructor(private sandbox: Sandbox) {}

  async initRepo(path: string) {
    await this.sandbox.exec(`git init ${path}`)
  }

  async addFiles(files: string[]) {
    await this.sandbox.exec(`git add ${files.join(' ')}`)
  }

  async commit(message: string) {
    await this.sandbox.exec(`git commit -m "${message}"`)
  }

  async getChangedFiles() {
    const result = await this.sandbox.exec('git diff --name-only')
    return result.stdout.split('\n').filter(Boolean)
  }
}
```

### Database Integration

```typescript
// File-based database operations
class FileDatabase {
  constructor(private sandbox: Sandbox, private dbPath: string) {}

  async insert(collection: string, data: any) {
    const filePath = `${this.dbPath}/${collection}.json`
    
    let records = []
    if (await this.sandbox.exists(filePath)) {
      const content = await this.sandbox.readFile(filePath)
      records = JSON.parse(content)
    }
    
    records.push({ ...data, _id: Date.now() })
    await this.sandbox.writeFile(filePath, JSON.stringify(records, null, 2))
  }

  async find(collection: string, query: any = {}) {
    const filePath = `${this.dbPath}/${collection}.json`
    
    if (!await this.sandbox.exists(filePath)) {
      return []
    }
    
    const content = await this.sandbox.readFile(filePath)
    const records = JSON.parse(content)
    
    return records.filter(record => 
      Object.entries(query).every(([key, value]) => record[key] === value)
    )
  }
}
```

## Best Practices

1. **Error Handling**: Always handle file operation errors gracefully
2. **Resource Cleanup**: Close file streams and watchers when done
3. **Path Validation**: Validate file paths to prevent directory traversal
4. **Atomic Operations**: Use atomic operations for critical file updates
5. **Backup Strategy**: Create backups before destructive operations
6. **Performance**: Use streaming for large files to avoid memory issues
7. **Security**: Validate file permissions and sanitize file paths
8. **Monitoring**: Monitor disk usage and file operation performance

## Related Documentation

- [Overview](./overview.md) - SDK architecture and concepts
- [Code Execution](./code-execution.md) - Running code and commands
- [Sandbox Management](./sandbox-management.md) - Managing sandbox lifecycle
- [Terminal](./terminal.md) - Interactive terminal operations
- [Configuration](./configuration.md) - Filesystem configuration options