/**
 * Live smoke test against a real Uno account.
 *
 *   UNO_API_KEY=... UNO_REGION=us npx tsx scripts/smoke.ts [path/to/dax-benchmark.sh]
 *
 * Creates an 8 vCPU / 16 GiB machine (SMOKE_VCPU / SMOKE_RAM_MB / SMOKE_DISK_GB override), checks the basics the sandbox
 * benchmarks rely on (node, sudo, a long heredoc command, filesystem), and
 * optionally runs the Dax script exactly as benchmarks/sandbox/dax.bench.ts
 * sends it. Always destroys the machine.
 */
import { readFileSync } from 'node:fs'
import { uno } from '../src/index'

const t = () => performance.now()
const ms = (a: number) => `${Math.round(t() - a)} ms`

async function main() {
  const compute = uno({ region: process.env.UNO_REGION })
  let start = t()
  const vcpus = Number(process.env.SMOKE_VCPU ?? 8)
  const memoryMiB = Number(process.env.SMOKE_RAM_MB ?? 16384)
  const diskMiB = Number(process.env.SMOKE_DISK_GB ?? 20) * 1024
  const sandbox = await compute.sandbox.create({ vcpus, memoryMiB, diskMiB } as any)
  console.log(`create+ready  ${ms(start)}  id=${sandbox.sandboxId}`)
  try {
    start = t()
    const node = await sandbox.runCommand('node -v')
    console.log(`node -v       ${ms(start)}  exit=${node.exitCode} ${node.stdout.trim() || node.stderr.trim()}`)

    const sys = await sandbox.runCommand('nproc; free -m | head -2; sudo -n true && echo sudo-ok; cat /etc/os-release | head -1')
    console.log(sys.stdout.trim())

    await sandbox.filesystem.writeFile('/tmp/uno-smoke/a.txt', 'quote \' dollar $HOME EOF\n')
    console.log('fs roundtrip ', JSON.stringify(await sandbox.filesystem.readFile('/tmp/uno-smoke/a.txt')))

    const daxPath = process.argv[2]
    if (daxPath) {
      const script = readFileSync(daxPath, 'utf8')
      const marker = '__DAX_BENCH_HEREDOC_' + Math.random().toString(36).slice(2) + '__'
      const cmd = `cat > /tmp/dax-benchmark.sh <<'${marker}'\n${script}\n${marker}\nBENCH_PROVIDER=uno BENCH_REGION=${process.env.UNO_REGION ?? 'default'} bash /tmp/dax-benchmark.sh`
      start = t()
      const r = await sandbox.runCommand(cmd, { timeout: 600_000 })
      console.log(`dax total     ${ms(start)}  exit=${r.exitCode}`)
      for (const line of r.stdout.split('\n')) if (/^BENCH_(PHASE|META|DONE)\t/.test(line)) console.log('  ' + line)
      for (const line of r.stderr.split('\n')) if (line.startsWith('BENCH_ERROR')) console.log('  ' + line)
      if (r.exitCode !== 0) console.log('--- stderr tail\n' + r.stderr.split('\n').slice(-15).join('\n') + '\n--- stdout tail\n' + r.stdout.split('\n').slice(-8).join('\n'))
    }
  } finally {
    start = t()
    await sandbox.destroy()
    console.log(`destroy       ${ms(start)}`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
