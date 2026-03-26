import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

describe('@computesdk/cli', () => {
  it('should have a valid package.json', () => {
    const packageJson = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8')
    )
    
    expect(packageJson.name).toBe('@computesdk/cli')
    expect(packageJson.bin).toHaveProperty('compute')
  })
})
