import { Freestyle, VmSpec, type Vm } from "freestyle-sandboxes";
import { VmNodeJs } from "@freestyle-sh/with-nodejs";
import { VmPython } from "@freestyle-sh/with-python";
import { defineProvider, escapeShellArg } from "@computesdk/provider";
import type { Runtime } from "@computesdk/provider";

export type { Freestyle as FreestyleSandbox } from "freestyle-sandboxes";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Freestyle provider configuration for ComputeSDK.
 * Runs code in full Linux microVMs via the Freestyle VM API.
 */
export interface FreestyleConfig {
  /**
   * Freestyle API key.
   * Falls back to the FREESTYLE_API_KEY environment variable if not provided.
   */
  apiKey?: string;

  /**
   * Default runtime hint used to auto-detect the language when not specified.
   * @default "node"
   */
  runtime?: Runtime;

  /**
   * Timeout in milliseconds for shell commands (`runCommand`).
   * Note: `runCode` does not support timeouts in the Freestyle SDK.
   * @default 30000
   */
  timeout?: number;
}

// ─── Internal sandbox handle ──────────────────────────────────────────────────

interface FreestyleSandboxHandle {
  client: Freestyle;
  config: Required<FreestyleConfig>;
  vm: Vm & { js: any; python: any };
  vmId: string;
  sandboxId: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RUNTIME_SPEC = new VmSpec({
  with: {
    js: new VmNodeJs(),
    python: new VmPython(),
  },
});

// Cache snapshot ensures per API key so we only build once
const snapshotCache = new Map<string, Promise<void>>();

async function ensureSnapshot(client: Freestyle, apiKey: string): Promise<void> {
  if (!snapshotCache.has(apiKey)) {
    const promise = client.vms.snapshots
      .ensure({ spec: RUNTIME_SPEC })
      .then(() => {})
      .catch((err) => {
        snapshotCache.delete(apiKey);
        throw err;
      });
    snapshotCache.set(apiKey, promise);
  }
  return snapshotCache.get(apiKey)!;
}

function getApiKey(config: FreestyleConfig): string {
  const key =
    config.apiKey ||
    (typeof process !== "undefined" && process.env?.FREESTYLE_API_KEY) ||
    "";

  if (!key) {
    throw new Error(
      "Missing Freestyle API key. Provide 'apiKey' in config or set FREESTYLE_API_KEY " +
        "environment variable. Get your API key from https://dash.freestyle.sh"
    );
  }

  return key;
}

function resolveConfig(config: FreestyleConfig): Required<FreestyleConfig> {
  return {
    apiKey: getApiKey(config),
    runtime: config.runtime ?? "node",
    timeout: config.timeout ?? 30_000,
  };
}

/**
 * Detect whether a piece of code looks like Python.
 * Mirrors the same heuristic used by the e2b provider.
 */
function detectRuntime(code: string, hint?: Runtime, fallback?: Runtime): Runtime {
  if (hint) return hint;
  const isPython =
    code.includes("print(") ||
    code.includes("import ") ||
    code.includes("def ") ||
    code.includes("sys.") ||
    code.includes("json.") ||
    code.includes("__") ||
    code.includes('f"') ||
    code.includes("f'") ||
    code.includes("raise ");
  return isPython ? "python" : (fallback ?? "node");
}

// ─── Provider ─────────────────────────────────────────────────────────────────

/**
 * Freestyle provider for ComputeSDK.
 * Creates full Linux microVMs for isolated code execution with Node.js and Python support.
 *
 * @example
 * import { freestyle } from "@computesdk/freestyle";
 *
 * const provider = freestyle({ apiKey: process.env.FREESTYLE_API_KEY });
 * const sandbox = await provider.sandbox.create();
 * const result = await sandbox.runCode('console.log("Hello!")');
 * console.log(result.output); // "Hello!"
 * await sandbox.destroy();
 */
export const freestyle = defineProvider<FreestyleSandboxHandle, FreestyleConfig>({
  name: "freestyle",

  methods: {
    sandbox: {
      // ── Collection operations ─────────────────────────────────────────────

      create: async (config, _options) => {
        const resolved = resolveConfig(config);
        const client = new Freestyle({ apiKey: resolved.apiKey });

        await ensureSnapshot(client, resolved.apiKey);

        const { vmId, vm } = await client.vms.create({ spec: RUNTIME_SPEC });
        const sandboxId = `freestyle-vm-${vmId}`;

        const handle: FreestyleSandboxHandle = {
          client,
          config: resolved,
          vm: vm as any,
          vmId,
          sandboxId,
        };
        return { sandbox: handle, sandboxId };
      },

      getById: async (config, sandboxId) => {
        const resolved = resolveConfig(config);
        const client = new Freestyle({ apiKey: resolved.apiKey });
        if (!sandboxId.startsWith("freestyle-vm-")) {
          throw new Error(`Invalid sandbox ID: expected "freestyle-vm-" prefix, got "${sandboxId}"`);
        }
        const vmId = sandboxId.slice("freestyle-vm-".length);

        try {
          const vm = client.vms.ref({ vmId, spec: RUNTIME_SPEC });
          await vm.getInfo();
          const handle: FreestyleSandboxHandle = {
            client,
            config: resolved,
            vm: vm as any,
            vmId,
            sandboxId,
          };
          return { sandbox: handle, sandboxId };
        } catch {
          return null;
        }
      },

      list: async (config) => {
        const resolved = resolveConfig(config);
        const client = new Freestyle({ apiKey: resolved.apiKey });

        try {
          const result = await client.vms.list();
          const vms = (result as any).vms ?? (result as any) ?? [];
          const vmList = Array.isArray(vms) ? vms : [];
          return vmList.map((entry: any) => {
            const vmId = entry.vmId ?? entry.id;
            const sandboxId = `freestyle-vm-${vmId}`;
            const vm = client.vms.ref({ vmId, spec: RUNTIME_SPEC });
            const handle: FreestyleSandboxHandle = {
              client,
              config: resolved,
              vm: vm as any,
              vmId,
              sandboxId,
            };
            return { sandbox: handle, sandboxId };
          });
        } catch {
          return [];
        }
      },

      destroy: async (config, sandboxId) => {
        const resolved = resolveConfig(config);
        const client = new Freestyle({ apiKey: resolved.apiKey });
        if (!sandboxId.startsWith("freestyle-vm-")) {
          throw new Error(`Invalid sandbox ID: expected "freestyle-vm-" prefix, got "${sandboxId}"`);
        }
        const vmId = sandboxId.slice("freestyle-vm-".length);
        try {
          await client.vms.delete({ vmId });
        } catch {
          // VM may already be gone
        }
      },

      // ── Instance operations ───────────────────────────────────────────────

      runCode: async (handle, code, runtime) => {
        const effectiveRuntime = detectRuntime(code, runtime, handle.config.runtime);

        try {
          const res =
            effectiveRuntime === "python"
              ? await handle.vm.python.runCode({ code })
              : await handle.vm.js.runCode({ code });

          const stdout = (res as any).stdout ?? "";
          const stderr = (res as any).stderr ?? "";
          const statusCode = (res as any).statusCode ?? 0;

          if (
            statusCode !== 0 &&
            stderr &&
            (stderr.includes("SyntaxError") ||
              stderr.includes("invalid syntax") ||
              stderr.includes("Unexpected token") ||
              stderr.includes("Unexpected identifier"))
          ) {
            throw new Error(`Syntax error: ${stderr.trim()}`);
          }

          const output = stderr
            ? `${stdout}${stdout && stderr ? "\n" : ""}${stderr}`
            : stdout;

          return { output, exitCode: statusCode, language: effectiveRuntime };
        } catch (err) {
          if (err instanceof Error && err.message.includes("Syntax error"))
            throw err;
          return {
            output: err instanceof Error ? err.message : String(err),
            exitCode: 1,
            language: effectiveRuntime,
          };
        }
      },

      runCommand: async (handle, command, options) => {
        const startTime = Date.now();
        let fullCommand = command;

        if (options?.env && Object.keys(options.env).length > 0) {
          const envPrefix = Object.entries(options.env)
            .map(([k, v]) => `${k}="${escapeShellArg(v)}"`)
            .join(" ");
          fullCommand = `${envPrefix} ${fullCommand}`;
        }

        if (options?.cwd) {
          fullCommand = `cd "${escapeShellArg(options.cwd)}" && ${fullCommand}`;
        }

        if (options?.background) {
          fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
        }

        try {
          const execResult = await handle.vm.exec({
            command: fullCommand,
            timeoutMs: handle.config.timeout,
          });
          return {
            stdout: (execResult as any).stdout ?? "",
            stderr: (execResult as any).stderr ?? "",
            exitCode: (execResult as any).statusCode ?? 0,
            durationMs: Date.now() - startTime,
          };
        } catch (err) {
          const result = (err as any)?.result;
          if (result) {
            return {
              stdout: result.stdout ?? "",
              stderr: result.stderr ?? "",
              exitCode: result.statusCode ?? result.exitCode ?? 1,
              durationMs: Date.now() - startTime,
            };
          }
          return {
            stdout: "",
            stderr: err instanceof Error ? err.message : String(err),
            exitCode: 127,
            durationMs: Date.now() - startTime,
          };
        }
      },

      getInfo: async (handle) => ({
        id: handle.sandboxId,
        provider: "freestyle",
        runtime: handle.config.runtime,
        status: "running",
        createdAt: new Date(),
        timeout: handle.config.timeout,
        metadata: { freestyleVmId: handle.vmId },
      }),

      getUrl: async (handle, options) => {
        const protocol = options.protocol ?? "https";
        return `${protocol}://${handle.vmId}.vm.freestyle.sh:${options.port}`;
      },

      getInstance: (handle) => handle,

      // ── Filesystem (native Freestyle fs API) ──────────────────────────────

      filesystem: {
        readFile: async (handle, path) => {
          return await handle.vm.fs.readTextFile(path);
        },

        writeFile: async (handle, path, content) => {
          await handle.vm.fs.writeTextFile(path, content);
        },

        mkdir: async (handle, path) => {
          await handle.vm.fs.mkdir(path, true);
        },

        readdir: async (handle, path, runCommand) => {
          // Use shell-based readdir for richer metadata (size, type, modified)
          const result = await runCommand(
            handle,
            `ls -la "${escapeShellArg(path)}" 2>/dev/null || echo ""`
          );
          if (result.exitCode !== 0) return [];

          return result.stdout
            .split("\n")
            .filter((line) => line.trim() && !line.startsWith("total"))
            .map((line) => {
              const parts = line.trim().split(/\s+/);
              const permissions = parts[0] ?? "";
              const name = parts.slice(8).join(' ') || parts[parts.length - 1] || '';
              const size = parseInt(parts[4] ?? "0", 10);
              return {
                name,
                type: (permissions.startsWith("d")
                  ? "directory"
                  : "file") as "directory" | "file",
                size: isNaN(size) ? 0 : size,
                modified: new Date(),
              };
            })
            .filter((e) => e.name !== "." && e.name !== "..");
        },

        exists: async (handle, path) => {
          return await handle.vm.fs.exists(path);
        },

        remove: async (handle, path) => {
          await handle.vm.fs.remove(path, true);
        },
      },
    },
  },
});
