import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = path.resolve(__dirname, '../..')
const cjsEntry = path.join(packageRoot, 'dist/index.js')
const esmEntry = path.join(packageRoot, 'dist/index.mjs')

function node(source: string, args: string[] = []): string {
  return execFileSync(process.execPath, [...args, '-e', source], {
    encoding: 'utf8',
    cwd: packageRoot,
  }).trim()
}

describe('published package entry points', () => {
  it('loads through CommonJS require', () => {
    const output = node(`console.log(Object.keys(require(${JSON.stringify(cjsEntry)})).join(','))`)
    expect(output).toContain('brezel')
  })

  it('loads through ESM import', () => {
    const url = pathToFileURL(esmEntry).href
    const output = node(
      `import(${JSON.stringify(url)}).then(mod => console.log(Object.keys(mod).join(',')))`,
      ['--input-type=module'],
    )
    expect(output).toContain('brezel')
  })
})
