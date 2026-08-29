import process from "node:process";
import { docker } from "@computesdk/docker";
import { daemonSeedScriptCommand, parseSeedInvocationOutput } from "../../dist/index.js";

async function runSeedInSandbox(sandbox, payloadArg) {
  const command = daemonSeedScriptCommand(
    { name: `docker-seed-script-${process.pid}` },
    payloadArg,
  );
  return sandbox.runCommand(command);
}

const compute = docker({
  runtime: "node",
  image: { name: "node:22-bookworm", pullPolicy: "ifNotPresent" },
});
const sandbox = await compute.sandbox.create({ runtime: "node" });

try {
  const first = await runSeedInSandbox(sandbox, "pwd");
  if (first.exitCode !== 0) {
    throw new Error(`docker seed first run failed: ${first.stderr || "unknown"}`);
  }

  const firstResult = parseSeedInvocationOutput(first.stdout);
  if (!firstResult || typeof firstResult !== "object") {
    throw new Error("docker seed first response is invalid");
  }
  if (typeof firstResult.token !== "string" || firstResult.token.length === 0) {
    throw new Error("docker seed first response missing token");
  }

  const payload = JSON.stringify({ command: "node", args: ["-v"] });
  const second = await runSeedInSandbox(sandbox, payload);
  if (second.exitCode !== 0) {
    throw new Error(`docker seed second run failed: ${second.stderr || "unknown"}`);
  }

  const secondResult = parseSeedInvocationOutput(second.stdout);
  if (secondResult.token !== firstResult.token) {
    throw new Error("docker seed expected stable token across repeated calls");
  }
  if (!secondResult.daemon || secondResult.daemon.reused !== true) {
    throw new Error("docker seed expected daemon.reused === true on second run");
  }
  if (!secondResult.command || secondResult.command.exitCode !== 0) {
    throw new Error("docker seed expected successful second command execution");
  }
  if (!/v\d+\.\d+\.\d+/.test(String(secondResult.command.stdout || ""))) {
    throw new Error("docker seed expected node -v output on second command");
  }

  process.stdout.write("ok\n");
} finally {
  await sandbox.destroy();
}
