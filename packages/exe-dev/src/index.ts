/**
 * exe.dev Provider - Factory-based Implementation
 *
 * Standalone exe.dev VMs (https://exe.dev/docs/standalone-vms), driven through the
 * HTTPS API (https://exe.dev/docs/https-api). Every call is `POST /exec` with an
 * exe.dev command as the body, so this package uses `fetch` and has no SDK dependency.
 */

import { randomUUID } from 'node:crypto';
import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type { CommandResult, CreateInstanceOptions, InstanceInfo, RunCommandOptions } from '@computesdk/provider';

export interface ExeDevConfig {
  /** exe.dev API token - if not provided, will fallback to EXE_API_KEY environment variable */
  apiKey?: string;
  /** API endpoint - defaults to https://exe.dev/exec */
  apiUrl?: string;
  /** Egress policy for new VMs. `integrations` blocks the public internet. Defaults to the exe.dev default (full access). */
  egress?: 'integrations' | 'all';
}

/** A VM as `ls --json` / `new --json` return it. */
export interface ExeDevVmData {
  vm_name: string;
  status?: string;
  region?: string;
  image?: string;
  created_at?: string;
  https_url?: string;
  ssh_dest?: string;
  [key: string]: unknown;
}

export interface ExeDevSandbox {
  id: string;
  data: ExeDevVmData;
  apiKey: string;
  apiUrl: string;
}

const DEFAULT_API_URL = 'https://exe.dev/exec';
// exe.dev ends every /exec request after 30 seconds.
const API_TIMEOUT_MS = 30_000;
const VM_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

function resolveConfig(config: ExeDevConfig) {
  const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.EXE_API_KEY) || '';
  if (!apiKey) {
    throw new Error(
      'Missing exe.dev API token. Provide apiKey in config or set EXE_API_KEY. ' +
        'Create one with `ssh exe.dev ssh-key generate-api-key` (see https://exe.dev/docs/https-api).',
    );
  }
  return { apiKey, apiUrl: config.apiUrl || DEFAULT_API_URL };
}

function vmName(id: string): string {
  if (!VM_NAME.test(id)) throw new Error(`Invalid exe.dev VM name ${JSON.stringify(id)}: use lowercase letters, digits and hyphens`);
  return id;
}

/** Quote one argument for the exe.dev command lexer (POSIX single quotes). */
function quote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function post(auth: { apiKey: string; apiUrl: string }, command: string, accept: string, timeoutMs = API_TIMEOUT_MS) {
  const response = await fetch(auth.apiUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.apiKey}`, 'Content-Type': 'text/plain', Accept: accept },
    body: command,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, text };
}

/** Run an exe.dev lobby command (ls, new, rm) and parse its JSON output. */
async function lobby<T>(auth: { apiKey: string; apiUrl: string }, command: string): Promise<T> {
  const { ok, status, text } = await post(auth, command, 'application/json');
  let body: any;
  try {
    body = text.trim() ? JSON.parse(text) : {};
  } catch {
    body = undefined;
  }
  const message = typeof body?.error === 'string' ? body.error : text.trim();
  if (!ok || body === undefined || typeof body?.error === 'string') {
    throw new Error(`exe.dev \`${command.split(' ')[0]}\` failed (HTTP ${status}): ${message || 'no output'}`);
  }
  return body as T;
}

function toSandbox(auth: { apiKey: string; apiUrl: string }, data: ExeDevVmData): ExeDevSandbox {
  return { id: data.vm_name, data, apiKey: auth.apiKey, apiUrl: auth.apiUrl };
}

async function findVm(auth: { apiKey: string; apiUrl: string }, name: string): Promise<ExeDevVmData | null> {
  const { vms } = await lobby<{ vms?: ExeDevVmData[] }>(auth, `ls --json ${vmName(name)}`);
  return vms?.find((vm) => vm.vm_name === name) ?? null;
}

function infoStatus(status: string | undefined): InstanceInfo['status'] {
  if (status === 'running') return 'running';
  if (status === 'stopped' || status === 'paused') return 'stopped';
  return status ? 'error' : 'running';
}

