import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Source of the on-box egress router shim (see src/runtime/egress-shim.ts),
 * loaded from the compiled runtime directory. Callers write this verbatim
 * into a sandbox and execute it with the sandbox's node binary:
 * `node egress-shim.js <config.json>`.
 */
export function egressShimScript(): string {
  const runtimePath = path.join(__dirname, "runtime", "egress-shim.js");
  return fs.readFileSync(runtimePath, "utf8").trim();
}
