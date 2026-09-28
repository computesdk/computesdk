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

/**
 * Loads the provider with `load`, then calls getById against a local stand-in
 * for Runtime's API. The call makes the provider load `withruntime`, which is
 * published as ES modules only, so this proves the SDK loads from the
 * CommonJS build too, not only that the entry point parses.
 */
function againstStubApi(load: string): string {
  return `
    const http = require('node:http')
    const seen = []
    const server = http.createServer((req, res) => {
      seen.push(req.method + ' ' + req.url.split('?')[0] + ' ' + req.headers.authorization)
      res.setHeader('content-type', 'application/json')
      if (req.url.startsWith('/v1/sandboxes/sbx_live')) {
        res.end(JSON.stringify({ id: 'sbx_live', kind: 'sandbox', state: 'running', status: 'active', createdAt: '2026-09-25T00:00:00.000Z' }))
      } else {
        res.statusCode = 404
        res.end(JSON.stringify({ error: { code: 'not_found', message: 'No such sandbox.' } }))
      }
    })
    server.listen(0, '127.0.0.1', async () => {
      try {
        const { runtime } = await (${load})
        const provider = runtime({ apiKey: 'rk_test', baseUrl: 'http://127.0.0.1:' + server.address().port })
        const live = await provider.sandbox.getById('sbx_live')
        const missing = await provider.sandbox.getById('sbx_missing')
        console.log(JSON.stringify({ live: live && live.sandboxId, missing, seen }))
      } catch (error) {
        console.log(JSON.stringify({ error: String(error && error.stack || error) }))
      } finally {
        server.close()
      }
    })
  `
}

const expected = {
  live: 'sbx_live',
  missing: null,
  seen: [
    'GET /v1/sandboxes/sbx_live Bearer rk_test',
    'GET /v1/sandboxes/sbx_missing Bearer rk_test',
  ],
}

describe('published package entry points', () => {
  it('loads through CommonJS require', () => {
    const output = node(`console.log(Object.keys(require(${JSON.stringify(cjsEntry)})).join(','))`)
    expect(output).toContain('runtime')
  })

  it('loads through ESM import', () => {
    const url = pathToFileURL(esmEntry).href
    const output = node(
      `import(${JSON.stringify(url)}).then(mod => console.log(Object.keys(mod).join(',')))`,
      ['--input-type=module'],
    )
    expect(output).toContain('runtime')
  })

  it('reaches the Runtime SDK from the CommonJS build', () => {
    const output = node(againstStubApi(`Promise.resolve(require(${JSON.stringify(cjsEntry)}))`))
    expect(JSON.parse(output)).toEqual(expected)
  })

  it('reaches the Runtime SDK from the ESM build', () => {
    const output = node(againstStubApi(`import(${JSON.stringify(pathToFileURL(esmEntry).href)})`))
    expect(JSON.parse(output)).toEqual(expected)
  })
})
