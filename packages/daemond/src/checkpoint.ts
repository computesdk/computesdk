import * as fs from "node:fs";
import * as path from "node:path";
import { daemonSeedScriptCommand } from "./seed-script.js";
import type {
  SeedCommandOptions,
  SeedModuleExecInput,
  SeedModuleInstallInput,
  SeedScriptConfig,
} from "./types.js";

/**
 * Host-side helpers for the checkpoint module: a pure-stdlib capture/restore
 * engine shipped inside `dist/runtime/checkpoint-module.js` and pushed to the
 * in-sandbox daemon via `module.install` on first use — no new seeding
 * machinery. Ops then run as ordinary daemon jobs (`module.exec`), so detach,
 * wait/status/kill, and SSE stdout streaming all apply.
 */

export const CHECKPOINT_MODULE_NAME = "checkpoint";

export function checkpointModuleSource(): string {
  const modulePath = path.join(__dirname, "runtime", "checkpoint-module.js");
  return fs.readFileSync(modulePath, "utf8");
}

/** Payload that installs (or refreshes) the checkpoint module on the daemon. */
export function checkpointInstallInput(source?: string): SeedModuleInstallInput {
  return {
    installModule: {
      name: CHECKPOINT_MODULE_NAME,
      sourceB64: Buffer.from(source ?? checkpointModuleSource(), "utf8").toString("base64"),
    },
  };
}

export type CheckpointOp = "scan" | "capture" | "restore" | "diff";

/**
 * Payload that runs one checkpoint op. `args` is serialized as base64 JSON on
 * the module's argv (`b64:<...>`), matching the launcher's payload convention.
 *
 * Op-arg contract notes:
 * - `restore` requires `destDir` (writes are confined under it) unless
 *   `writeAbsolute: true` is passed to write manifest paths verbatim.
 * - `resultPath` on any op writes the full result JSON to that file and emits
 *   a slim `{op, resultPath}` line instead — use it for big manifests when
 *   running detached, since job stdout is tail-bounded.
 * - `restore` exits non-zero when any file failed (see `failures[]`).
 */
export function checkpointOpInput(
  op: CheckpointOp,
  args?: Record<string, unknown>,
  opts?: { detach?: boolean; timeoutMs?: number; cwd?: string; env?: Record<string, string>; requestId?: string },
): SeedModuleExecInput {
  const payload = `b64:${Buffer.from(JSON.stringify(args ?? {}), "utf8").toString("base64")}`;
  return {
    moduleExec: {
      name: CHECKPOINT_MODULE_NAME,
      argv: [op, payload],
      detach: opts?.detach ?? true,
      timeoutMs: opts?.timeoutMs,
      cwd: opts?.cwd,
      env: opts?.env,
    },
    requestId: opts?.requestId,
  };
}

/**
 * Shell command (same `node -e` launcher shape as daemonSeedScriptCommand)
 * that installs the checkpoint module on the workspace's daemon.
 */
export function daemonCheckpointInstallCommand(
  config?: SeedScriptConfig,
  source?: string,
  options?: SeedCommandOptions,
): string {
  return daemonSeedScriptCommand(config, checkpointInstallInput(source), options);
}

/**
 * Shell command that invokes a checkpoint op as a daemon module job. Defaults
 * to `detach: true` — capture/restore run long; poll with `{ status: jobId }`
 * / `{ wait: jobId }` or stream stdout over the daemon's SSE endpoint.
 */
export function daemonCheckpointCommand(
  config: SeedScriptConfig | undefined,
  op: CheckpointOp,
  args?: Record<string, unknown>,
  opts?: { detach?: boolean; timeoutMs?: number; cwd?: string; env?: Record<string, string>; requestId?: string },
  options?: SeedCommandOptions,
): string {
  return daemonSeedScriptCommand(config, checkpointOpInput(op, args, opts), options);
}

/**
 * Pull the `{type:"result", ...}` line out of a checkpoint job's stdout (the
 * `stdout`/`combined` field of its SeedCommandResult).
 */
export function parseCheckpointResult<T = Record<string, unknown>>(stdout: string): T {
  const lines = stdout
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]) as { type?: string };
      if (parsed.type === "result") return parsed as T;
      if (parsed.type === "error") {
        throw new Error(`checkpoint: ${String((parsed as { message?: string }).message ?? "op failed")}`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("checkpoint:")) throw err;
    }
  }
  throw new Error(`checkpoint: no result line in module output (tail: ${lines.slice(-3).join(" | ")})`);
}
