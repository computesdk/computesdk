import {
  cloudflare,
  type CloudflareSandboxBinding,
} from '@computesdk/cloudflare'

export default {
  async fetch(_request: Request, env: Env): Promise<Response> {
    const compute = cloudflare({
      sandboxBinding: env.SANDBOX as unknown as CloudflareSandboxBinding,
    })
    const sandbox = await compute.sandbox.create({
      envs: { EXAMPLE_NAME: 'cloudflare-direct' },
    })

    try {
      const command = await sandbox.runCommand(
        [
          'set -e',
          'echo "hello from $EXAMPLE_NAME"',
          'node --version',
          'pwd',
        ].join(' && ')
      )

      await sandbox.filesystem.mkdir('/tmp/computesdk-demo')
      await sandbox.filesystem.writeFile(
        '/tmp/computesdk-demo/message.txt',
        'hello from ComputeSDK direct mode'
      )
      const message = await sandbox.filesystem.readFile(
        '/tmp/computesdk-demo/message.txt'
      )

      return Response.json({
        sandboxId: sandbox.sandboxId,
        command,
        message,
      })
    } finally {
      await sandbox.destroy()
    }
  },
}
