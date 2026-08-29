import { cloudflare } from '@computesdk/cloudflare'
import { bridge } from '@cloudflare/sandbox/bridge'

export { Sandbox } from '@cloudflare/sandbox'
export { WarmPool } from '@cloudflare/sandbox/bridge'

// Reuse the official bridge `scheduled` handler to prime the WarmPool on a cron
// trigger, so containers warm up even before the first request. We only take
// its `scheduled` export — `fetch` below stays our own, so no bridge HTTP routes
// are exposed.
const { scheduled: primeWarmPool } = bridge({})

interface Env {
  Sandbox: any
  WarmPool: any
  WARM_POOL_TARGET?: string
  WARM_POOL_REFRESH_INTERVAL?: string
}

function warmTarget(env: Env): number {
  return Number.parseInt(env.WARM_POOL_TARGET || '5', 10)
}

function refreshInterval(env: Env): number {
  return Number.parseInt(env.WARM_POOL_REFRESH_INTERVAL || '10000', 10)
}

function createCompute(env: Env) {
  return cloudflare({
    sandboxBinding: env.Sandbox,
    warmPool: {
      binding: env.WarmPool,
      target: warmTarget(env),
      refreshInterval: refreshInterval(env),
    },
  })
}

export default {
  async fetch(_request: Request, env: Env): Promise<Response> {
    const compute = createCompute(env)
    const sandbox = await compute.sandbox.create({
      envs: { EXAMPLE_NAME: 'cloudflare-direct' },
    })

    try {
      const command = await sandbox.runCommand([
        'set -e',
        'echo "hello from $EXAMPLE_NAME"',
        'node --version',
        'pwd',
      ].join(' && '))

      await sandbox.filesystem.mkdir('/workspace/computesdk-demo')
      await sandbox.filesystem.writeFile('/workspace/computesdk-demo/message.txt', 'hello from ComputeSDK direct mode')
      const message = await sandbox.filesystem.readFile('/workspace/computesdk-demo/message.txt')

      return Response.json({
        sandboxId: sandbox.sandboxId,
        command,
        message,
      })
    } finally {
      await sandbox.destroy()
    }
  },

  scheduled: primeWarmPool,
}
