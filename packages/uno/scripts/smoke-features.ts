/**
 * Live check of pause/resume, snapshots and files against a real Uno account,
 * shaped like the closed ComputeSDK tests (marker file, fidelity set, fanout).
 *
 *   UNO_API_KEY=... npx tsx scripts/smoke-features.ts
 *
 * SMOKE_FANOUT (default 3) instances are restored from one snapshot at once;
 * SMOKE_BIG_MB (default 8) is the size of the large file written and read
 * back. Prints one timing line per step and destroys everything it created,
 * also on failure.
 */
import { createHash } from 'node:crypto'
import { uno } from '../src/index'

const t = () => performance.now()
const since = (a: number) => Math.round(t() - a)

async function main() {
  const compute = uno({ region: process.env.UNO_REGION })
  const fanout = Number(process.env.SMOKE_FANOUT ?? 3)
  const bigMb = Number(process.env.SMOKE_BIG_MB ?? 8)
  const made: Array<{ destroy: () => Promise<void> }> = []
  const snaps: string[] = []
  const timings: Record<string, number> = {}
  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const a = t()
    const out = await fn()
    timings[name] = since(a)
    console.log(`${name.padEnd(22)} ${String(timings[name]).padStart(6)} ms`)
    return out
  }
  const check = (ok: boolean, what: string) => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`)
    if (!ok) process.exitCode = 1
  }

  try {
    const src = await step('create', () => compute.instances.create())
    made.push(src)
    const dir = `/home/uno/smoke-${Date.now()}`
    const marker = `verify-${Math.random().toString(36).slice(2)}`

    // Files: small round trip, then a large one (base64 text, as the fs tests send it).
    await step('mkdir', () => src.filesystem.mkdir(dir))
    await step('write small', () => src.filesystem.writeFile(`${dir}/marker.txt`, marker))
    check((await step('read small', () => src.filesystem.readFile(`${dir}/marker.txt`))) === marker, 'small file round trip')
    const big = Buffer.alloc(bigMb * 1024 * 1024, 7).toString('base64')
    await step(`write ${bigMb} MiB b64`, () => src.filesystem.writeFile(`${dir}/large.b64`, big))
    const back = await step(`read ${bigMb} MiB b64`, () => src.filesystem.readFile(`${dir}/large.b64`))
    check(createHash('sha256').update(back).digest('hex') === createHash('sha256').update(big).digest('hex'), 'large file round trip')
    check((await step('readdir', () => src.filesystem.readdir(dir))).length === 2, 'readdir sees both files')
    check(await step('exists (missing)', () => src.filesystem.exists(`${dir}/nope`)) === false, 'exists on a missing path')

    // Pause/resume with a background process: memory should survive.
    await src.runCommand(`nohup sh -c 'while :; do echo t >> ${dir}/heartbeat.log; sleep 1; done' >/dev/null 2>&1 &`)
    await new Promise(r => setTimeout(r, 1500))
    await step('pause', () => src.pause!())
    await step('resume', () => src.resume!())
    const n1 = Number((await src.runCommand(`wc -l < ${dir}/heartbeat.log`)).stdout.trim())
    await new Promise(r => setTimeout(r, 2000))
    const n2 = Number((await src.runCommand(`wc -l < ${dir}/heartbeat.log`)).stdout.trim())
    check(n2 > n1, `heartbeat keeps going after resume (${n1} → ${n2})`)
    check((await src.filesystem.readFile(`${dir}/marker.txt`)) === marker, 'marker after resume')

    // Snapshot: fidelity set, then mutate the source after the snapshot.
    await src.runCommand(`chmod +x ${dir}/marker.txt && ln -sf ${dir}/marker.txt ${dir}/link && echo keep > ${dir}/mutated.txt && echo tmp > /tmp/smoke-tmp.txt`)
    const snap = await step('snapshot.create', () => compute.snapshot!.create(src.instanceId))
    snaps.push(snap.id)
    await src.runCommand(`echo changed > ${dir}/mutated.txt`)

    const restored = await step('create from snapshot', () => compute.instances.create({ snapshotId: snap.id }))
    made.push(restored)
    check((await restored.filesystem.readFile(`${dir}/marker.txt`)) === marker, 'marker in restored instance')
    check((await restored.filesystem.readFile(`${dir}/mutated.txt`)).trim() === 'keep', 'restore shows the disk as of the snapshot')
    const fid = await restored.runCommand(`test -x ${dir}/marker.txt && echo exec; readlink ${dir}/link; sha256sum < ${dir}/large.b64 | cut -c1-16; test -e /tmp/smoke-tmp.txt && echo tmp-kept || echo tmp-gone`)
    console.log('  fidelity:', fid.stdout.trim().split('\n').join(' | '))

    // Fanout: N instances from one snapshot at once.
    const a = t()
    const forks = await Promise.allSettled(Array.from({ length: fanout }, () => compute.instances.create({ snapshotId: snap.id })))
    timings[`fanout x${fanout}`] = since(a)
    for (const f of forks) if (f.status === 'fulfilled') made.push(f.value)
    const okForks = forks.filter(f => f.status === 'fulfilled').length
    console.log(`fanout x${fanout}`.padEnd(22), String(timings[`fanout x${fanout}`]).padStart(6), `ms  ${okForks}/${fanout} ok`)
    for (const f of forks) if (f.status === 'rejected') console.log('  fork failed:', String(f.reason).slice(0, 200))

    check((await compute.snapshot!.list()).some(s => s.id === snap.id), 'snapshot.list shows it')
    check(!(await compute.instances.list()).some(i => i.instanceId === snap.id), 'instances.list hides it')
  } finally {
    for (const m of made.reverse()) await m.destroy().catch(err => console.log('destroy failed:', String(err)))
    for (const id of snaps) await compute.snapshot!.delete(id).catch(err => console.log('snapshot delete failed:', String(err)))
    console.log('timings', JSON.stringify(timings))
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
