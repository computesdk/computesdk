import { expect, it } from "vitest";
import { runloop } from "../index";

const runLive = process.env.RUNLOOP_INTEGRATION === "1" && Boolean(process.env.RUNLOOP_API_KEY);

it.runIf(runLive)("runs the modernized adapter against one shared Runloop devbox", async () => {
  const provider = runloop({
    apiKey: process.env.RUNLOOP_API_KEY,
    timeout: 120_000,
  });
  const sandbox = await provider.sandbox.create({
    name: `computesdk-adapter-${Date.now()}`,
    timeout: 120_000,
    metadata: { test: "modernized-runloop-adapter" },
  });
  const root = `/tmp/computesdk hostile ' $() ${Date.now()}\nroot`;
  const fileName = `space ' quote $(touch-nope)\nfile.txt`;
  const filePath = `${root}/${fileName}`;
  const timeoutMarker = `/tmp/computesdk-timeout-${Date.now()}`;

  try {
    const longOutput = await sandbox.runCommand(
      "for i in $(seq 1 150); do printf 'line-%s\\n' \"$i\"; done",
    );
    expect(longOutput.exitCode).toBe(0);
    expect(longOutput.stdout).toContain("line-1\n");
    expect(longOutput.stdout).toContain("line-150\n");

    const streamed: string[] = [];
    const streamedResult = await sandbox.runCommand(
      "printf 'first\\n'; sleep 0.2; printf 'second\\n'",
      { onStdout: (chunk) => streamed.push(chunk) },
    );
    expect(streamedResult.exitCode).toBe(0);
    expect(streamed.join("")).toContain("first\n");
    expect(streamed.join("")).toContain("second\n");

    await sandbox.filesystem.mkdir(root);
    const content = `utf8-✓-$\{HOME\}-$(touch nope)-${"x".repeat(200_000)}`;
    await sandbox.filesystem.writeFile(filePath, content);
    await expect(sandbox.filesystem.readFile(filePath)).resolves.toBe(content);
    const entries = await sandbox.filesystem.readdir(root);
    expect(entries.find((entry) => entry.name === fileName)).toMatchObject({
      type: "file",
      size: Buffer.byteLength(content),
    });

    const info = await sandbox.getInfo();
    expect(info).toMatchObject({ id: sandbox.sandboxId, provider: "runloop", status: "running" });

    await sandbox.runCommand(`rm -f -- '${timeoutMarker}'`);
    const timedOut = await sandbox.runCommand(
      `(sleep 2; touch -- '${timeoutMarker}') & wait`,
      { timeout: 200 },
    );
    expect(timedOut.exitCode).toBe(124);
    const cancellation = await sandbox.runCommand(`sleep 3; test ! -e '${timeoutMarker}'`);
    expect(cancellation.exitCode).toBe(0);
  } finally {
    await sandbox.filesystem.remove(root).catch(() => undefined);
    await sandbox.runCommand(`rm -f -- '${timeoutMarker}'`).catch(() => undefined);
    await sandbox.destroy().catch(() => undefined);
  }
}, 180_000);