function wrapCommand(command: string, options?: RunCommandOptions): string {
  let script = command;
  if (options?.env && Object.keys(options.env).length > 0) {
    const exports = Object.entries(options.env)
      .map(([key, value]) => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid environment variable name: ${key}`);
        return `export ${key}="${escapeShellArg(value)}"`;
      })
      .join(' && ');
    script = `${exports} && ${script}`;
  }
  if (options?.cwd) script = `cd "${escapeShellArg(options.cwd)}" && ${script}`;
  if (options?.background) script = `nohup sh -c "${escapeShellArg(script)}" > /dev/null 2>&1 < /dev/null &`;
  return script;
}

/** Decode the NDJSON stream from `/exec` (stdout/stderr are base64, exit_code ends it). */
function parseExecStream(text: string): { stdout: string; stderr: string; exitCode: number | null; error?: string } {
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  let exitCode: number | null = null;
  let error: string | undefined;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let record: any;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof record.stdout === 'string') out.push(Buffer.from(record.stdout, 'base64'));
    if (typeof record.stderr === 'string') err.push(Buffer.from(record.stderr, 'base64'));
    if (typeof record.exit_code === 'number') exitCode = record.exit_code;
    if (typeof record.error === 'string') error = record.error;
  }
  return { stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), exitCode, error };
}

export const exeDev = defineProvider<ExeDevSandbox, ExeDevConfig>({
  name: 'exe-dev',
  methods: {
    instances: {
      create: async (config: ExeDevConfig, options?: CreateInstanceOptions) => {
        const auth = resolveConfig(config);
        const name = vmName(options?.name ?? `csdk-${randomUUID().slice(0, 8)}`);
        const args = ['new', '--json', '--standalone', `--name=${name}`];
        if (options?.templateId) args.push(`--image=${quote(options.templateId)}`);
        if (config.egress) args.push(`--egress=${quote(config.egress)}`);
        const created = await lobby<ExeDevVmData>(auth, args.join(' '));
        const data = (await findVm(auth, name).catch(() => null)) ?? { ...created, vm_name: created.vm_name ?? name };
        return { instance: toSandbox(auth, data), instanceId: data.vm_name };
      },

      getById: async (config: ExeDevConfig, instanceId: string) => {
        const auth = resolveConfig(config);
        const data = await findVm(auth, instanceId);
        return data ? { instance: toSandbox(auth, data), instanceId: data.vm_name } : null;
      },

      list: async (config: ExeDevConfig) => {
        const auth = resolveConfig(config);
        const { vms } = await lobby<{ vms?: ExeDevVmData[] }>(auth, 'ls --json');
        return (vms ?? []).map((vm) => ({ instance: toSandbox(auth, vm), instanceId: vm.vm_name }));
      },

      destroy: async (config: ExeDevConfig, instanceId: string) => {
        const auth = resolveConfig(config);
        if (!(await findVm(auth, instanceId))) return;
        await lobby(auth, `rm --json ${vmName(instanceId)}`);
      },

      runCommand: async (sandbox: ExeDevSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const start = Date.now();
        const body = `ssh ${vmName(sandbox.id)} ${quote(wrapCommand(command, options))}`;
        const timeoutMs = Math.min(options?.timeout ?? API_TIMEOUT_MS, API_TIMEOUT_MS);
        const { ok, status, text } = await post(sandbox, body, 'application/x-ndjson', timeoutMs);
        const result = parseExecStream(text);
        if (result.exitCode === null) {
          const reason = result.error ?? (ok ? 'response ended without an exit status' : text.trim() || 'no output');
          throw new Error(`exe.dev ssh to ${sandbox.id} failed (HTTP ${status}): ${reason}`);
        }
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          durationMs: Date.now() - start,
        };
      },

      getInfo: async (sandbox: ExeDevSandbox): Promise<InstanceInfo> => {
        const data = (await findVm(sandbox, sandbox.id)) ?? { ...sandbox.data, status: 'deleted' };
        const createdAt = data.created_at ? new Date(data.created_at) : new Date(NaN);
        return {
          id: sandbox.id,
          provider: 'exe-dev',
          status: infoStatus(data.status),
          createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
          timeout: 0,
          metadata: {
            status: data.status,
            region: data.region,
            image: data.image,
            httpsUrl: data.https_url,
            sshDest: data.ssh_dest,
          },
        };
      },

      // exe.dev proxies https://<vm>.exe.xyz:<port>/ for ports 3000-9999 (https://exe.dev/docs/proxy).
      // These URLs are private to your exe.dev account unless you run `share set-public <vm>`.
      getUrl: async (sandbox: ExeDevSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        const { port } = options;
        if (!Number.isInteger(port) || port < 3000 || port > 9999) {
          throw new Error(`exe.dev only proxies ports 3000-9999 on https://${sandbox.id}.exe.xyz:<port>/, not ${port}`);
        }
        const scheme = options.protocol === 'ws' || options.protocol === 'wss' ? 'wss' : 'https';
        return `${scheme}://${vmName(sandbox.id)}.exe.xyz:${port}/`;
      },

      getInstance: (sandbox: ExeDevSandbox): ExeDevSandbox => sandbox,
    },
  },
});
