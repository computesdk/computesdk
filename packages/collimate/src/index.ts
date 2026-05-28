/**
 * @computesdk/collimate — ComputeSDK provider for Collimate sandboxes.
 *
 * Usage:
 *   import { collimate } from "@computesdk/collimate";
 *   import { compute } from "computesdk";
 *
 *   compute.setConfig({
 *     provider: collimate({ apiKey: "col_live_...", templateId: "python" }),
 *   });
 *
 *   const sandbox = await compute.sandbox.create();
 *   const result = await sandbox.runCommand("echo hello");
 *   await sandbox.destroy();
 */

import { defineProvider } from "@computesdk/provider";
import type { RunCommandOptions, CommandResult, SandboxInfo, FileEntry } from "computesdk";
import {
  CollimateClient,
  CollimateError,
  type CreateSessionResponse,
  type ExecRequest,
  type SessionInfo,
} from "./client.js";

export interface CollimateConfig {
  /** Collimate API server URL. Default: "https://api.collimate.ai" */
  serverUrl?: string;
  /** API key. Falls back to COLLIMATE_API_KEY env var. */
  apiKey?: string;
  /** Default template ID for sandbox creation. */
  templateId?: string;
  /** Default execution timeout in seconds. Default: 900 */
  timeout?: number;
}

export interface CollimateSandbox {
  sessionId: string;
  templateId: string;
  client: CollimateClient;
  serverUrl: string;
  createdAt: Date;
  createTimeMs: number;
  timeoutMs: number;
}

function resolveConfig(config: CollimateConfig): {
  serverUrl: string;
  apiKey: string;
} {
  const serverUrl = config.serverUrl || "https://api.collimate.ai";
  const apiKey =
    config.apiKey ||
    (typeof process !== "undefined" ? process.env?.COLLIMATE_API_KEY : undefined);

  if (!apiKey) {
    throw new Error(
      "Collimate API key is required. Set `apiKey` in config or the " +
        "COLLIMATE_API_KEY environment variable.\n" +
        "Get your key at https://collimate.ai",
    );
  }

  return { serverUrl, apiKey };
}

function makeClient(config: CollimateConfig): { client: CollimateClient; serverUrl: string } {
  const { serverUrl, apiKey } = resolveConfig(config);
  return { client: new CollimateClient({ serverUrl, apiKey }), serverUrl };
}

function toSandbox(
  client: CollimateClient,
  serverUrl: string,
  session: CreateSessionResponse,
  timeoutMs: number,
): CollimateSandbox {
  return {
    sessionId: session.session_id,
    templateId: session.template_id,
    client,
    serverUrl,
    createdAt: new Date(),
    createTimeMs: session.create_time_ms,
    timeoutMs,
  };
}

function toSandboxFromInfo(
  client: CollimateClient,
  serverUrl: string,
  info: SessionInfo,
  timeoutMs: number,
): CollimateSandbox {
  return {
    sessionId: info.session_id,
    templateId: info.template_id,
    client,
    serverUrl,
    createdAt: new Date(Date.now() - info.age_secs * 1000),
    createTimeMs: 0,
    timeoutMs,
  };
}

