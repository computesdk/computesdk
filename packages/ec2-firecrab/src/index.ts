// ec2-firecrab: Firecracker microVMs on self-hosted EC2, as a ComputeSDK
// sandbox provider.
//
// Lifecycle goes to the firecrab REST API on the host (default
// http://127.0.0.1:5523 — unauthenticated loopback by firecrab's design, so
// callers tunnel: SSM port-forward from the platform, `ssh -L` for dev).
// Exec rides the per-VM managed SSH key + guest sshd (firecrab has no exec
// API); computesdk-runtime guest injection is the planned upgrade — see the
// repo README.

import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { defineProvider } from '@computesdk/provider';
import type {
  CommandResult,
  CreateInstanceOptions,
  InstanceInfo,
  RunCommandOptions,
} from '@computesdk/provider';
import { runSshCommand } from './ssh.js';
import { ensureAccess } from './transport.js';

const PROVIDER = 'ec2-firecrab' as const;
const DEFAULT_API_URL = 'http://127.0.0.1:5523';
const DEFAULT_TEMPLATE = 'alpine';
const DEFAULT_NAME_PREFIX = 'csdk-fc-';
const DEFAULT_CPUS = 1;
const DEFAULT_RAM_MIB = 512;
const DEFAULT_DISK_GB = 4;
const DEFAULT_TIMEOUT_MS = 900_000;
const BOOT_POLL_INTERVAL_MS = 250;
const BOOT_TIMEOUT_MS = 120_000;

export interface Ec2FirecrabConfig {
  /**
   * firecrab API base URL. Loopback by default — firecrab ships an
   * unauthenticated listener, so the caller owns the transport (SSM
   * port-forward, SSH tunnel, or a private subnet listener).
   * Falls back to EC2_FIRECRAB_API_URL.
   */
  apiUrl?: string;
  /** Installed image alias (M2Image or OCI-imported template).
   *  Falls back to EC2_FIRECRAB_TEMPLATE. */
  template?: string;
  /** firecrab MicroNetwork UUID the microVMs join.
   *  Falls back to EC2_FIRECRAB_MICRO_NETWORK_ID. */
  microNetworkId?: string;
  /**
   * MicroNetwork *name* (resolved to its UUID via the API) — a friendlier
   * alternative to microNetworkId. Falls back to EC2_FIRECRAB_MICRO_NETWORK.
   */
  microNetwork?: string;
  /**
   * SSH target for off-host operation, e.g. 'ubuntu@<host-ip>' or a
   * ProxyJump alias. When set, the adapter lazily spawns an SSH
   * local-forward to the host's loopback API and derives the exec
   * ProxyCommand from the same target — no manual tunnel or jumphost
   * wiring required. Falls back to EC2_FIRECRAB_SSH_TARGET.
   */
  sshTarget?: string;
  /**
   * PEM private key material for sshTarget (vault-friendly: pass the key
   * contents, the adapter writes them to a 0600 temp file). Falls back to
   * EC2_FIRECRAB_SSH_KEY. Ignored when it doesn't look like PEM.
   */
  sshIdentityPem?: string;
  /** Path to an SSH private key for sshTarget (EC2_FIRECRAB_SSH_KEY_PATH). */
  sshIdentityPath?: string;
  /** Per-microVM egress: 'internet' or 'isolated'. */
  egressPolicy?: 'internet' | 'isolated';
  /** Default vCPUs per microVM. */
  cpus?: number;
  /** Default guest memory in MiB (power of two, 128–32768). */
  memoryMib?: number;
  /** Default writable disk in GiB. */
  diskGb?: number;
  /** Prefix for generated microVM names. */
  namePrefix?: string;
  /** Guest ssh user for runCommand (default 'root'). */
  sshUser?: string;
  /**
   * OpenSSH ProxyCommand for callers that aren't on the firecrab host —
   * the guest's bridge IP is only routable from the host, so off-host exec
   * rides a jumphost, e.g. `ssh -W %h:%p ubuntu@<host-public-ip>`.
   * Omit when the adapter runs on the host itself.
   * Falls back to EC2_FIRECRAB_SSH_PROXY_COMMAND.
   */
  sshProxyCommand?: string;
  /** Default sandbox and command timeout in milliseconds (15 minutes). */
  timeout?: number;
}

// Verified against a live firecrab host (2026-10-23): states seen are
// created → starting → running → stopping → stopped (+ error). No
// pause/resume or snapshot endpoints exist in current builds.
export interface FirecrabVm {
  id: string;
  name: string;
  state: 'created' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
  /** Guest address on the MicroNetwork bridge — only routable from the host. */
  ipv4?: string;
  ipv6?: string | null;
  mac?: string;
  hostname?: string;
  template?: string;
  cpu?: number;
  ram?: number;
  diskGb?: number;
  microNetworkId?: string;
  egressPolicy?: string;
}

