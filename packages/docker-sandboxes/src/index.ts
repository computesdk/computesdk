/**
 * Docker Sandboxes Provider - Factory-based Implementation
 *
 * Cloud sandboxes from Docker (https://docs.docker.com/ai/sandboxes/) through the official
 * `@docker/sandboxes` SDK.
 */

import { Sandboxes, pat, RequestError } from '@docker/sandboxes';
import type { Sandbox } from '@docker/sandboxes';
import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type { CommandResult, SandboxInfo, CreateSandboxOptions, RunCommandOptions } from '@computesdk/provider';

export interface DockerSandboxesConfig {
  /** Docker username or organization - falls back to DOCKER_SANDBOXES_USERNAME */
  username?: string;
  /** Docker personal or organization access token - falls back to DOCKER_SANDBOXES_TOKEN */
  token?: string;
  /** Snapshot template (`images/...`) used when create() is given no templateId or snapshotId - falls back to DOCKER_SANDBOXES_IMAGE */
  image?: string;
  /** Sandbox lifetime in milliseconds */
  timeout?: number;
}

const env = (name: string) => (typeof process !== 'undefined' && process.env?.[name]) || '';

// One client per credential pair for the whole process. A token exchange costs a round trip, and
// callers commonly build a fresh provider per sandbox, so sharing keeps sign-in out of every create.
const clients = new Map<string, Sandboxes>();

function clientFor(config: DockerSandboxesConfig): Sandboxes {
  const username = config.username || env('DOCKER_SANDBOXES_USERNAME');
  const personalAccessToken = config.token || env('DOCKER_SANDBOXES_TOKEN');
  if (!username || !personalAccessToken) {
    throw new Error(
      `Missing Docker Sandboxes credentials. Provide 'username' and 'token' in config or set ` +
        `DOCKER_SANDBOXES_USERNAME and DOCKER_SANDBOXES_TOKEN environment variables.`,
    );
  }
  const key = `${username}\0${personalAccessToken}`;
  let client = clients.get(key);
  if (!client) {
    const auth = pat({ username, personalAccessToken });
    // Create also returns the first command's exec credential, saving a request.
    client = new Sandboxes({ auth, prefetchExecCredential: true });
    clients.set(key, client);
    // Start the token exchange now, so the first create doesn't wait for it.
    auth.getAccessToken().catch(() => {});
  }
  return client;
}

// Sign in at import when credentials come from the environment, so the exchange
// is done before the first create.
if (env('DOCKER_SANDBOXES_USERNAME') && env('DOCKER_SANDBOXES_TOKEN')) {
  clientFor({});
}

const isNotFound = (error: unknown) => error instanceof RequestError && error.httpStatus === 404;

export const dockerSandboxes = defineProvider<Sandbox, DockerSandboxesConfig>({
  name: 'docker-sandboxes',
  methods: {
    sandbox: {
      create: async (config: DockerSandboxesConfig, options?: CreateSandboxOptions) => {
        const client = clientFor(config);
        const image = options?.templateId || options?.snapshotId || config.image || env('DOCKER_SANDBOXES_IMAGE');
        // Snapshot templates only: a registry image would be pulled cold on every create.
        if (!image?.startsWith('images/')) {
          throw new Error(
            `Docker Sandboxes needs a snapshot template ('images/...') as templateId, snapshotId, ` +
              `'image' in config, or DOCKER_SANDBOXES_IMAGE.`,
          );
        }
        try {
          const accepted = await client.create({
            image,
            ...(options?.envs ? { environment: options.envs } : {}),
            ...(options?.name ? { displayName: options.name } : {}),
            lifecycle: { timeoutMs: options?.timeout ?? config.timeout ?? 300000 },
          });
          // waitUntilRunning() always reads once; skip it when create already returned running.
          // Same check as the SDK's own withSandbox(), valid because we pass no idempotencyKey.
          const sandbox = accepted.status === 'running' && accepted.uid ? accepted : await accepted.waitUntilRunning();
          return { sandbox, sandboxId: sandbox.name };
        } catch (error) {
          // A RequestError's message is only its code; the server's explanation is in raw.message.
          const detail = error instanceof RequestError && error.raw?.message ? `: ${error.raw.message}` : '';
          throw new Error(`Failed to create Docker sandbox: ${error instanceof Error ? error.message : String(error)}${detail}`);
        }
      },

      getById: async (config: DockerSandboxesConfig, sandboxId: string) => {
        try {
          const sandbox = await clientFor(config).get(sandboxId);
          return { sandbox, sandboxId: sandbox.name };
        } catch (error) {
          if (isNotFound(error)) return null;
          throw error;
        }
      },

      list: async (config: DockerSandboxesConfig) => {
        const client = clientFor(config);
        const names: string[] = [];
        for await (const item of client.allSandboxes({ query: { pageSize: 100 } })) names.push(item.name);
        const found = await Promise.all(names.map((name) => client.get(name).catch(() => null)));
        return found.filter((s): s is Sandbox => s !== null).map((sandbox) => ({ sandbox, sandboxId: sandbox.name }));
      },

      destroy: async (config: DockerSandboxesConfig, sandboxId: string) => {
        try {
          const sandbox = await clientFor(config).get(sandboxId);
          await sandbox.delete();
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }
      },

      runCommand: async (sandbox: Sandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();
        let fullCommand = command;
        if (options?.cwd) fullCommand = `cd "${escapeShellArg(options.cwd)}" && ${fullCommand}`;
        if (options?.background) fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
        try {
          // One exec request: no process to create and no output to poll afterwards.
          const result = await sandbox.run(
            ['sh', '-c', fullCommand],
            options?.env ? { env: options.env } : {},
            options?.timeout ? { timeoutMs: options.timeout } : undefined,
          );
          return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, durationMs: Date.now() - startTime };
        } catch (error) {
          return { stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 127, durationMs: Date.now() - startTime };
        }
      },

      getInfo: async (sandbox: Sandbox): Promise<SandboxInfo> => ({
        id: sandbox.name,
        provider: 'docker-sandboxes',
        status: sandbox.core?.status === 'running' ? 'running' : 'stopped',
        createdAt: sandbox.core?.createdAt ? new Date(sandbox.core.createdAt) : new Date(),
        timeout: 300000,
        metadata: {},
      }),

      getUrl: async () => {
        throw new Error('getUrl is not supported by the Docker Sandboxes provider yet.');
      },

      getInstance: (sandbox: Sandbox): Sandbox => sandbox,
    },
  },
});

export type { Sandbox as DockerSandbox } from '@docker/sandboxes';
