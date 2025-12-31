import { docker } from '@computesdk/docker'
import { config } from 'dotenv'
import { NODEJS_SNIPPETS, PYTHON_SNIPPETS } from './constants/code-snippets'
config() // Load env (e.g., DOCKER_HOST / TLS vars)

/**
 * Docker Sandbox Provider Example
 *
 * This example shows how to use the Docker provider in **direct mode** for **Node.js** and **Python**
 * code execution — plus a small sample of filesystem operations (supported).
 *
 * Note: Docker provider uses direct mode since it runs locally and doesn't go through the gateway.
 *
 * Prerequisites:
 * - Docker daemon running and accessible (Docker Desktop or dockerd)
 * - On Linux, your user may need to be in the `docker` group
 *
 * Optional environment variables (for remote daemon / TLS):
 * - DOCKER_HOST
 * - DOCKER_TLS_VERIFY
 * - DOCKER_CERT_PATH
 */
async function main() {
  // Direct mode: use Docker provider directly (no gateway needed for local Docker)
  const compute = docker({
    // Default image hints; we still set explicit images per sandbox below.
    image: { name: 'python:3.11-slim', pullPolicy: 'ifNotPresent' },
    container: {
      workdir: '/workspace',
      resources: { memory: 512 * 1024 * 1024 },
    },
  })

  let py: any | null = null
  let node: any | null = null

  try {
    // Python sandbox 
    py = await compute.sandbox.create({
      runtime: 'python',
      image: { name: 'python:3.11-slim' },
    })
    console.log('Created Docker (Python) sandbox:', py.sandboxId)
    console.log('Provider:', py.provider)

    const pythonCode = [
      PYTHON_SNIPPETS.HELLO_WORLD,
      PYTHON_SNIPPETS.FIBONACCI,
    ].join('\n\n')

    const pyResult = await py.runCode(pythonCode, 'python')
    console.log('\n--- Python Execution ---')
    console.log('Output:\n' + (pyResult.output || '∅'))
    console.log('Exit code:', pyResult.exitCode)
    console.log('Language:', pyResult.language)

    // Filesystem (supported on Docker)
    console.log('\nFilesystem Operations (Python sandbox)')
    await py.filesystem.mkdir('/workspace/demo')
    await py.filesystem.writeFile('/workspace/demo/out.txt', 'hello from Docker FS')
    const exists = await py.filesystem.exists('/workspace/demo/out.txt')
    console.log('exists?', exists)
    const listing = await py.filesystem.readdir('/workspace/demo')
    console.log('readdir demo ->', listing)
    const contents = await py.filesystem.readFile('/workspace/demo/out.txt')
    console.log('readFile ->', contents)

    // Node.js sandbox 
    node = await compute.sandbox.create({
      runtime: 'node',
      image: { name: 'node:20-alpine' },
    })
    console.log('\nCreated Docker (Node) sandbox:', node.sandboxId)

    const nodeCode = [
      NODEJS_SNIPPETS.HELLO_WORLD,
      NODEJS_SNIPPETS.TEAM_PROCESSING,
    ].join('\n\n')

    const nodeResult = await node.runCode(nodeCode, 'node')
    console.log('\nNode.js Execution')
    console.log('Output:\n' + (nodeResult.output || '∅'))
    console.log('Exit code:', nodeResult.exitCode)
    console.log('Language:', nodeResult.language)

    // Optional shell command
    const cmd = await node.runCommand('sh', ['-lc', 'echo runtime=$(node -v) && uname -a'])
    console.log('\nShell Command (Node sandbox)')
    console.log('stdout:\n' + (cmd.stdout || '∅'))
    if (cmd.stderr) console.error('stderr:\n' + cmd.stderr)
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error:', error.message)
      // Helpful guidance for common daemon/auth issues
      if (/ECONNREFUSED|EACCES|ENOENT|permission|connect/i.test(error.message)) {
        console.error('\nTroubleshooting:')
        console.error('- Ensure Docker Desktop/daemon is running')
        console.error('- On Linux, check your user is in the `docker` group')
        console.error('- For remote daemons, set DOCKER_HOST/DOCKER_TLS_VERIFY/DOCKER_CERT_PATH')
      }
    } else {
      console.error('Unknown error:', error)
    }
    process.exitCode = 1
  } finally {
    // Always clean up if any sandbox was created
    try { if (py) await py.destroy() } catch { }
    try { if (node) await node.destroy() } catch { }
    console.log('\nCleanup complete.')
  }
}

main()
