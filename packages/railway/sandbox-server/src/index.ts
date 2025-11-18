import express from 'express'
import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs/promises'
import path from 'path'
import { stat } from 'fs/promises'

const execAsync = promisify(exec)
const app = express()

app.use(express.json({ limit: '50mb' }))

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() })
})

// Execute code
app.post('/execute', async (req, res) => {
  try {
    const { code, runtime = 'node' } = req.body
    const startTime = Date.now()
    
    // Determine file extension and executor
    let fileExt: string
    let executor: string
    
    switch (runtime.toLowerCase()) {
      case 'python':
      case 'python3':
        fileExt = '.py'
        executor = 'python3'
        break
      case 'node':
      case 'javascript':
      case 'js':
        fileExt = '.js'
        executor = 'node'
        break
      case 'typescript':
      case 'ts':
        fileExt = '.ts'
        executor = 'tsx' // Assuming tsx is installed
        break
      default:
        fileExt = '.js'
        executor = 'node'
    }
    
    // Write code to temp file
    const filePath = `/tmp/code-${Date.now()}${fileExt}`
    await fs.writeFile(filePath, code)
    
    try {
      const { stdout, stderr } = await execAsync(`${executor} ${filePath}`, {
        cwd: '/workspace',
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024 // 10MB
      })
      
      // Cleanup
      await fs.unlink(filePath).catch(() => {})
      
      res.json({
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: 0,
        executionTime: Date.now() - startTime
      })
    } catch (error: any) {
      // Cleanup on error
      await fs.unlink(filePath).catch(() => {})
      
      res.json({
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        exitCode: error.code || 1,
        executionTime: Date.now() - startTime
      })
    }
  } catch (error: any) {
    res.status(500).json({
      stdout: '',
      stderr: error.message,
      exitCode: 1,
      executionTime: 0
    })
  }
})

// Execute command
app.post('/command', async (req, res) => {
  try {
    const { 
      command, 
      args = [], 
      cwd = '/workspace', 
      env = {},
      background = false
    } = req.body
    
    const fullCommand = `${command} ${args.join(' ')}`
    
    if (background) {
      // For background processes, start and return immediately
      const child = exec(fullCommand, {
        cwd,
        env: { ...process.env, ...env }
      })
      
      res.json({
        stdout: '',
        stderr: '',
        exitCode: 0,
        pid: child.pid
      })
    } else {
      // Regular synchronous execution
      try {
        const { stdout, stderr } = await execAsync(fullCommand, {
          cwd,
          env: { ...process.env, ...env },
          timeout: 60000,
          maxBuffer: 10 * 1024 * 1024
        })
        
        res.json({
          stdout: stdout || '',
          stderr: stderr || '',
          exitCode: 0
        })
      } catch (error: any) {
        res.json({
          stdout: error.stdout || '',
          stderr: error.stderr || error.message,
          exitCode: error.code || 1
        })
      }
    }
  } catch (error: any) {
    res.status(500).json({
      stdout: '',
      stderr: error.message,
      exitCode: 1
    })
  }
})

// Filesystem: Write file
app.post('/fs/write', async (req, res) => {
  try {
    const { path: filePath, content } = req.body
    
    // Ensure directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, 'utf-8')
    
    res.json({ success: true })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// Filesystem: Read file
app.post('/fs/read', async (req, res) => {
  try {
    const { path: filePath } = req.body
    const content = await fs.readFile(filePath, 'utf-8')
    
    res.json({ content })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// Filesystem: Create directory
app.post('/fs/mkdir', async (req, res) => {
  try {
    const { path: dirPath } = req.body
    await fs.mkdir(dirPath, { recursive: true })
    
    res.json({ success: true })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// Filesystem: Read directory
app.post('/fs/readdir', async (req, res) => {
  try {
    const { path: dirPath } = req.body
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    
    const files = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dirPath, entry.name)
        let stats
        try {
          stats = await stat(fullPath)
        } catch {
          stats = { size: 0, mtime: new Date() }
        }
        
        return {
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          size: stats.size,
          lastModified: stats.mtime
        }
      })
    )
    
    res.json({ files })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// Filesystem: Check if exists
app.post('/fs/exists', async (req, res) => {
  try {
    const { path: filePath } = req.body
    await fs.access(filePath)
    res.json({ exists: true })
  } catch {
    res.json({ exists: false })
  }
})

// Filesystem: Remove file/directory
app.post('/fs/remove', async (req, res) => {
  try {
    const { path: filePath } = req.body
    await fs.rm(filePath, { recursive: true, force: true })
    
    res.json({ success: true })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Server error:', err)
  res.status(500).json({ error: 'Internal server error' })
})

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log(`Sandbox server listening on port ${PORT}`)
  console.log(`Runtime: ${process.env.RUNTIME || 'node'}`)
  console.log(`Sandbox Mode: ${process.env.SANDBOX_MODE || 'false'}`)
})