function escapeShellArg(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

function buildCommand(
  command: string,
  options?: { cwd?: string; env?: Record<string, string> },
): string {
  let cmd = command;

  if (options?.cwd) {
    cmd = `cd ${escapeShellArg(options.cwd)} && ${cmd}`;
  }

  if (options?.env) {
    const prefix = Object.entries(options.env)
      .map(([k, v]) => `${k}=${escapeShellArg(v)}`)
      .join(" ");
    cmd = `${prefix} ${cmd}`;
  }

  return cmd;
}

export const collimate = defineProvider<CollimateSandbox, CollimateConfig>({
  name: "collimate",
  methods: {
    sandbox: {
      async create(config, options) {
        const { client, serverUrl } = makeClient(config);
        const templateId =
          (options as { templateId?: string } | undefined)?.templateId ||
          config.templateId;

        if (!templateId) {
          throw new Error(
            "templateId is required. Pass it in create options or set it " +
              "in the provider config.",
          );
        }

        const timeoutMs = (config.timeout ?? 900) * 1000;
        const session = await client.createSession(templateId);
        return {
          sandbox: toSandbox(client, serverUrl, session, timeoutMs),
          sandboxId: session.session_id,
        };
      },

      async getById(config, sandboxId) {
        const { client, serverUrl } = makeClient(config);
        const info = await client.getSession(sandboxId);
        if (!info) return null;
        const timeoutMs = (config.timeout ?? 900) * 1000;
        return {
          sandbox: toSandboxFromInfo(client, serverUrl, info, timeoutMs),
          sandboxId: info.session_id,
        };
      },

      async list(config) {
        const { client, serverUrl } = makeClient(config);
        const sessions = await client.listSessions();
        const timeoutMs = (config.timeout ?? 900) * 1000;
        return sessions.map((info) => ({
          sandbox: toSandboxFromInfo(client, serverUrl, info, timeoutMs),
          sandboxId: info.session_id,
        }));
      },

      async destroy(config, sandboxId) {
        const { client } = makeClient(config);
        await client.deleteSession(sandboxId, true);
      },

      async runCommand(sandbox, command, options?: RunCommandOptions): Promise<CommandResult> {
        const fullCmd = buildCommand(command, options as {
          cwd?: string;
          env?: Record<string, string>;
        });

        const timeoutSecs = options?.timeout
          ? Math.ceil(options.timeout / 1000)
          : undefined;

        const body: ExecRequest = {
          commands: [["bash", "-lc", fullCmd]],
          ...(timeoutSecs !== undefined && { timeout_seconds: timeoutSecs }),
        };

        const resp = await sandbox.client.execSession(
          sandbox.sessionId,
          body,
        );

        return {
          stdout: resp.stdout,
          stderr: resp.stderr,
          exitCode: resp.exit_code,
          durationMs: resp.exec_time_ms,
        };
      },

      async getInfo(sandbox): Promise<SandboxInfo> {
        const info = await sandbox.client.getSession(sandbox.sessionId);
        if (!info) {
          throw new CollimateError(
            "Session not found",
            404,
          );
        }
        return {
          id: info.session_id,
          provider: "collimate",
          runtime: (sandbox.templateId.includes("node") ? "node" : "python") as "node" | "python",
          status: "running" as const,
          createdAt: sandbox.createdAt,
          timeout: sandbox.timeoutMs,
          metadata: {
            templateId: info.template_id,
            ageSecs: info.age_secs,
            idleSecs: info.idle_secs,
            execCount: info.exec_count,
          },
        };
      },

      async getUrl(sandbox, options: { port: number; protocol?: string }) {
        const protocol = options.protocol || "https";
        return `${protocol}://${new URL(sandbox.serverUrl).host}/v1/sessions/${sandbox.sessionId}`;
      },

      getInstance(sandbox) {
        return sandbox;
      },

      filesystem: {
        async writeFile(sandbox, path, content, _runCommand) {
          const resp = await sandbox.client.execSession(sandbox.sessionId, {
            files: [{ path, content }],
          });
          if (resp.exit_code !== 0) {
            throw new Error(`writeFile failed: ${resp.stderr}`);
          }
        },

        async readFile(sandbox, path, _runCommand) {
          const resp = await sandbox.client.execSession(sandbox.sessionId, {
            commands: [["cat", path]],
          });
          if (resp.exit_code !== 0) {
            throw new Error(`readFile failed: ${resp.stderr}`);
          }
          return resp.stdout;
        },

        async mkdir(sandbox, path, _runCommand) {
          const resp = await sandbox.client.execSession(sandbox.sessionId, {
            commands: [["mkdir", "-p", path]],
          });
          if (resp.exit_code !== 0) {
            throw new Error(`mkdir failed: ${resp.stderr}`);
          }
        },

        async readdir(sandbox, path, _runCommand): Promise<FileEntry[]> {
          const resp = await sandbox.client.execSession(sandbox.sessionId, {
            commands: [["ls", "-1aF", path]],
          });
          if (resp.exit_code !== 0) {
            throw new Error(`readdir failed: ${resp.stderr}`);
          }
          return resp.stdout
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l && l !== "./" && l !== "../")
            .map((entry): FileEntry => {
              const isDir = entry.endsWith("/");
              const name = isDir ? entry.slice(0, -1) : entry.replace(/[*@|=]$/, "");
              return { name, type: isDir ? "directory" : "file" };
            });
        },

        async exists(sandbox, path, _runCommand) {
          const resp = await sandbox.client.execSession(sandbox.sessionId, {
            commands: [["test", "-e", "--", path]],
          });
          return resp.exit_code === 0;
        },

        async remove(sandbox, path, _runCommand) {
          const resp = await sandbox.client.execSession(sandbox.sessionId, {
            commands: [["rm", "-rf", path]],
          });
          if (resp.exit_code !== 0) {
            throw new Error(`remove failed: ${resp.stderr}`);
          }
        },
      },
    },
  },
});

export { CollimateClient, CollimateError } from "./client.js";
export type {
  CollimateClientConfig,
  CreateSessionResponse,
  ExecRequest,
  ExecResponse,
  SessionInfo,
  FileSpec,
} from "./client.js";
