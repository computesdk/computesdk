import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

describe('create-compute', () => {
  it('should have a valid package.json', () => {
    const packageJson = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8')
    )
    
    expect(packageJson.name).toBe('create-compute')
    expect(packageJson.version).toBe('0.0.1')
    expect(packageJson.bin).toHaveProperty('create-compute')
  })
  
  it('should export a CLI entry point', async () => {
    // This is a placeholder test
    // In a real implementation, we would test the CLI functionality
    expect(true).toBe(true)
  })
})