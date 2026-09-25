import { createClient } from '@connectrpc/connect';
import { fileDesc, serviceDesc } from '@bufbuild/protobuf/codegenv2';
import { createConnectTransport } from '@connectrpc/connect-web';

// Embedded FileDescriptorProto from Prime's command_session.proto. Keeping the
// descriptor here avoids a runtime dependency on the Python Prime SDK.
const COMMAND_SESSION_DESCRIPTOR = [
  "CiVjb21tYW5kX3Nlc3Npb24vY29tbWFuZF9zZXNzaW9uLnByb3RvEg9jb21tYW5kX3Nlc3Npb24iUgoDUFRZEicKBHNpemUYASAB",
  "KAsyGS5jb21tYW5kX3Nlc3Npb24uUFRZLlNpemUaIgoEU2l6ZRIMCgRjb2xzGAEgASgNEgwKBHJvd3MYAiABKA0ipQEKC0NvbW1h",
  "bmRTcGVjEgsKA2NtZBgBIAEoCRIMCgRhcmdzGAIgAygJEjQKBGVudnMYAyADKAsyJi5jb21tYW5kX3Nlc3Npb24uQ29tbWFuZFNw",
  "ZWMuRW52c0VudHJ5EhAKA2N3ZBgEIAEoCUgAiAEBGisKCUVudnNFbnRyeRILCgNrZXkYASABKAkSDQoFdmFsdWUYAiABKAk6AjgB",
  "QgYKBF9jd2QiDQoLTGlzdFJlcXVlc3QiagoSQ29tbWFuZFNlc3Npb25JbmZvEi0KB2NvbW1hbmQYASABKAsyHC5jb21tYW5kX3Nl",
  "c3Npb24uQ29tbWFuZFNwZWMSCwoDcGlkGAIgASgNEhAKA3RhZxgDIAEoCUgAiAEBQgYKBF90YWciRQoMTGlzdFJlc3BvbnNlEjUK",
  "CHNlc3Npb25zGAEgAygLMiMuY29tbWFuZF9zZXNzaW9uLkNvbW1hbmRTZXNzaW9uSW5mbyKlAQoMU3RhcnRSZXF1ZXN0Ei0KB2Nv",
  "bW1hbmQYASABKAsyHC5jb21tYW5kX3Nlc3Npb24uQ29tbWFuZFNwZWMSJgoDcHR5GAIgASgLMhQuY29tbWFuZF9zZXNzaW9uLlBU",
  "WUgAiAEBEhAKA3RhZxgDIAEoCUgBiAEBEhIKBXN0ZGluGAQgASgISAKIAQFCBgoEX3B0eUIGCgRfdGFnQggKBl9zdGRpbiJ5Cg1V",
  "cGRhdGVSZXF1ZXN0EjgKB3Nlc3Npb24YASABKAsyJy5jb21tYW5kX3Nlc3Npb24uQ29tbWFuZFNlc3Npb25TZWxlY3RvchImCgNw",
  "dHkYAiABKAsyFC5jb21tYW5kX3Nlc3Npb24uUFRZSACIAQFCBgoEX3B0eSIQCg5VcGRhdGVSZXNwb25zZSLyAwoTQ29tbWFuZFNl",
  "c3Npb25FdmVudBJACgVzdGFydBgBIAEoCzIvLmNvbW1hbmRfc2Vzc2lvbi5Db21tYW5kU2Vzc2lvbkV2ZW50LlN0YXJ0RXZlbnRI",
  "ABI+CgRkYXRhGAIgASgLMi4uY29tbWFuZF9zZXNzaW9uLkNvbW1hbmRTZXNzaW9uRXZlbnQuRGF0YUV2ZW50SAASPAoDZW5kGAMg",
  "ASgLMi0uY29tbWFuZF9zZXNzaW9uLkNvbW1hbmRTZXNzaW9uRXZlbnQuRW5kRXZlbnRIABJDCglrZWVwYWxpdmUYBCABKAsyLi5j",
  "b21tYW5kX3Nlc3Npb24uQ29tbWFuZFNlc3Npb25FdmVudC5LZWVwQWxpdmVIABoZCgpTdGFydEV2ZW50EgsKA3BpZBgBIAEoDRpI",
  "CglEYXRhRXZlbnQSEAoGc3Rkb3V0GAEgASgMSAASEAoGc3RkZXJyGAIgASgMSAASDQoDcHR5GAMgASgMSABCCAoGb3V0cHV0GlsK",
  "CEVuZEV2ZW50EhEKCWV4aXRfY29kZRgBIAEoERIOCgZleGl0ZWQYAiABKAgSDgoGc3RhdHVzGAMgASgJEhIKBWVycm9yGAQgASgJ",
  "SACIAQFCCAoGX2Vycm9yGgsKCUtlZXBBbGl2ZUIHCgVldmVudCJECg1TdGFydFJlc3BvbnNlEjMKBWV2ZW50GAEgASgLMiQuY29t",
  "bWFuZF9zZXNzaW9uLkNvbW1hbmRTZXNzaW9uRXZlbnQiRgoPQ29ubmVjdFJlc3BvbnNlEjMKBWV2ZW50GAEgASgLMiQuY29tbWFu",
  "ZF9zZXNzaW9uLkNvbW1hbmRTZXNzaW9uRXZlbnQiegoQU2VuZElucHV0UmVxdWVzdBI4CgdzZXNzaW9uGAEgASgLMicuY29tbWFu",
  "ZF9zZXNzaW9uLkNvbW1hbmRTZXNzaW9uU2VsZWN0b3ISLAoFaW5wdXQYAiABKAsyHS5jb21tYW5kX3Nlc3Npb24uQ29tbWFuZElu",
  "cHV0IhMKEVNlbmRJbnB1dFJlc3BvbnNlIjcKDENvbW1hbmRJbnB1dBIPCgVzdGRpbhgBIAEoDEgAEg0KA3B0eRgCIAEoDEgAQgcK",
  "BWlucHV0IvECChJTdHJlYW1JbnB1dFJlcXVlc3QSPwoFc3RhcnQYASABKAsyLi5jb21tYW5kX3Nlc3Npb24uU3RyZWFtSW5wdXRS",
  "ZXF1ZXN0LlN0YXJ0RXZlbnRIABI9CgRkYXRhGAIgASgLMi0uY29tbWFuZF9zZXNzaW9uLlN0cmVhbUlucHV0UmVxdWVzdC5EYXRh",
  "RXZlbnRIABJCCglrZWVwYWxpdmUYAyABKAsyLS5jb21tYW5kX3Nlc3Npb24uU3RyZWFtSW5wdXRSZXF1ZXN0LktlZXBBbGl2ZUgA",
  "GkYKClN0YXJ0RXZlbnQSOAoHc2Vzc2lvbhgBIAEoCzInLmNvbW1hbmRfc2Vzc2lvbi5Db21tYW5kU2Vzc2lvblNlbGVjdG9yGjkK",
  "CURhdGFFdmVudBIsCgVpbnB1dBgCIAEoCzIdLmNvbW1hbmRfc2Vzc2lvbi5Db21tYW5kSW5wdXQaCwoJS2VlcEFsaXZlQgcKBWV2",
  "ZW50IhUKE1N0cmVhbUlucHV0UmVzcG9uc2UidgoRU2VuZFNpZ25hbFJlcXVlc3QSOAoHc2Vzc2lvbhgBIAEoCzInLmNvbW1hbmRf",
  "c2Vzc2lvbi5Db21tYW5kU2Vzc2lvblNlbGVjdG9yEicKBnNpZ25hbBgCIAEoDjIXLmNvbW1hbmRfc2Vzc2lvbi5TaWduYWwiFAoS",
  "U2VuZFNpZ25hbFJlc3BvbnNlIkoKDkNvbm5lY3RSZXF1ZXN0EjgKB3Nlc3Npb24YASABKAsyJy5jb21tYW5kX3Nlc3Npb24uQ29t",
  "bWFuZFNlc3Npb25TZWxlY3RvciJCChZDb21tYW5kU2Vzc2lvblNlbGVjdG9yEg0KA3BpZBgBIAEoDUgAEg0KA3RhZxgCIAEoCUgA",
  "QgoKCHNlbGVjdG9yKkgKBlNpZ25hbBIWChJTSUdOQUxfVU5TUEVDSUZJRUQQABISCg5TSUdOQUxfU0lHVEVSTRAPEhIKDlNJR05B",
  "TF9TSUdLSUxMEAkywQQKDkNvbW1hbmRTZXNzaW9uEkMKBExpc3QSHC5jb21tYW5kX3Nlc3Npb24uTGlzdFJlcXVlc3QaHS5jb21t",
  "YW5kX3Nlc3Npb24uTGlzdFJlc3BvbnNlEk4KB0Nvbm5lY3QSHy5jb21tYW5kX3Nlc3Npb24uQ29ubmVjdFJlcXVlc3QaIC5jb21t",
  "YW5kX3Nlc3Npb24uQ29ubmVjdFJlc3BvbnNlMAESSAoFU3RhcnQSHS5jb21tYW5kX3Nlc3Npb24uU3RhcnRSZXF1ZXN0Gh4uY29t",
  "bWFuZF9zZXNzaW9uLlN0YXJ0UmVzcG9uc2UwARJJCgZVcGRhdGUSHi5jb21tYW5kX3Nlc3Npb24uVXBkYXRlUmVxdWVzdBofLmNv",
  "bW1hbmRfc2Vzc2lvbi5VcGRhdGVSZXNwb25zZRJaCgtTdHJlYW1JbnB1dBIjLmNvbW1hbmRfc2Vzc2lvbi5TdHJlYW1JbnB1dFJl",
  "cXVlc3QaJC5jb21tYW5kX3Nlc3Npb24uU3RyZWFtSW5wdXRSZXNwb25zZSgBElIKCVNlbmRJbnB1dBIhLmNvbW1hbmRfc2Vzc2lv",
  "bi5TZW5kSW5wdXRSZXF1ZXN0GiIuY29tbWFuZF9zZXNzaW9uLlNlbmRJbnB1dFJlc3BvbnNlElUKClNlbmRTaWduYWwSIi5jb21t",
  "YW5kX3Nlc3Npb24uU2VuZFNpZ25hbFJlcXVlc3QaIy5jb21tYW5kX3Nlc3Npb24uU2VuZFNpZ25hbFJlc3BvbnNlYgZwcm90bzM=",
].join('');

