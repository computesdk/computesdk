import { describe, it, expect } from 'vitest';
import { compute } from '../compute';
import { getProviderConfig, getProviderSandboxOptions, loadProviderFactory } from './integration-providers';

const runIntegration = process.env.COMPUTESDK_INTEGRATION === '1';
const testProvider = process.env.TEST_PROVIDER;
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('compute provider integration', () => {
  it('creates, executes, and destroys a sandbox through compute', async () => {
    if (!testProvider) {
      throw new Error('TEST_PROVIDER must be set when COMPUTESDK_INTEGRATION=1');
    }

    const config = getProviderConfig(testProvider);
    const providerFactory = await loadProviderFactory(testProvider);
    const provider = providerFactory(config);

    const sdk = compute({ provider });
    const sandbox = await sdk.sandbox.create(getProviderSandboxOptions(testProvider) as any);

    try {
      const result = await sandbox.runCommand('echo computesdk-integration-ok');
      expect(result.stdout).toContain('computesdk-integration-ok');

      const daemonStdoutChunks: string[] = [];
      const daemonStderrChunks: string[] = [];
      const daemonResult = await sandbox.runCommand('echo computesdk-daemon-stream-ok', {
        onStdout: (data: string) => {
          daemonStdoutChunks.push(data);
        },
        onStderr: (data: string) => {
          daemonStderrChunks.push(data);
        },
      });
      const daemonCombinedOutput = [daemonResult.stdout, daemonResult.stderr, daemonStdoutChunks.join(''), daemonStderrChunks.join('')]
        .join(' ')
        .trim();
      expect(daemonCombinedOutput).toContain('computesdk-daemon-stream-ok');

      const fetched = await sdk.sandbox.getById(sandbox.sandboxId);
      expect(fetched?.sandboxId).toBe(sandbox.sandboxId);

      // Timeout extension is provider-specific in direct mode and is covered by
      // unit/contract tests; keep this integration focused on cross-provider
      // operations that are universally supported.
    } finally {
      await sdk.sandbox.destroy(sandbox.sandboxId);
    }
  }, 180000);

  it.runIf(testProvider === 'vercel')(
    'streams daemon output callbacks before command completion',
    async () => {
      if (!testProvider) {
        throw new Error('TEST_PROVIDER must be set when COMPUTESDK_INTEGRATION=1');
      }

      const providerFactory = await loadProviderFactory(testProvider);
      const provider = providerFactory(getProviderConfig(testProvider));

      const sdk = compute({ provider });
      const sandbox = await sdk.sandbox.create(getProviderSandboxOptions(testProvider) as any);

      try {
        let commandResolved = false;
        let sawChunkBeforeResolve = false;
        let markChunkSeen: (() => void) | undefined;
        const firstChunkSeen = new Promise<void>((resolve) => {
          markChunkSeen = () => {
            if (!commandResolved) {
              sawChunkBeforeResolve = true;
            }
            resolve();
          };
        });

        const daemonPromise = sandbox.runCommand(
          'sh -lc "sleep 1; echo stream-start; sleep 2; echo stream-end"',
          {
            onStdout: () => {
              markChunkSeen?.();
            },
            onStderr: () => {
              markChunkSeen?.();
            },
          }
        );

        await Promise.race([
          firstChunkSeen,
          new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for daemon stream callback')), 5000)),
        ]);

        await daemonPromise;
        commandResolved = true;

        expect(sawChunkBeforeResolve).toBe(true);
      } finally {
        await sdk.sandbox.destroy(sandbox.sandboxId);
      }
    },
    180000,
  );

  it.runIf(testProvider === 'modal' || testProvider === 'vercel')(
    'reports daemon streaming timing diagnostics',
    async () => {
      if (!testProvider) {
        throw new Error('TEST_PROVIDER must be set when COMPUTESDK_INTEGRATION=1');
      }

      const providerFactory = await loadProviderFactory(testProvider);
      const provider = providerFactory(getProviderConfig(testProvider));

      const sdk = compute({ provider });
      const sandbox = await sdk.sandbox.create(getProviderSandboxOptions(testProvider) as any);

      try {
        const startedAt = Date.now();
        let resolvedAt: number | undefined;
        let firstChunkAt: number | undefined;
        let stdoutChunks = 0;
        let stderrChunks = 0;

        const result = await sandbox.runCommand(
          'sh -lc "echo stream-a; sleep 1; echo stream-b; sleep 1; echo stream-c; sleep 1; echo stream-d; sleep 1; echo stream-e"',
          {
            onStdout: () => {
              stdoutChunks += 1;
              if (!firstChunkAt) {
                firstChunkAt = Date.now();
              }
            },
            onStderr: () => {
              stderrChunks += 1;
              if (!firstChunkAt) {
                firstChunkAt = Date.now();
              }
            },
          }
        );

        resolvedAt = Date.now();

        const firstChunkLatencyMs = firstChunkAt ? firstChunkAt - startedAt : undefined;
        const completedInMs = resolvedAt - startedAt;
        const sawPreCompletionChunk = Boolean(firstChunkAt && firstChunkAt < resolvedAt);

        console.info(
          `[daemon-stream-diagnostics] provider=${testProvider} stdoutChunks=${stdoutChunks} stderrChunks=${stderrChunks} firstChunkLatencyMs=${firstChunkLatencyMs ?? 'none'} completedInMs=${completedInMs} preCompletionChunk=${sawPreCompletionChunk}`
        );

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('stream-e');
      } finally {
        await sdk.sandbox.destroy(sandbox.sandboxId);
      }
    },
    180000,
  );
});
