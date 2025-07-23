import type { SandboxFileSystem, FileEntry } from 'computesdk'

// Test-only filesystem implementation for Node.js environments
export class TestFileSystem implements SandboxFileSystem {
  private files = new Map<string, { content: string; isDirectory: boolean; lastModified: Date }>()

  constructor() {
    // Create root directory
    this.files.set('/', { content: '', isDirectory: true, lastModified: new Date() })
  }

  // Normalize path by removing double slashes, handling . and .. references
  private normalizePath(path: string): string {
    if (!path.startsWith('/')) {
      path = '/' + path
    }
    
    // Remove double slashes and empty components
    const parts = path.split('/').filter(part => part !== '' && part !== '.')
    const normalized: string[] = []
    
    for (const part of parts) {
      if (part === '..') {
        normalized.pop()
      } else {
        normalized.push(part)
      }
    }
    
    return '/' + normalized.join('/')
  }

  async readFile(path: string): Promise<string> {
    path = this.normalizePath(path)
    const file = this.files.get(path)
    if (!file) {
      throw new Error(`File not found: ${path}`)
    }
    if (file.isDirectory) {
      throw new Error(`Path is a directory: ${path}`)
    }
    return file.content
  }

  async writeFile(path: string, content: string): Promise<void> {
    path = this.normalizePath(path)
    
    // Ensure parent directory exists
    const parentPath = path.substring(0, path.lastIndexOf('/')) || '/'
    if (parentPath !== '/' && !this.files.has(parentPath)) {
      await this.mkdir(parentPath)
    }
    
    this.files.set(path, { content, isDirectory: false, lastModified: new Date() })
  }

  async mkdir(path: string): Promise<void> {
    path = this.normalizePath(path)
    
    if (this.files.has(path)) {
      const existing = this.files.get(path)!
      if (existing.isDirectory) {
        throw new Error(`Directory already exists: ${path}`)
      } else {
        throw new Error(`Path exists but is not a directory: ${path}`)
      }
    }
    
    // Ensure parent directory exists
    const parentPath = path.substring(0, path.lastIndexOf('/')) || '/'
    if (parentPath !== '/' && !this.files.has(parentPath)) {
      await this.mkdir(parentPath)
    }
    
    this.files.set(path, { content: '', isDirectory: true, lastModified: new Date() })
  }

  async readdir(path: string): Promise<FileEntry[]> {
    path = this.normalizePath(path)
    const dir = this.files.get(path)
    if (!dir) {
      throw new Error(`Directory not found: ${path}`)
    }
    if (!dir.isDirectory) {
      throw new Error(`Path is not a directory: ${path}`)
    }
    
    const entries: FileEntry[] = []
    const prefix = path === '/' ? '/' : `${path}/`
    
    for (const [filePath, file] of this.files) {
      if (filePath.startsWith(prefix) && filePath !== path) {
        const relativePath = filePath.substring(prefix.length)
        if (!relativePath.includes('/')) {
          entries.push({
            name: relativePath,
            path: filePath,
            isDirectory: file.isDirectory,
            size: file.content.length,
            lastModified: file.lastModified,
          })
        }
      }
    }
    
    return entries
  }

  async exists(path: string): Promise<boolean> {
    path = this.normalizePath(path)
    return this.files.has(path)
  }

  async remove(path: string): Promise<void> {
    path = this.normalizePath(path)
    
    // Prevent removing root directory
    if (path === '/') {
      throw new Error('Cannot remove root directory')
    }
    
    if (!this.files.has(path)) {
      throw new Error(`File or directory not found: ${path}`)
    }
    
    const file = this.files.get(path)!
    
    if (file.isDirectory) {
      // Remove all files and subdirectories recursively
      const toRemove: string[] = []
      const prefix = `${path}/`
      
      for (const filePath of this.files.keys()) {
        if (filePath.startsWith(prefix)) {
          toRemove.push(filePath)
        }
      }
      
      // Remove all children first
      for (const childPath of toRemove) {
        this.files.delete(childPath)
      }
    }
    
    // Remove the path itself
    this.files.delete(path)
  }
}