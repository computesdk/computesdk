import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * A stand-in for /usr/local/gcp/bin/sandbox: each sandbox is a directory used
 * as the command's working directory, tars are real tarballs, and `gs://`
 * URIs map into `<state>/gcs/<bucket>/<object>`. Like the real CLI, a failing
 * command makes the CLI exit 1 rather than with the command's status.
 * Every sandbox sees its directory as the same path, `<state>/root`, the way
 * real sandboxes share `/`: it is rewritten in commands and output.
 */
const SCRIPT = String.raw`
const fs = require('fs'), path = require('path'), cp = require('child_process')
const STATE = __STATE__
const argv = process.argv.slice(2)
fs.appendFileSync(path.join(STATE, 'calls.log'), JSON.stringify(argv) + '\n')
const VALUE_FLAGS = new Set(['-e', '--env', '-w', '--workdir', '--import-tar', '--export-tar', '--sync-tar', '--file', '--tar', '--mount', '--rootfs', '-p', '--publish', '--sandbox-name'])
const sub = argv[0]
const flags = {}, env = {}, positional = []
let command = []
for (let i = 1; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--') { command = argv.slice(i + 1); break }
  if (a.startsWith('-')) {
    const [name, inline] = a.split(/=(.*)/s)
    const value = inline !== undefined ? inline : VALUE_FLAGS.has(name) ? argv[++i] : 'true'
    if (name === '-e' || name === '--env') { const [k, v] = value.split(/=(.*)/s); env[k] = v }
    else flags[name] = value
  } else positional.push(a)
}
const fail = (msg) => { process.stderr.write('Error: ' + msg + '\n'); process.exit(1) }
const root = (id) => path.join(STATE, 'sb', id)
const resolveUri = (uri) => uri.startsWith('gs://') ? path.join(STATE, 'gcs', uri.slice(5)) : uri
const writeTar = (id, uri) => {
  const file = resolveUri(uri)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  cp.execFileSync('tar', ['-cf', file, '-C', root(id), '.'])
}
const start = (id, importTar) => {
  if (fs.existsSync(root(id))) fail('sandbox ' + id + ' already exists')
  if (importTar && !fs.existsSync(resolveUri(importTar))) fail('failed to open tar file ' + JSON.stringify(importTar) + ': no such file or directory')
  fs.mkdirSync(root(id), { recursive: true })
  if (importTar) cp.execFileSync('tar', ['-xf', resolveUri(importTar), '-C', root(id)])
  fs.writeFileSync(root(id) + '.env.json', JSON.stringify(env))
}
const VROOT = path.join(STATE, 'root')
const run = (id, extraEnv) => {
  const saved = fs.existsSync(root(id) + '.env.json') ? JSON.parse(fs.readFileSync(root(id) + '.env.json', 'utf8')) : {}
  const toReal = (s) => s.split(VROOT).join(root(id))
  const toVirtual = (s) => s.split(root(id)).join(VROOT)
  const child = cp.spawn(command[0], command.slice(1).map(toReal), { cwd: root(id), stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: root(id), ...saved, ...extraEnv } })
  child.stdout.on('data', (d) => process.stdout.write(toVirtual(String(d))))
  child.stderr.on('data', (d) => process.stderr.write(toVirtual(String(d))))
  const forward = (sig) => { try { child.kill(sig) } catch {} }
  process.on('SIGTERM', () => { forward('SIGTERM'); process.exit(143) })
  return new Promise((resolve) => child.on('close', (code) => resolve(code === 0 ? 0 : 1)))
}
;(async () => {
  if (sub === 'run') {
    start(positional[0], flags['--import-tar'])
    if (env.FAKE_CREATE_FAILURE) fail('create failed after allocation')
    if (env.FAKE_CREATE_DELAY_MS) await new Promise(resolve => setTimeout(resolve, Number(env.FAKE_CREATE_DELAY_MS)))
    return
  }
  if (sub === 'exec') {
    const id = positional[0]
    if (!fs.existsSync(root(id))) fail('sandbox ' + id + ' is not running')
    process.exit(await run(id, env))
  }
  if (sub === 'do') {
    const id = 'do-' + process.pid
    start(id, flags['--import-tar'])
    const code = await run(id, {})
    fs.rmSync(root(id), { recursive: true, force: true }); fs.rmSync(root(id) + '.env.json', { force: true })
    process.exit(code)
  }
  if (sub === 'tar') {
    const id = positional[0]
    if (!fs.existsSync(root(id))) fail('sandbox is not running')
    writeTar(id, flags['--file'])
    return
  }
  if (sub === 'fork') {
    const [src, dst] = positional
    if (!fs.existsSync(root(src))) fail('source session ' + src + ' is not running')
    if (flags['--tar']) writeTar(src, flags['--tar'])
    fs.cpSync(root(src), root(dst), { recursive: true })
    fs.copyFileSync(root(src) + '.env.json', root(dst) + '.env.json')
    return
  }
  if (sub === 'delete') {
    const id = positional[0]
    if (!fs.existsSync(root(id))) fail('sandbox ' + id + ' not found')
    fs.rmSync(root(id), { recursive: true, force: true }); fs.rmSync(root(id) + '.env.json', { force: true })
    return
  }
  fail('unknown command ' + sub)
})()
`

export interface FakeSandboxCli {
  binary: string
  state: string
  calls: () => string[][]
  cleanup: () => void
}

export function createFakeSandboxCli(): FakeSandboxCli {
  // Not under /tmp: the real CLI excludes /tmp from snapshots, so the
  // conformance suite skips sandbox dirs under it when placing markers.
  const base = join(homedir(), '.cache', 'computesdk-gcp-tests')
  mkdirSync(base, { recursive: true })
  const state = mkdtempSync(join(base, 'fake-sandbox-cli-'))
  const binary = join(state, 'sandbox')
  writeFileSync(binary, `#!/usr/bin/env node\n${SCRIPT.replace('__STATE__', JSON.stringify(state))}`)
  chmodSync(binary, 0o755)
  writeFileSync(join(state, 'calls.log'), '')
  return {
    binary,
    state,
    calls: () => readFileSync(join(state, 'calls.log'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)),
    cleanup: () => rmSync(state, { recursive: true, force: true }),
  }
}
