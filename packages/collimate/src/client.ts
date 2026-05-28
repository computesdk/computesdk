/**
 * Thin HTTP client for the Collimate session API.
 * Zero dependencies — uses native fetch.
 */

// ── Response types (mirror server-side Rust structs) ─────────────────────

export interface CreateSessionResponse {
  session_id: string;
  template_id: string;
  fork_time_ms: number;
  create_time_ms: number;
}

export interface ExecResponse {
  id: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  fork_time_ms: number;
  exec_time_ms: number;
  total_time_ms: number;
  results?: Array<{ stdout: string; stderr: string; exit_code: number }>;
}

export interface SessionInfo {
  session_id: string;
  template_id: string;
  age_secs: number;
  idle_secs: number;
  exec_count: number;
}

export interface FileSpec {
  path: string;
  content: string;
}

export interface ExecRequest {
  code?: string;
  commands?: string[][];
  files?: FileSpec[];
  timeout_seconds?: number;
}

// ── Error ────────────────────────────────────────────────────────────────

export class CollimateError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "CollimateError";
  }
}

// ── Client ───────────────────────────────────────────────────────────────

export interface CollimateClientConfig {
  serverUrl: string;
  apiKey: string;
}

export class CollimateClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: CollimateClientConfig) {
    this.baseUrl = config.serverUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${this.apiKey}`,
      "User-Agent": "computesdk-collimate/0.1.0",
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const resp = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      let message = `Collimate API error: ${resp.status}`;
      try {
        const parsed = JSON.parse(text);
        if (parsed.error) message = parsed.error;
        else if (parsed.stderr) message = parsed.stderr;
      } catch {
        if (text) message = text;
      }
      throw new CollimateError(message, resp.status, text);
    }

    const text = await resp.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  async createSession(templateId: string): Promise<CreateSessionResponse> {
    return this.request<CreateSessionResponse>("POST", "/v1/sessions", {
      template_id: templateId,
    });
  }

  async execSession(
    sessionId: string,
    body: ExecRequest,
  ): Promise<ExecResponse> {
    return this.request<ExecResponse>(
      "POST",
      `/v1/sessions/${encodeURIComponent(sessionId)}/exec`,
      body,
    );
  }

  async getSession(sessionId: string): Promise<SessionInfo | null> {
    try {
      return await this.request<SessionInfo>(
        "GET",
        `/v1/sessions/${encodeURIComponent(sessionId)}`,
      );
    } catch (err) {
      if (err instanceof CollimateError && err.status === 404) return null;
      throw err;
    }
  }

  async listSessions(): Promise<SessionInfo[]> {
    return this.request<SessionInfo[]>("GET", "/v1/sessions");
  }

  async deleteSession(sessionId: string, force = true): Promise<void> {
    const qs = force ? "?force=true" : "";
    try {
      await this.request<unknown>(
        "DELETE",
        `/v1/sessions/${encodeURIComponent(sessionId)}${qs}`,
      );
    } catch (err) {
      if (err instanceof CollimateError && err.status === 404) return;
      throw err;
    }
  }
}
