/**
 * Deno Sandbox Provider - Factory-based Implementation
 *
 * What this provider DOES support:
 * - Sandbox lifecycle: create/connect/list/destroy
 * - runCommand(): runs bash commands via Sandbox.spawn("bash", ["-lc", ...]) and captures stdout/stderr
 * - runCode("node" | "javascript" | "typescript"): executes JavaScript inside the Deno Deploy sandbox
 *   - Captures console.log/warn/error into output so you can see prints
 * - runCode("python"): executes Python via Pyodide (WASM) inside the sandbox JS runtime
 *   - Captures Python stdout/stderr
 * - filesystem: uses @deno/sandbox native FS APIs (read/write/mkdir/readdir/exists/remove)
 *
 * What this provider DOES NOT support:
 * - A real Node.js binary/runtime. "node" here means "JS executed inside Deno sandbox".
 *   Node built-ins may differ (and some Node APIs may not exist).
 * - Python packages via pip/apt. Python runs via Pyodide; packages must come from Pyodide ecosystem.
 *
 * Token:
 * - Uses a Deno Deploy / Deno Sandbox token. Default env var: DENO_DEPLOY_TOKEN
 */

import { Sandbox as DenoSandbox } from "@deno/sandbox";
import { createProvider } from "computesdk";

import type {
  CodeResult,
  CommandResult,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
  Runtime,
  SandboxInfo,
} from "computesdk";

/**
 * Deno Sandbox provider configuration
 */
export interface DenoSandboxConfig {
  /** Deno Deploy token (EA org access token). Falls back to process.env.DENO_DEPLOY_TOKEN */
  token?: string;

  /** Optional org slug/name (depends on your token/setup) */
  org?: string;

  /** Optional endpoint override (advanced) */
  endpoint?: string | ((region: string) => string);

  /** Optional region override (advanced) */
  region?: unknown;

  /** Enable @deno/sandbox debug logging */
  debug?: boolean;

  /** Default runtime if caller doesn't specify */
  runtime?: Runtime;

  /** Sandbox lifetime */
  lifetime?: "session" | `${number}s` | `${number}m`;

  /** Sandbox memory in MiB */
  memoryMb?: number;

  /** Default labels for create/list */
  labels?: Record<string, string>;

  /**
   * Pyodide indexURL (where Pyodide loads its packages from).
   * This must be a directory URL that contains pyodide.js + packages.
   */
  pyodideIndexURL?: string;
}

/** Factory-required runCommand signature for filesystem helper methods. */
type RunCommandFn<TSandbox> = (
  sandbox: TSandbox,
  command: string,
  args?: string[]
) => Promise<CommandResult>;

function resolveToken(config: DenoSandboxConfig): string {
  const envToken =
    typeof process !== "undefined" ? process.env?.DENO_DEPLOY_TOKEN : undefined;

  const token = config.token || envToken || "";
  if (!token) {
    throw new Error(
      "Missing Deno Deploy token. Provide `token` in config or set DENO_DEPLOY_TOKEN."
    );
  }
  return token;
}