const CommandSession = serviceDesc(fileDesc(COMMAND_SESSION_DESCRIPTOR), 0);

interface CommandSessionStartRequest {
  command: {
    cmd: string;
    args: string[];
    envs: Record<string, string>;
    cwd?: string;
  };
  stdin: boolean;
}

type CommandSessionEvent =
  | { case: 'start'; value: { pid: number } }
  | {
      case: 'data';
      value: {
        output:
          | { case: 'stdout'; value: Uint8Array }
          | { case: 'stderr'; value: Uint8Array }
          | { case: 'pty'; value: Uint8Array }
          | { case: undefined; value?: undefined };
      };
    }
  | { case: 'end'; value: { exitCode: number; exited: boolean; status: string; error?: string } }
  | { case: 'keepalive'; value: Record<string, never> }
  | { case: undefined; value?: undefined };

interface CommandSessionStartResponse {
  event?: { event: CommandSessionEvent };
}

interface CommandSessionClient {
  start(
    request: CommandSessionStartRequest,
    options?: { headers?: HeadersInit; timeoutMs?: number },
  ): AsyncIterable<CommandSessionStartResponse>;
}

export interface VmCommandOptions {
  baseUrl: string;
  token: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs: number;
  fetch: typeof globalThis.fetch;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

export interface VmCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Executes a command in a VM sandbox over sandboxd's Connect-RPC stream. */
export async function executeVmCommand(options: VmCommandOptions): Promise<VmCommandResult> {
  const transport = createConnectTransport({
    baseUrl: options.baseUrl.replace(/\/+$/, ''),
    useBinaryFormat: false,
    defaultTimeoutMs: options.timeoutMs,
    fetch: options.fetch,
  });
  const client = createClient(CommandSession, transport) as unknown as CommandSessionClient;
  const stream = client.start(
    {
      command: {
        cmd: '/bin/bash',
        args: ['-c', options.command],
        envs: options.env ?? {},
        ...(options.cwd ? { cwd: options.cwd } : {}),
      },
      stdin: false,
    },
    {
      headers: {
        Authorization: `Bearer ${options.token}`,
        'User-Agent': '@computesdk/prime/0.1.0',
      },
      timeoutMs: options.timeoutMs,
    },
  );

  const stdoutDecoder = new TextDecoder();
  const stderrDecoder = new TextDecoder();
  let stdout = '';
  let stderr = '';
  let exitCode: number | undefined;

  for await (const response of stream) {
    const event = response.event?.event;
    if (!event) continue;
    if (event.case === 'data') {
      const output = event.value.output;
      if (output.case === 'stdout' || output.case === 'pty') {
        const text = stdoutDecoder.decode(output.value, { stream: true });
        stdout += text;
        options.onStdout?.(text);
      } else if (output.case === 'stderr') {
        const text = stderrDecoder.decode(output.value, { stream: true });
        stderr += text;
        options.onStderr?.(text);
      }
    } else if (event.case === 'end') {
      exitCode = event.value.exitCode;
      if (event.value.error && !stderr) stderr = event.value.error;
    }
  }

  const stdoutTail = stdoutDecoder.decode();
  const stderrTail = stderrDecoder.decode();
  stdout += stdoutTail;
  stderr += stderrTail;
  if (stdoutTail) options.onStdout?.(stdoutTail);
  if (stderrTail) options.onStderr?.(stderrTail);

  if (exitCode === undefined) throw new Error('Prime VM command stream ended without an exit code');
  return { stdout, stderr, exitCode };
}
