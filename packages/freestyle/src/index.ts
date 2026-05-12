import { Freestyle, VmSpec, type Vm } from "freestyle-sandboxes";
import { VmNodeJs } from "@freestyle-sh/with-nodejs";
import { VmPython } from "@freestyle-sh/with-python";
import { defineProvider, escapeShellArg } from "@computesdk/provider";

export type { Freestyle as FreestyleSandbox } from "freestyle-sandboxes";

export interface FreestyleConfig {
  apiKey?: string;
  /** Default runtime hint (e.g. 'node', 'python') */
  runtime?: string;
  timeout?: number;
}

interface FreestyleSandboxHandle {
  client: Freestyle;
  config: Required<FreestyleConfig>;
  vm: Vm & { js: any; python: any };
  vmId: string;
  sandboxId: string;
}

const RUNTIME_SPEC = new VmSpec({ with: { js: new VmNodeJs(), python: new VmPython() } });
const snapshotCache = new Map<string, Promise<void>>();

async function ensureSnapshot(client: Freestyle, apiKey: string): Promise<void> {
  if (!snapshotCache.has(apiKey)) {
    const promise = client.vms.snapshots
      .ensure({ spec: RUNTIME_SPEC })
      .then(() => {})
      .catch((err) => { snapshotCache.delete(apiKey); throw err; });
    snapshotCache.set(apiKey, promise);
  }
  return snapshotCache.get(apiKey)!;
}

function getApiKey(config: FreestyleConfig): string {
  const key = config.apiKey || (typeof process !== "undefined" && process.env?.FREESTYLE_API_KEY) || "";
  if (!key) {
    throw new Error(
      "Missing Freestyle API key. Provide 'apiKey' in config or set FREESTYLE_API_KEY " +
        "environment variable. Get your API key from https://dash.freestyle.sh"
    );
  }
  return key;
}

function resolveConfig(config: FreestyleConfig): Required<FreestyleConfig> {
  return { apiKey: getApiKey(config), runtime: config.runtime ?? "node", timeout: config.timeout ?? 30_000 };
}

export const freestyle = defineProvider<FreestyleSandboxHandle, FreestyleConfig>({
  name: "freestyle",
  methods: {
    sandbox: {
      create: async (config, _options) => {
        const resolved = resolveConfig(config);
        const client = new Freestyle({ apiKey: resolved.apiKey });
        await ensureSnapshot(client, resolved.apiKey);
        const { vmId, vm } = await client.vms.create({ spec: RUNTIME_SPEC });
        const sandboxId = `freestyle-vm-${vmId}`;
        const handle: FreestyleSandboxHandle = { client, config: resolved, vm: vm as any, vmId, sandboxId };
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
          const handle: FreestyleSandboxHandle = { client, config: resolved, vm: vm as any, vmId, sandboxId };
          return { sandbox: handle, sandboxId };
        } catch { return null; }
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
            const handle: FreestyleSandboxHandle = { client, config: resolved, vm: vm as any, vmId, sandboxId };
            return { sandbox: handle, sandboxId };
          });
        } catch { return []; }
      },

      destroy: async (config, sandboxId) => {
        const resolved = resolveConfig(config);
        const client = new Freestyle({ apiKey: resolved.apiKey });
        if (!sandboxId.startsWith("freestyle-vm-")) {
          throw new Error(`Invalid sandbox ID: expected "freestyle-vm-" prefix, got "${sandboxId}"`);
        }
        const vmId = sandboxId.slice("freestyle-vm-".length);
        try { await client.vms.delete({ vmId }); } catch { /* VM may already be gone */ }
      },

      runCommand: async (handle, command, options) => {
        const startTime = Date.now();
        let fullCommand = command;
        if (options?.env && Object.keys(options.env).length > 0) {
          const envPrefix = Object.entries(options.env).map(([k, v]) => `${k}="${escapeShellArg(v)}"`).join(" ");
          fullCommand = `${envPrefix} ${fullCommand}`;
        }
        if (options?.cwd) fullCommand = `cd "${escapeShellArg(options.cwd)}" && ${fullCommand}`;
        if (options?.background) fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
        try {
          const execResult = await handle.vm.exec({ command: fullCommand, timeoutMs: handle.config.timeout });
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
          return { stdout: "", stderr: err instanceof Error ? err.message : String(err), exitCode: 127, durationMs: Date.now() - startTime };
        }
      },

      getInfo: async (handle) => ({
        id: handle.sandboxId,
        provider: "freestyle",
        status: "running",
        createdAt: new Date(),
        timeout: handle.config.timeout,
        metadata: { freestyleVmId: handle.vmId, runtime: handle.config.runtime },
      }),

      getUrl: async (handle, options) => {
        const protocol = options.protocol ?? "https";
        return `${protocol}://${handle.vmId}.vm.freestyle.sh:${options.port}`;
      },

      getInstance: (handle) => handle,

      filesystem: {
        readFile: async (handle, path) => handle.vm.fs.readTextFile(path),
        writeFile: async (handle, path, content) => { await handle.vm.fs.writeTextFile(path, content); },
        mkdir: async (handle, path) => { await handle.vm.fs.mkdir(path, true); },
        readdir: async (handle, path, runCommand) => {
          const result = await runCommand(handle, `ls -la "${escapeShellArg(path)}" 2>/dev/null || echo ""`);
          if (result.exitCode !== 0) return [];
          return result.stdout
            .split("\n")
            .filter((line) => line.trim() && !line.startsWith("total"))
            .map((line) => {
              const parts = line.trim().split(/\s+/);
              const permissions = parts[0] ?? "";
              const name = parts.slice(8).join(' ') || parts[parts.length - 1] || '';
              const size = parseInt(parts[4] ?? "0", 10);
              return { name, type: (permissions.startsWith("d") ? "directory" : "file") as "directory" | "file", size: isNaN(size) ? 0 : size, modified: new Date() };
            })
            .filter((e) => e.name !== "." && e.name !== "..");
        },
        exists: async (handle, path) => handle.vm.fs.exists(path),
        remove: async (handle, path) => { await handle.vm.fs.remove(path, true); },
      },
    },
  },
});
