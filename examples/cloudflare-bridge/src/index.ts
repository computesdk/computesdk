import { cloudflare } from '@computesdk/cloudflare'
import { config } from 'dotenv'

config()

async function main() {
  const sandboxUrl = process.env.CLOUDFLARE_SANDBOX_URL
  const sandboxApiKey = process.env.CLOUDFLARE_SANDBOX_API_KEY

  if (!sandboxUrl || !sandboxApiKey) {
    throw new Error([
      'Missing Cloudflare bridge configuration.',
      'Set CLOUDFLARE_SANDBOX_URL to your deployed bridge Worker URL.',
      'Set CLOUDFLARE_SANDBOX_API_KEY to the same value as the bridge Worker SANDBOX_API_KEY secret.',
    ].join('\n'))
  }

  const compute = cloudflare({ sandboxUrl, sandboxApiKey })
  const sandbox = await compute.sandbox.create({
    envs: { EXAMPLE_NAME: 'cloudflare-bridge' },
  })

  console.log('Created Cloudflare bridge sandbox:', sandbox.sandboxId)

  try {
    const command = await sandbox.runCommand([
      'set -e',
      'echo "hello from $EXAMPLE_NAME"',
      'node --version || true',
      'python3 --version || python --version || true',
      'pwd',
    ].join(' && '))

    console.log('\nCommand stdout:\n' + (command.stdout || '∅'))
    if (command.stderr) console.error('\nCommand stderr:\n' + command.stderr)
    console.log('Command exit code:', command.exitCode)

    await sandbox.filesystem.mkdir('/workspace/computesdk-demo')
    await sandbox.filesystem.writeFile('/workspace/computesdk-demo/message.txt', 'hello from ComputeSDK over the Cloudflare bridge')
    const message = await sandbox.filesystem.readFile('/workspace/computesdk-demo/message.txt')

    console.log('\nFile readback:', message)

    const listing = await sandbox.filesystem.readdir('/workspace/computesdk-demo')
    console.log('Directory listing:', listing)
  } finally {
    await sandbox.destroy()
    console.log('\nSandbox destroyed.')
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
