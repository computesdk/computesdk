import { describe, it, expect } from "vitest";
import { tensorlake } from "../index";

const live =
  process.env.SKIP_INTEGRATION !== "true" && !!process.env.TENSORLAKE_API_KEY;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!live)("tensorlake timed runs", () => {
  it("keeps a detached child alive past the launcher's timeout, and still stops a slow command", async () => {
    const sb = await tensorlake({}).sandbox.create();
    try {
      const launch = await sb.runCommand(
        `nohup sh -c 'while :; do date +%s >> /tmp/w; sleep 1; done' >/dev/null 2>&1 &`,
        { timeout: 5000 },
      );
      expect(launch.exitCode).toBe(0);

      const start = Date.now();
      const slow = await sb.runCommand("sleep 20; echo late > /tmp/late", {
        timeout: 3000,
      });
      expect(slow.exitCode).toBe(124);
      expect(Date.now() - start).toBeLessThan(15000);

      await sleep(12000);
      const lines = await sb.runCommand("wc -l < /tmp/w");
      expect(Number(lines.stdout.trim())).toBeGreaterThan(12);
      const late = await sb.runCommand("test -e /tmp/late");
      expect(late.exitCode).not.toBe(0);
    } finally {
      await sb.destroy();
    }
  }, 120_000);
});