/** Basic shell quoting for args. */
function quoteArg(arg: string): string {
  if (/[\s"'$`\\]/.test(arg)) {
    return `"${arg.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return arg;
}

function decodeBytes(bytes?: Uint8Array): string {
  if (!bytes || bytes.length === 0) return "";
  return new TextDecoder().decode(bytes);
}

/** Run through bash so pipes/redirects/etc work consistently. */
function bashCommand(fullCommand: string): [string, string[]] {
  return ["bash", ["-lc", fullCommand]];
}

/**
 * Wrap JS so we capture console output AND return a JSON payload.
 * Output is JSON string: { logs: string[], result: unknown, error?: string }
 */
function wrapJsToCaptureLogs(userCode: string): string {
  return `
(() => {
  const __logs = [];
  const __orig = { log: console.log, warn: console.warn, error: console.error };

  const __fmt = (args) => args.map(a => {
    if (typeof a === "string") return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(" ");

  console.log = (...args) => __logs.push(__fmt(args));
  console.warn = (...args) => __logs.push("warn: " + __fmt(args));
  console.error = (...args) => __logs.push("error: " + __fmt(args));

  try {
    const __result = (function () {
      ${userCode}
    })();
    return JSON.stringify({ logs: __logs, result: __result }, null, 2);
  } catch (e) {
    return JSON.stringify({
      logs: __logs.concat(["error: " + (e?.stack || e?.message || String(e))]),
      result: null,
      error: String(e?.message || e)
    }, null, 2);
  } finally {
    console.log = __orig.log;
    console.warn = __orig.warn;
    console.error = __orig.error;
  }
})()
`.trim();
}

/**
 * Pyodide bootstrap (inside sandbox JS runtime).
 * Caches the initialized Pyodide instance on globalThis.__computesdkPyodideReady
 * so subsequent python runs are fast.
 */
function pyodideInitSnippet(indexURL: string): string {
  const normalized = indexURL.endsWith("/") ? indexURL : `${indexURL}/`;
  return `
globalThis.__computesdkPyodideReady ||= (async () => {
  // Pyodide loader comes from npm via Deno's npm compatibility layer in the sandbox JS runtime.
  const pyodideModule = await import("npm:pyodide/pyodide.js");
  const pyodide = await pyodideModule.loadPyodide({ indexURL: ${JSON.stringify(
    normalized
  )} });
  return pyodide;
})();
`.trim();
}

/**
 * Execute Python code via Pyodide, capturing stdout/stderr/traceback.
 * Returns a JSON string from the sandbox: { stdout, stderr, error }
 */
function pyodideRunPythonSnippet(pythonCode: string): string {
  return `
(async () => {
  const pyodide = await globalThis.__computesdkPyodideReady;
  const __code = ${JSON.stringify(pythonCode)};

  // Provide code into the Python environment
  pyodide.globals.set("__code", __code);

  const wrapper = \`
import io, traceback
from contextlib import redirect_stdout, redirect_stderr

_stdout = io.StringIO()
_stderr = io.StringIO()
_err = None

try:
    g = {}
    with redirect_stdout(_stdout), redirect_stderr(_stderr):
        exec(__code, g, g)
except Exception as e:
    _err = "".join(traceback.format_exception(type(e), e, e.__traceback__))

{
  "stdout": _stdout.getvalue(),
  "stderr": _stderr.getvalue(),
  "error": _err
}
\`;

  const out = pyodide.runPython(wrapper);
  return JSON.stringify(out, null, 2);
})()
`.trim();
}

/**
 * Keep a per-sandbox JS REPL so we can:
 * - persist caches between runCode calls
 * - keep Pyodide warm
 */
const replCache = new Map<string, Promise<any>>();

async function getRepl(sandbox: DenoSandbox): Promise<any> {
  const id = sandbox.id;
  const existing = replCache.get(id);
  if (existing) return existing;

  const created = (async () => {
    const repl = await sandbox.repl();
    return repl;
  })();

  replCache.set(id, created);
  return created;
}

async function closeReplIfAny(sandboxId: string): Promise<void> {
  const p = replCache.get(sandboxId);
  if (!p) return;
  replCache.delete(sandboxId);

  try {
    const repl = await p;
    await repl.close?.();
  } catch {
    // best-effort
  }
}

export const denoSandbox = createProvider<DenoSandbox, DenoSandboxConfig>({
  name: "deno-sandbox",
  methods: {
    sandbox: {
      create: async (config: DenoSandboxConfig, options?: CreateSandboxOptions) => {
        const token = resolveToken(config);

        // Reconnect if sandboxId provided
        if (options?.sandboxId) {
          const sandbox = await DenoSandbox.connect({
            id: options.sandboxId,
            token,
            org: config.org,
            endpoint: config.endpoint as any,
            region: config.region as any,
            debug: config.debug ?? false,
          });

          return { sandbox, sandboxId: sandbox.id };
        }

        // Create new sandbox
        const sandbox = await DenoSandbox.create({
          token,
          org: config.org,
          endpoint: config.endpoint as any,
          region: config.region as any,
          debug: config.debug ?? false,

          // these are optional in @deno/sandbox
          env: (options as any)?.envs ?? undefined,
          labels: (options as any)?.labels ?? config.labels ?? undefined,
          lifetime: config.lifetime ?? undefined,
          memoryMb: config.memoryMb ?? undefined,
        } as any);

        return { sandbox, sandboxId: sandbox.id };
      },

      getById: async (config: DenoSandboxConfig, sandboxId: string) => {
        const token = resolveToken(config);

        try {
          const sandbox = await DenoSandbox.connect({
            id: sandboxId,
            token,
            org: config.org,
            endpoint: config.endpoint as any,
            region: config.region as any,
            debug: config.debug ?? false,
          });

          return { sandbox, sandboxId: sandbox.id };
        } catch {
          return null;
        }
      },

      list: async (config: DenoSandboxConfig) => {
        const token = resolveToken(config);

        const out: Array<{ sandbox: any; sandboxId: string }> = [];
        try {
          for await (const meta of DenoSandbox.list({
            token,
            labels: config.labels,
          } as any)) {
            out.push({
              sandbox: meta as any,
              sandboxId: (meta as any).id,
            });
          }
          return out;
        } catch {
          return [];
        }
      },

      destroy: async (config: DenoSandboxConfig, sandboxId: string) => {
        const token = resolveToken(config);

        // Close cached REPL first (best-effort)
        await closeReplIfAny(sandboxId);

        try {
          const sandbox = await DenoSandbox.connect({
            id: sandboxId,
            token,
            org: config.org,
            endpoint: config.endpoint as any,
            region: config.region as any,
            debug: config.debug ?? false,
          });
          await sandbox.kill();
        } catch {
          // ok if already gone
        }
      },

      /**
       * runCode supports:
       * - node/javascript/typescript => JS-in-Deno with captured console output
       * - python => Pyodide inside the sandbox JS runtime
       */
      runCode: async (
        sandbox: DenoSandbox,
        code: string,
        runtime?: Runtime,
        config?: DenoSandboxConfig
      ): Promise<CodeResult> => {
        const effectiveRuntime = runtime ?? config?.runtime ?? "node";

        const repl = await getRepl(sandbox);

        if (effectiveRuntime === "python") {
          const indexURL =
            config?.pyodideIndexURL ?? "https://cdn.jsdelivr.net/pyodide/v0.26.1/full/";

          try {
            // Init Pyodide once
            await repl.eval(pyodideInitSnippet(indexURL));

            // Execute python
            const json = await repl.eval(pyodideRunPythonSnippet(code));

            // Return JSON string as output (includes stdout/stderr/error)
            return {
              output: String(json ?? ""),
              exitCode: 0,
              language: "python",
            };
          } catch (err) {
            return {
              output: err instanceof Error ? err.message : String(err),
              exitCode: 1,
              language: "python",
            };
          }
        }

        // JS path
        try {
          const wrapped = wrapJsToCaptureLogs(code);
          const json = await repl.eval(wrapped);

          return {
            output: String(json ?? ""),
            exitCode: 0,
            language: effectiveRuntime,
          };
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
            exitCode: 1,
            language: effectiveRuntime,
          };
        }
      },

      /**
       * runCommand via spawn("bash", ["-lc", "..."]) and buffered output().
       * This behaves like E2B's "commands.run" style: capture stdout/stderr + exitCode.
       */
      runCommand: async (
        sandbox: DenoSandbox,
        command: string,
        args: string[] = [],
        options?: RunCommandOptions
      ): Promise<CommandResult> => {
        const start = Date.now();

        try {
          const full = [command, ...args.map(quoteArg)].join(" ");
          const [cmd, bashArgs] = bashCommand(full);

          const child = await sandbox.spawn(cmd, {
            args: bashArgs,
            stdout: "piped",
            stderr: "piped",
            cwd: options?.cwd,
            env: (options as any)?.env,
          } as any);

          const res = await (child as any).output?.();
          const stdout = decodeBytes(res?.stdout);
          const stderr = decodeBytes(res?.stderr);
          const exitCode =
            typeof res?.code === "number" ? res.code : res?.success ? 0 : 1;

          return {
            stdout,
            stderr,
            exitCode,
            durationMs: Date.now() - start,
          };
        } catch (err) {
          return {
            stdout: "",
            stderr: err instanceof Error ? err.message : String(err),
            exitCode: 127,
            durationMs: Date.now() - start,
          };
        }
      },

      getInfo: async (sandbox: DenoSandbox): Promise<SandboxInfo> => {
        return {
          id: sandbox.id,
          provider: "deno-sandbox",
          runtime: "node",
          status: "running",
          createdAt: new Date(),
          timeout: 0,
          metadata: { denoSandboxId: sandbox.id },
        };
      },

      /**
       * Expose HTTP port publicly. Returns a public URL.
       */
      getUrl: async (
        sandbox: DenoSandbox,
        options: { port: number; protocol?: string }
      ): Promise<string> => {
        // exposeHttp returns a full URL string; protocol override is intentionally ignored.
        return await sandbox.exposeHttp({ port: options.port });
      },

      /**
       * Filesystem methods must accept (sandbox, path, runCommand) per the factory type.
       * We don't need runCommand here because @deno/sandbox provides native FS APIs,
       * but we accept it to satisfy the interface and keep type-safety.
       */
      filesystem: {
        readFile: async (
          sandbox: DenoSandbox,
          path: string,
          _runCommand: RunCommandFn<DenoSandbox>
        ): Promise<string> => {
          return await sandbox.readTextFile(path);
        },

        writeFile: async (
          sandbox: DenoSandbox,
          path: string,
          content: string,
          _runCommand: RunCommandFn<DenoSandbox>
        ): Promise<void> => {
          await sandbox.writeTextFile(path, content);
        },

        mkdir: async (
          sandbox: DenoSandbox,
          path: string,
          _runCommand: RunCommandFn<DenoSandbox>
        ): Promise<void> => {
          await sandbox.mkdir(path, { recursive: true } as any);
        },

        readdir: async (
          sandbox: DenoSandbox,
          path: string,
          _runCommand: RunCommandFn<DenoSandbox>
        ): Promise<FileEntry[]> => {
          const out: FileEntry[] = [];

          for await (const ent of sandbox.readDir(path)) {
            const fullPath = path.endsWith("/")
              ? `${path}${ent.name}`
              : `${path}/${ent.name}`;

            let size = 0;
            let lastModified = new Date();

            try {
              const info = await sandbox.stat(fullPath);
              size = (info as any).size ?? 0;
              lastModified = (info as any).mtime ? new Date((info as any).mtime) : new Date();
            } catch {
              // ignore stat failures
            }

            out.push({
              name: ent.name,
              path: fullPath,
              isDirectory: ent.isDirectory,
              size,
              lastModified,
            });
          }

          return out;
        },

        exists: async (
          sandbox: DenoSandbox,
          path: string,
          _runCommand: RunCommandFn<DenoSandbox>
        ): Promise<boolean> => {
          try {
            await sandbox.stat(path);
            return true;
          } catch {
            return false;
          }
        },

        remove: async (
          sandbox: DenoSandbox,
          path: string,
          _runCommand: RunCommandFn<DenoSandbox>
        ): Promise<void> => {
          await sandbox.remove(path, { recursive: true } as any);
        },
      },

      getInstance: (sandbox: DenoSandbox): DenoSandbox => sandbox,
    },
  },
});

// Export sandbox type for consumers who want explicit typing
export type { Sandbox as DenoSandbox } from "@deno/sandbox";