export interface Ec2FirecrabInstance {
  vm: FirecrabVm;
  apiUrl: string;
  /** Exec config resolved at create/getById/list time (methods get no config). */
  sshUser: string;
  sshProxyCommand?: string;
  timeoutMs: number;
}

interface MicroNetwork {
  id: string;
  name: string;
}

async function resolveMicroNetworkId(
  config: Ec2FirecrabConfig,
  apiUrl: string,
): Promise<string> {
  // An explicit id is used verbatim; a name is resolved via the API.
  const id =
    config.microNetworkId ?? process.env.EC2_FIRECRAB_MICRO_NETWORK_ID;
  if (id) return id;
  const name =
    config.microNetwork ?? process.env.EC2_FIRECRAB_MICRO_NETWORK;
  if (!name) {
    throw new Error(
      "ec2-firecrab requires a firecrab MicroNetwork ('microNetwork' name or 'microNetworkId' in config, or EC2_FIRECRAB_MICRO_NETWORK / EC2_FIRECRAB_MICRO_NETWORK_ID)",
    );
  }
  const nets = await firecrab<MicroNetwork[]>(apiUrl, 'GET', '/api/micro-networks');
  const match = nets.find((n) => n.name === name || n.id === name);
  if (!match) {
    const names = nets.map((n) => n.name).join(', ') || '(none)';
    throw new Error(
      `ec2-firecrab: no MicroNetwork named '${name}' on ${apiUrl} (have: ${names})`,
    );
  }
  return match.id;
}

function toInstance(vm: FirecrabVm, apiUrl: string, config: Ec2FirecrabConfig, proxyCommand?: string): Ec2FirecrabInstance {
  return {
    vm,
    apiUrl,
    sshUser: config.sshUser ?? process.env.EC2_FIRECRAB_SSH_USER ?? 'root',
    sshProxyCommand: proxyCommand,
    timeoutMs: config.timeout ?? DEFAULT_TIMEOUT_MS,
  };
}

async function firecrab<T>(
  apiUrl: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`firecrab ${method} ${path} failed: ${res.status} ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function vmId(payload: unknown): string {
  // POST /api/vms returns 201 with the VM UUID; tolerate `{id}` or a bare id.
  if (typeof payload === 'string') return payload;
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const key of ['id', 'vmId', 'uuid']) {
      if (typeof obj[key] === 'string') return obj[key];
    }
  }
  throw new Error(`firecrab create returned an unexpected body: ${JSON.stringify(payload)}`);
}

async function firecrabText(apiUrl: string, method: string, path: string): Promise<string> {
  const res = await fetch(`${apiUrl}${path}`, { method });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`firecrab ${method} ${path} failed: ${res.status} ${detail}`);
  }
  return res.text();
}

async function getVm(apiUrl: string, id: string): Promise<FirecrabVm> {
  return firecrab<FirecrabVm>(apiUrl, 'GET', `/api/vms/${id}`);
}

async function waitForRunning(apiUrl: string, id: string): Promise<FirecrabVm> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  for (;;) {
    const vm = await getVm(apiUrl, id);
    if (vm.state === 'running') return vm;
    if (vm.state === 'error') {
      throw new Error(`microVM ${id} entered the error state`);
    }
    if (Date.now() > deadline) {
      throw new Error(`microVM ${id} did not reach running within ${BOOT_TIMEOUT_MS}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, BOOT_POLL_INTERVAL_MS));
  }
}

async function execViaSsh(
  instance: Ec2FirecrabInstance,
  command: string,
  options?: RunCommandOptions,
): Promise<CommandResult> {
  if (!instance.vm.ipv4) {
    throw new Error(`microVM ${instance.vm.id} has no guest IP yet`);
  }
  const pem = await firecrabText(instance.apiUrl, 'GET', `/api/vms/${instance.vm.id}/ssh-key`);
  return runSshCommand({
    host: instance.vm.ipv4,
    user: instance.sshUser,
    identityPem: pem,
    proxyCommand: instance.sshProxyCommand,
    command,
    cwd: options?.cwd,
    env: options?.env,
    timeoutMs: options?.timeout ?? instance.timeoutMs,
    onStdout: options?.onStdout,
    onStderr: options?.onStderr,
  });
}

