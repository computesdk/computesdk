/**
 * AWS Bedrock AgentCore Code Interpreter Provider - Factory-based Implementation
 *
 * Maps a ComputeSDK "sandbox" onto an AgentCore Code Interpreter *session*:
 *   create   -> StartCodeInterpreterSession
 *   destroy  -> StopCodeInterpreterSession
 *   getById  -> GetCodeInterpreterSession
 *   list     -> ListCodeInterpreterSessions
 *   command  -> InvokeCodeInterpreter (name: ToolName.EXECUTE_COMMAND)
 *
 * Auth uses the standard AWS credential provider chain (env vars, SSO, profiles,
 * EC2/ECS roles, ...). Pass `profile` or `credentials` to override; otherwise the
 * SDK resolves credentials exactly like the AWS CLI, including temporary creds.
 */

import {
  BedrockAgentCoreClient,
  StartCodeInterpreterSessionCommand,
  StopCodeInterpreterSessionCommand,
  GetCodeInterpreterSessionCommand,
  ListCodeInterpreterSessionsCommand,
  InvokeCodeInterpreterCommand,
  ToolName,
  CodeInterpreterSessionStatus,
} from '@aws-sdk/client-bedrock-agentcore';
import type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from '@aws-sdk/types';
import { randomUUID } from 'node:crypto';
import { defineProvider } from '@computesdk/provider';
import type { CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from 'computesdk';
import { sq, buildCommand, wrapForCapture, parseWrappedResult, friendlyError, clampSessionTimeout } from './internal.js';

/** The built-in managed code interpreter. */
const DEFAULT_CODE_INTERPRETER = 'aws.codeinterpreter.v1';
/** AgentCore default session timeout (seconds). */
const DEFAULT_SESSION_TIMEOUT_SECONDS = 900;
/**
 * Max base64 bytes per writeFile command. AgentCore's PTY input line caps around
 * 128KB and silently hangs beyond it, so stage large writes in bounded chunks.
 */
const B64_CHUNK_SIZE = 60000;

export interface AgentCoreConfig {
  /** AWS region (e.g. 'us-west-2'). Falls back to AWS_REGION / AWS_DEFAULT_REGION. */
  region?: string;
  /**
   * Code interpreter to use. Defaults to the managed `aws.codeinterpreter.v1`.
   * Pass a custom interpreter id/ARN to use one created via the control plane.
   */
  codeInterpreterIdentifier?: string;
  /** Named profile from your AWS config/credentials files. */
  profile?: string;
  /** Explicit credentials. If omitted, the default AWS credential chain is used. */
  credentials?: AwsCredentialIdentity | AwsCredentialIdentityProvider;
  /** Session idle timeout in seconds (max 28800 / 8h). Overridden by per-create `timeout`. */
  sessionTimeoutSeconds?: number;
}

/** Native sandbox object: the live client plus session coordinates. */
interface AgentCoreSandbox {
  client: BedrockAgentCoreClient;
  codeInterpreterIdentifier: string;
  sessionId: string;
  createdAt: Date;
  sessionTimeoutSeconds: number;
}

/** Flattened result of a single InvokeCodeInterpreter call. */
interface InvocationResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function createClient(config: AgentCoreConfig): BedrockAgentCoreClient {
  // Set each option only when explicitly provided, so the SDK's own resolution
  // chains stay intact: region resolves from AWS_REGION/AWS_DEFAULT_REGION or the
  // active profile's config file; credentials from env, SSO, profile, or instance
  // roles. Second-guessing these here would break valid profile-only setups.
  return new BedrockAgentCoreClient({
    ...(config.region ? { region: config.region } : {}),
    ...(config.profile ? { profile: config.profile } : {}),
    ...(config.credentials ? { credentials: config.credentials } : {}),
  });
}

/** Drain the InvokeCodeInterpreter event stream into a flat result. */
async function invoke(
  sandbox: AgentCoreSandbox,
  name: ToolName,
  args: Record<string, unknown>,
): Promise<InvocationResult> {
  const response = await sandbox.client.send(
    new InvokeCodeInterpreterCommand({
      codeInterpreterIdentifier: sandbox.codeInterpreterIdentifier,
      sessionId: sandbox.sessionId,
      name,
      arguments: args,
    }),
  );

  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  let isError = false;
  let text = '';
  let hasStructured = false;

  for await (const event of response.stream ?? []) {
    // The stream is a tagged union: a result, or a mid-stream exception
    // (throttling, server error, ...). Surface exceptions instead of silently
    // treating them as an empty successful result.
    const exception =
      event.throttlingException ??
      event.internalServerException ??
      event.serviceQuotaExceededException ??
      event.accessDeniedException ??
      event.resourceNotFoundException ??
      event.conflictException ??
      event.validationException;
    if (exception) throw exception;

    const result = event.result;
    if (!result) continue;
    if (result.isError) isError = true;

    // The execute* tools return a structuredContent with clean streams.
    const structured = result.structuredContent;
    if (structured) {
      hasStructured = true;
      if (typeof structured.stdout === 'string') stdout += structured.stdout;
      if (typeof structured.stderr === 'string') stderr += structured.stderr;
      if (typeof structured.exitCode === 'number') exitCode = structured.exitCode;
    }

    for (const block of result.content ?? []) {
      if (block.type === 'text' && typeof block.text === 'string') text += block.text;
    }
  }

  // Tool-level failures (e.g. invalid arguments) carry no structuredContent,
  // only a text error block. Surface that as stderr with a non-zero exit code.
  if (isError && !hasStructured) {
    if (!stderr) stderr = text;
    if (exitCode === 0) exitCode = 1;
  }

  // AgentCore runs commands through a PTY, so line endings come back as CRLF.
  // stderr is surfaced raw in error messages, so normalize it to LF. stdout is
  // always consumed as base64 or via the marker wrapper (both CRLF-immune), so
  // it needs no normalization here.
  return { stdout, stderr: stderr.replace(/\r\n/g, '\n'), exitCode };
}

/**
 * Execute a raw shell command with true, byte-exact stdout/stderr/exit-code
 * separation via the capture wrapper. Used by both runCommand and the
 * filesystem operations that need faithful output.
 */
async function execCaptured(
  sandbox: AgentCoreSandbox,
  inner: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const tag = randomUUID().replace(/-/g, '');
  const raw = await invoke(sandbox, ToolName.EXECUTE_COMMAND, { command: wrapForCapture(inner, tag) });
  return parseWrappedResult(raw.stdout, tag);
}

/** Run a shell command for its side effect, throwing `failure` on a non-zero exit. */
async function runOrThrow(sandbox: AgentCoreSandbox, command: string, failure: string): Promise<void> {
  const result = await invoke(sandbox, ToolName.EXECUTE_COMMAND, { command });
  if (result.exitCode !== 0) throw new Error(result.stderr || failure);
}

const _provider = defineProvider<AgentCoreSandbox, AgentCoreConfig>({
  name: 'agentcore',
  methods: {
    sandbox: {
      create: async (config: AgentCoreConfig, options?: CreateSandboxOptions) => {
        const client = createClient(config);
        const codeInterpreterIdentifier = config.codeInterpreterIdentifier || DEFAULT_CODE_INTERPRETER;
        // Per-create `timeout` (ms) wins over config; clamp into AgentCore's
        // accepted range so an out-of-bounds value doesn't fail with a raw
        // ValidationException.
        const sessionTimeoutSeconds = clampSessionTimeout(
          options?.timeout
            ? options.timeout / 1000
            : config.sessionTimeoutSeconds ?? DEFAULT_SESSION_TIMEOUT_SECONDS,
        );

        try {
          const response = await client.send(
            new StartCodeInterpreterSessionCommand({
              codeInterpreterIdentifier,
              name: options?.name,
              sessionTimeoutSeconds,
            }),
          );
          if (!response.sessionId) {
            throw new Error('AgentCore StartCodeInterpreterSession returned no sessionId');
          }

          const sandbox: AgentCoreSandbox = {
            client,
            codeInterpreterIdentifier,
            sessionId: response.sessionId,
            createdAt: response.createdAt ? new Date(response.createdAt) : new Date(),
            sessionTimeoutSeconds,
          };
          // Encode both identifier and session into the portable sandboxId.
          return { sandbox, sandboxId: `${codeInterpreterIdentifier}::${response.sessionId}` };
        } catch (error) {
          throw friendlyError('starting an AgentCore session', error);
        }
      },

      getById: async (config: AgentCoreConfig, sandboxId: string) => {
        const { codeInterpreterIdentifier, sessionId } = parseSandboxId(sandboxId, config);
        const client = createClient(config);
        try {
          const response = await client.send(
            new GetCodeInterpreterSessionCommand({ codeInterpreterIdentifier, sessionId }),
          );
          // A terminated/expired session is not a usable sandbox.
          if (response.status && response.status !== CodeInterpreterSessionStatus.READY) return null;
          const sandbox: AgentCoreSandbox = {
            client,
            codeInterpreterIdentifier,
            sessionId,
            createdAt: response.createdAt ? new Date(response.createdAt) : new Date(),
            sessionTimeoutSeconds: response.sessionTimeoutSeconds ?? DEFAULT_SESSION_TIMEOUT_SECONDS,
          };
          return { sandbox, sandboxId };
        } catch {
          return null;
        }
      },

      list: async (config: AgentCoreConfig) => {
        const client = createClient(config);
        const codeInterpreterIdentifier = config.codeInterpreterIdentifier || DEFAULT_CODE_INTERPRETER;
        const results: Array<{ sandbox: AgentCoreSandbox; sandboxId: string }> = [];
        try {
          // Page through all READY sessions.
          let nextToken: string | undefined;
          do {
            const response = await client.send(
              new ListCodeInterpreterSessionsCommand({
                codeInterpreterIdentifier,
                status: CodeInterpreterSessionStatus.READY,
                nextToken,
              }),
            );
            for (const item of response.items ?? []) {
              if (!item.sessionId) continue;
              const sandbox: AgentCoreSandbox = {
                client,
                codeInterpreterIdentifier: item.codeInterpreterIdentifier || codeInterpreterIdentifier,
                sessionId: item.sessionId,
                createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
                // The list summary doesn't carry the timeout; getInfo on a listed
                // sandbox reports the default. Use getById for the true value.
                sessionTimeoutSeconds: DEFAULT_SESSION_TIMEOUT_SECONDS,
              };
              results.push({ sandbox, sandboxId: `${sandbox.codeInterpreterIdentifier}::${sandbox.sessionId}` });
            }
            nextToken = response.nextToken;
          } while (nextToken);
          return results;
        } catch {
          return [];
        }
      },

      destroy: async (config: AgentCoreConfig, sandboxId: string) => {
        const { codeInterpreterIdentifier, sessionId } = parseSandboxId(sandboxId, config);
        const client = createClient(config);
        try {
          await client.send(
            new StopCodeInterpreterSessionCommand({ codeInterpreterIdentifier, sessionId }),
          );
        } catch {
          // Already stopped or expired.
        }
      },

      runCommand: async (
        sandbox: AgentCoreSandbox,
        command: string,
        options?: RunCommandOptions,
      ): Promise<CommandResult> => {
        const startTime = Date.now();
        try {
          const parsed = await execCaptured(sandbox, buildCommand(command, options));
          return { ...parsed, durationMs: Date.now() - startTime };
        } catch (error) {
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 127,
            durationMs: Date.now() - startTime,
          };
        }
      },

      // Reports cached creation-time metadata. status is always 'running' (like
      // the e2b/leap0 siblings); use getById for authoritative liveness, which
      // returns null once a session has terminated.
      getInfo: async (sandbox: AgentCoreSandbox): Promise<SandboxInfo> => ({
        id: `${sandbox.codeInterpreterIdentifier}::${sandbox.sessionId}`,
        provider: 'agentcore',
        status: 'running',
        createdAt: sandbox.createdAt,
        timeout: sandbox.sessionTimeoutSeconds * 1000,
        metadata: {
          codeInterpreterIdentifier: sandbox.codeInterpreterIdentifier,
          sessionId: sandbox.sessionId,
        },
      }),

      getUrl: async (): Promise<string> => {
        throw new Error(
          `AgentCore Code Interpreter does not expose inbound ports or preview URLs. ` +
            `It is a code-execution sandbox without a public network endpoint.`,
        );
      },

      // Filesystem is implemented over the shell channel: AgentCore's native
      // file tools sandbox paths to a relative workdir and reject absolute paths,
      // whereas the shell has full filesystem access (matches other providers).
      filesystem: {
        readFile: async (sandbox: AgentCoreSandbox, path: string): Promise<string> => {
          const cmd = `if [ -f ${sq(path)} ]; then base64 ${sq(path)} | tr -d '\\n'; else exit 1; fi`;
          const result = await invoke(sandbox, ToolName.EXECUTE_COMMAND, { command: cmd });
          if (result.exitCode !== 0) throw new Error(result.stderr || `File not found: ${path}`);
          return Buffer.from(result.stdout, 'base64').toString('utf8');
        },

        writeFile: async (sandbox: AgentCoreSandbox, path: string, content: string): Promise<void> => {
          const b64 = Buffer.from(content, 'utf8').toString('base64');
          // Stage under a per-call unique name in /tmp. A deterministic
          // `${path}.csdk-b64` would let two concurrent writeFile calls to the
          // same path interleave their appends and decode into corrupt output
          // (or one call would `rm` the other's staging file), so tag it with a
          // UUID — the same collision-avoidance technique as wrapForCapture.
          const staged = `/tmp/.csdk-b64-${randomUUID().replace(/-/g, '')}`;

          // AgentCore runs commands through a PTY whose input line has a hard
          // ~128KB limit; a command longer than that hangs silently. So stage the
          // base64 in bounded chunks (append), then decode. Small files still take
          // a single round-trip.
          const fail = `Failed to write: ${path}`;
          try {
            await runOrThrow(sandbox, `mkdir -p "$(dirname ${sq(path)})"`, fail);
            // `|| i === 0` runs one iteration for empty content, creating an empty file.
            for (let i = 0; i < b64.length || i === 0; i += B64_CHUNK_SIZE) {
              const chunk = b64.slice(i, i + B64_CHUNK_SIZE);
              const redirect = i === 0 ? '>' : '>>';
              await runOrThrow(sandbox, `printf '%s' ${sq(chunk)} ${redirect} ${sq(staged)}`, fail);
            }
            await runOrThrow(sandbox, `base64 -d ${sq(staged)} > ${sq(path)}`, fail);
          } finally {
            // Always remove the staging file, even if a chunk append failed midway.
            await invoke(sandbox, ToolName.EXECUTE_COMMAND, { command: `rm -f ${sq(staged)}` }).catch(() => {});
          }
        },

        mkdir: async (sandbox: AgentCoreSandbox, path: string): Promise<void> => {
          await runOrThrow(sandbox, `mkdir -p ${sq(path)}`, `Failed to mkdir: ${path}`);
        },

        readdir: async (sandbox: AgentCoreSandbox, path: string): Promise<FileEntry[]> => {
          // `find -printf` emits `type<TAB>size<TAB>epoch<TAB>name` per entry,
          // NUL-terminated. NUL is the one byte a filename can't contain, so this
          // stays unambiguous even for names with spaces, tabs, or newlines.
          // execCaptured routes the bytes through base64, so they arrive exact.
          const cmd =
            `if [ -d ${sq(path)} ]; then ` +
            `find ${sq(path)} -maxdepth 1 -mindepth 1 -printf '%y\\t%s\\t%T@\\t%f\\0'; ` +
            `else exit 1; fi`;
          const result = await execCaptured(sandbox, cmd);
          if (result.exitCode !== 0) throw new Error(result.stderr || `Not a directory: ${path}`);
          const entries: FileEntry[] = [];
          for (const record of result.stdout.split('\0')) {
            if (!record) continue;
            // Only the first three tabs are delimiters; the name may contain tabs.
            const firstTab = record.indexOf('\t');
            const secondTab = record.indexOf('\t', firstTab + 1);
            const thirdTab = record.indexOf('\t', secondTab + 1);
            if (firstTab < 0 || secondTab < 0 || thirdTab < 0) continue;
            const type = record.slice(0, firstTab);
            const size = record.slice(firstTab + 1, secondTab);
            const epoch = record.slice(secondTab + 1, thirdTab);
            const name = record.slice(thirdTab + 1);
            if (!name) continue;
            entries.push({
              name,
              type: type === 'd' ? 'directory' : 'file',
              size: Number(size) || 0,
              modified: new Date(Number(epoch) * 1000),
            });
          }
          return entries;
        },

        exists: async (sandbox: AgentCoreSandbox, path: string): Promise<boolean> => {
          const result = await invoke(sandbox, ToolName.EXECUTE_COMMAND, { command: `test -e ${sq(path)}` });
          return result.exitCode === 0;
        },

        remove: async (sandbox: AgentCoreSandbox, path: string): Promise<void> => {
          await runOrThrow(sandbox, `rm -rf ${sq(path)}`, `Failed to remove: ${path}`);
        },
      },

      getInstance: (sandbox: AgentCoreSandbox): AgentCoreSandbox => sandbox,
    },
  },
});

/** Split a `<identifier>::<sessionId>` sandboxId, tolerating bare session ids. */
function parseSandboxId(
  sandboxId: string,
  config: AgentCoreConfig,
): { codeInterpreterIdentifier: string; sessionId: string } {
  const sep = sandboxId.indexOf('::');
  if (sep === -1) {
    return {
      codeInterpreterIdentifier: config.codeInterpreterIdentifier || DEFAULT_CODE_INTERPRETER,
      sessionId: sandboxId,
    };
  }
  return {
    codeInterpreterIdentifier: sandboxId.slice(0, sep),
    sessionId: sandboxId.slice(sep + 2),
  };
}

export const agentcore = (config: AgentCoreConfig = {}) => _provider(config);
export type { AgentCoreSandbox };
