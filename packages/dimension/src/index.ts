/**
 * @computesdk/dimension — ComputeSDK provider for Dimension Runtime.
 *
 * Dimension Runtime is a deterministic execution platform with:
 * - Sub-7ms cold-start (6.6ms median)
 * - Syscall-level hypervisor (seccomp USER_NOTIF, 0 ALLOW)
 * - Bit-exact reproducibility from seed
 * - Structural multi-tenant isolation
 *
 * Configuration:
 * DIMENSION_API_URL — Base URL of Dimension API server (default: https://41quc7j7xb.execute-api.us-east-2.amazonaws.com)
 * DIMENSION_API_KEY — API key for authentication
 */

export interface DimensionConfig {
    apiUrl?: string;
    apiKey?: string;
    timeout?: number;
}

interface SandboxData {
    id: string;
    runtime: string;
    status: string;
    createdAt: string;
    timeout: number;
}

type Runtime = "node" | "python" | "deno" | "bun";

function detectRuntime(code: string): Runtime {
    if (
          code.includes("print(") ||
          code.includes("def ") ||
          code.includes("import ") ||
          (code.includes("class ") && code.includes("self"))
        ) {
          return "python";
    }
    return "node";
}

class DimensionClient {
    private baseUrl: string;
    private apiKey: string;

  constructor(config: DimensionConfig) {
        this.baseUrl = (
                config.apiUrl ||
                process.env.DIMENSION_API_URL ||
                "https://41quc7j7xb.execute-api.us-east-2.amazonaws.com"
              ).replace(/\/$/, "");
        this.apiKey = config.apiKey || process.env.DIMENSION_API_KEY || "";
        if (!this.apiKey) {
                throw new Error(
                          "Dimension API key required. Set DIMENSION_API_KEY environment variable " +
                          "or pass apiKey in config. Get your API key at https://dimension.dev"
                        );
        }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
        const url = `${this.baseUrl}/v1${path}`;
        const response = await fetch(url, {
                method,
                headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${this.apiKey}`,
                },
                body: body ? JSON.stringify(body) : undefined,
        });
        if (!response.ok) {
                const error = await response.json().catch(() => ({ error: response.statusText }));
                throw new Error(`Dimension API error (${response.status}): ${(error as any).error || response.statusText}`);
        }
        return response.json() as Promise<T>;
  }

  async createSandbox(options?: { runtime?: Runtime; timeout?: number; memory?: number }): Promise<DimensionSandbox> {
        const data = await this.request<SandboxData>("POST", "/sandboxes", {
                runtime: options?.runtime || "node",
                timeout: options?.timeout,
                memory: options?.memory,
        });
        return new DimensionSandbox(this, data);
  }

  async getSandboxById(id: string): Promise<DimensionSandbox | null> {
        try {
                const data = await this.request<SandboxData>("GET", `/sandboxes/${id}`);
                return new DimensionSandbox(this, data);
        } catch {
                return null;
        }
  }

  async listSandboxes(): Promise<DimensionSandbox[]> {
        const data = await this.request<{ sandboxes: SandboxData[] }>("GET", "/sandboxes");
        return data.sandboxes.map((s) => new DimensionSandbox(this, s));
  }

  async destroySandbox(id: string): Promise<void> {
        await this.request("DELETE", `/sandboxes/${id}`);
  }

  async runCode(sandboxId: string, code: string, runtime?: Runtime): Promise<{ output: string; exitCode: number; language: string }> {
        return this.request("POST", `/sandboxes/${sandboxId}/code`, {
                code,
                runtime: runtime || detectRuntime(code),
        });
  }

  async runCommand(sandboxId: string, command: string, args?: string[], options?: { env?: Record<string, string>; cwd?: string; timeout?: number }): Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }> {
        return this.request("POST", `/sandboxes/${sandboxId}/execute`, { command, args, ...options });
  }

  async getInfo(sandboxId: string): Promise<{ id: string; provider: string; runtime: string; status: string; createdAt: Date; timeout: number }> {
        const data = await this.request<SandboxData & { provider: string }>("GET", `/sandboxes/${sandboxId}`);
        return { ...data, createdAt: new Date(data.createdAt) };
  }

  async getUrl(sandboxId: string, port: number): Promise<string> {
        const data = await this.request<{ url: string }>("GET", `/sandboxes/${sandboxId}/url?port=${port}`);
        return data.url;
  }
}

class DimensionSandbox {
    public readonly id: string;
    public readonly runtime: string;
    public readonly createdAt: string;
    private client: DimensionClient;

  constructor(client: DimensionClient, data: SandboxData) {
        this.client = client;
        this.id = data.id;
        this.runtime = data.runtime;
        this.createdAt = data.createdAt;
  }

  async runCode(code: string, runtime?: Runtime) {
        return this.client.runCode(this.id, code, runtime);
  }

  async runCommand(command: string, args?: string[], options?: { env?: Record<string, string>; cwd?: string; timeout?: number }) {
        return this.client.runCommand(this.id, command, args, options);
  }

  async getInfo() {
        return this.client.getInfo(this.id);
  }

  async getUrl(options: { port: number }) {
        return this.client.getUrl(this.id, options.port);
  }

  async destroy() {
        return this.client.destroySandbox(this.id);
  }
}

export function dimension(config: DimensionConfig = {}) {
    const client = new DimensionClient(config);
    return {
          name: "dimension" as const,
          sandbox: {
                  create: (options?: { runtime?: Runtime; timeout?: number; memory?: number }) => client.createSandbox(options),
                  getById: (id: string) => client.getSandboxById(id),
                  list: () => client.listSandboxes(),
                  destroy: (id: string) => client.destroySandbox(id),
          },
          getSupportedRuntimes(): Runtime[] {
                  return ["node", "python"];
          },
    };
}

export default dimension;
