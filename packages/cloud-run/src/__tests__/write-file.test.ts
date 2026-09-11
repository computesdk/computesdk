import { describe, expect, it } from 'vitest'
import { buildWriteFileCommands } from '../index'

const MAX_ARG_STRLEN = 128 * 1024

describe('buildWriteFileCommands', () => {
  it('keeps every command under the Linux single-argument limit for a 100 KiB file', () => {
    const content = 'x'.repeat(100 * 1024)
    const { commands, cleanup } = buildWriteFileCommands('/tmp/bench/file.txt', content)

    for (const command of commands) expect(command.length).toBeLessThan(MAX_ARG_STRLEN)
    expect(commands.length).toBeGreaterThan(3)
    expect(commands[0]).toMatch(/^mkdir -p "\$\(dirname "\/tmp\/bench\/file\.txt"\)" && : > "\/tmp\/bench\/file\.txt\.computesdk-tmp\.[0-9a-f]{8}"$/)
    expect(commands.at(-1)).toMatch(/^cat < ".*\.computesdk-tmp\.[0-9a-f]{8}" > "\/tmp\/bench\/file\.txt" && rm -f ".*\.computesdk-tmp\.[0-9a-f]{8}"$/)
    expect(cleanup).toMatch(/^rm -f "\/tmp\/bench\/file\.txt\.computesdk-tmp\.[0-9a-f]{8}"$/)
  })

  it('reassembles the original content from the chunked base64 payloads', () => {
    const content = 'héllo wörld '.repeat(20_000)
    const { commands } = buildWriteFileCommands('/tmp/a.txt', content)
    const b64 = commands
      .slice(1, -1)
      .map(command => /printf '%s' '([^']*)'/.exec(command)?.[1] ?? '')
      .join('')
    expect(Buffer.from(b64, 'base64').toString('utf8')).toBe(content)
  })

  it('uses a distinct staging file per call', () => {
    const a = buildWriteFileCommands('/tmp/a.txt', 'a')
    const b = buildWriteFileCommands('/tmp/a.txt', 'b')
    expect(a.cleanup).not.toBe(b.cleanup)
  })
})