const _ec2Firecrab = defineProvider<Ec2FirecrabInstance, Ec2FirecrabConfig, never, never>({
  name: PROVIDER,
  methods: {
    instances: {
      create: async (config, options?: CreateInstanceOptions) => {
        options?.signal?.throwIfAborted();
        const access = await ensureAccess(config);
        const apiUrl = access.apiUrl;
        const microNetworkId = await resolveMicroNetworkId(config, apiUrl);
        const name = options?.name ?? `${config.namePrefix ?? DEFAULT_NAME_PREFIX}${randomUUID()}`;
        const created = await firecrab<unknown>(apiUrl, 'POST', '/api/vms', {
          name,
          template: options?.image ?? config.template ?? process.env.EC2_FIRECRAB_TEMPLATE ?? DEFAULT_TEMPLATE,
          cpu: config.cpus ?? DEFAULT_CPUS,
          ram: config.memoryMib ?? DEFAULT_RAM_MIB,
          diskGb: config.diskGb ?? DEFAULT_DISK_GB,
          microNetworkId,
          ...(config.egressPolicy ? { egressPolicy: config.egressPolicy } : {}),
        });
        const id = vmId(created);
        await firecrab(apiUrl, 'POST', `/api/vms/${id}/start`);
        const vm = await waitForRunning(apiUrl, id);
        // TODO: block until the in-guest computesdk-runtime enrolls (the
        // piece that upgrades exec/fs to the standard HTTP v1 surface),
        // then record its runtime URL on the instance.
        return { instance: toInstance(vm, apiUrl, config, access.proxyCommand), instanceId: id };
      },

      getById: async (config, instanceId: string) => {
        const access = await ensureAccess(config);
        const apiUrl = access.apiUrl;
        try {
          const vm = await getVm(apiUrl, instanceId);
          return { instance: toInstance(vm, apiUrl, config, access.proxyCommand), instanceId };
        } catch {
          return null;
        }
      },

      list: async (config) => {
        const access = await ensureAccess(config);
        const apiUrl = access.apiUrl;
        const vms = await firecrab<FirecrabVm[]>(apiUrl, 'GET', '/api/vms');
        return (vms ?? [])
          .filter((vm) => vm.name?.startsWith(config.namePrefix ?? DEFAULT_NAME_PREFIX))
          .map((vm) => ({ instance: toInstance(vm, apiUrl, config, access.proxyCommand), instanceId: vm.id }));
      },

      destroy: async (config, instanceId: string) => {
        const access = await ensureAccess(config);
        const apiUrl = access.apiUrl;
        // DELETE on a running VM returns 409 invalid_state — stop is
        // mandatory, and it's a ~30s graceful ACPI shutdown (no force flag
        // in current builds).
        await firecrab(apiUrl, 'POST', `/api/vms/${instanceId}/stop`).catch(() => {});
        await firecrab(apiUrl, 'DELETE', `/api/vms/${instanceId}`);
      },

      runCommand: async (
        instance: Ec2FirecrabInstance,
        command: string,
        options?: RunCommandOptions,
      ): Promise<CommandResult> => {
        // Interim exec path: per-VM managed SSH key + guest sshd. The guest
        // bridge IP is only routable from the host, so off-host callers set
        // config.sshProxyCommand (host-as-jumphost). Upgrades to
        // computesdk-runtime HTTP exec once guest injection lands.
        if (options?.background) {
          throw new Error('ec2-firecrab runCommand does not support background mode yet');
        }
        return execViaSsh(instance, command, options);
      },

      streamCommand: async (
        instance: Ec2FirecrabInstance,
        command: string,
        options: RunCommandOptions,
      ): Promise<CommandResult> => {
        // SSH streams natively, so the facade takes this path instead of the
        // daemon-bootstrap fallback when callers pass onStdout/onStderr.
        if (options?.background) {
          throw new Error('ec2-firecrab streamCommand does not support background mode yet');
        }
        return execViaSsh(instance, command, options);
      },

      getInfo: async (instance: Ec2FirecrabInstance): Promise<InstanceInfo> => ({
        id: instance.vm.id,
        provider: PROVIDER,
        createdAt: new Date(),
        timeout: DEFAULT_TIMEOUT_MS,
        status:
          instance.vm.state === 'error'
            ? 'error'
            : instance.vm.state === 'running'
              ? 'running'
              : 'stopped',
        metadata: { name: instance.vm.name, state: instance.vm.state, isolation: 'microvm' },
      }),

      getUrl: async (_instance: Ec2FirecrabInstance, _options: { port: number; protocol?: string }) => {
        // TODO: preview URLs once guest port publishing lands (firecrab
        // port-forwards vs the house-net URL template used on whole boxes).
        throw new Error('ec2-firecrab preview URLs are not implemented yet');
      },
    },
  },
});

/** Create the ec2-firecrab sandbox provider. */
export function ec2Firecrab(config: Ec2FirecrabConfig = {}): ReturnType<typeof _ec2Firecrab> {
  return _ec2Firecrab(config);
}

export default ec2Firecrab;

// Re-exported for callers that time their own lifecycle (benchmarks).
export const __internal = { performanceNow: () => performance.now() };
